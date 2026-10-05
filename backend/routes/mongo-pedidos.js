const crypto = require('node:crypto');
const express = require('express');
const { getMongoDb, getMongoClient, nextId } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { obrigatorio, inteiroPositivo, paginacao, emEnum } = require('../utils/validacao');
const { httpError } = require('../middleware/error');
const { asyncRoute, idParam } = require('../utils/mongo-helpers');
const {
  METODOS, TIPOS_ENTREGA, metodoCombinado, metodosAceitos, rotuloMetodo,
  serializarPagamento, resumoPagamento, permissoesPagamento,
} = require('../utils/pagamentos');
const { publicarEvento } = require('../utils/mensagens-sistema');

const router = express.Router();
const STATUS_VALIDOS = ['pendente', 'confirmado', 'entregue', 'cancelado'];
const LOCAL_MAX = 200;
const TEXTO_CURTO_MAX = 200;

function payloadSnapshot(message) {
  if (!message?.snapshot_json) return null;
  if (typeof message.snapshot_json === 'string') {
    try { return JSON.parse(message.snapshot_json); } catch { return null; }
  }
  return message.snapshot_json;
}

function serializarPedido(pedido, extras = {}) {
  if (!pedido) return null;
  return {
    id: pedido.id,
    conversa_id: pedido.conversa_id,
    mensagem_snapshot_id: pedido.mensagem_snapshot_id,
    cliente_id: pedido.cliente_id,
    cliente_nome: extras.cliente_nome ?? null,
    agricultor_id: pedido.agricultor_id,
    agricultor_nome: extras.agricultor_nome ?? null,
    status: pedido.status,
    total: pedido.total,
    forma_pagamento: pedido.forma_pagamento,
    metodo_combinado: metodoCombinado(pedido),
    // Pedidos antigos não têm o campo: eram sempre retirada.
    tipo_entrega: pedido.tipo_entrega || 'retirada',
    data_retirada: pedido.data_retirada,
    local_entrega: pedido.local_entrega || null,
    observacoes: pedido.observacoes,
    itens: pedido.itens || [],
    pagamento: resumoPagamento(extras.pagamento),
    created_at: pedido.created_at,
    updated_at: pedido.updated_at,
  };
}

/** Busca nomes das partes e o pagamento de vários pedidos de uma vez. */
async function serializarComExtras(db, orders) {
  if (!orders.length) return [];
  const userIds = [...new Set(orders.flatMap((order) => [order.cliente_id, order.agricultor_id]))];
  const [users, payments] = await Promise.all([
    db.collection('usuarios').find({ id: { $in: userIds } }, { projection: { id: 1, nome: 1 } }).toArray(),
    db.collection('pagamentos').find({ pedido_id: { $in: orders.map((order) => order.id) } }).toArray(),
  ]);
  const nameById = new Map(users.map((user) => [user.id, user.nome]));
  const paymentByOrder = new Map(payments.map((payment) => [payment.pedido_id, payment]));
  return orders.map((order) => serializarPedido(order, {
    cliente_nome: nameById.get(order.cliente_id),
    agricultor_nome: nameById.get(order.agricultor_id),
    pagamento: paymentByOrder.get(order.id),
  }));
}

async function pedidoDaParte(db, id, user) {
  const order = await db.collection('pedidos').findOne({ id });
  if (!order) throw httpError(404, 'NOT_FOUND', 'Pedido não encontrado');
  if (order.cliente_id !== user.id && order.agricultor_id !== user.id) {
    throw httpError(403, 'FORBIDDEN', 'Você não é parte deste pedido');
  }
  return order;
}

function textoOpcional(value, name, max) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text.length > max) throw httpError(400, 'VALIDATION', `${name} deve ter até ${max} caracteres`);
  return text || null;
}

function exigirPedidoPagavel(order) {
  if (order.status === 'cancelado') {
    throw httpError(409, 'PEDIDO_NAO_PAGAVEL', 'Este pedido foi cancelado.');
  }
  if (!['confirmado', 'entregue'].includes(order.status)) {
    throw httpError(409, 'PEDIDO_NAO_PAGAVEL', 'O pagamento fica disponível após a confirmação do pedido.');
  }
}

router.post('/', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  obrigatorio(body, ['mensagem_snapshot_id', 'forma_pagamento_id']);
  const messageId = inteiroPositivo(body.mensagem_snapshot_id, 'mensagem_snapshot_id');
  const formaId = inteiroPositivo(body.forma_pagamento_id, 'forma_pagamento_id');
  const tipoEntrega = body.tipo_entrega ?? 'retirada';
  emEnum(tipoEntrega, 'tipo_entrega', TIPOS_ENTREGA);
  const localEntrega = textoOpcional(body.local_entrega, 'local_entrega', LOCAL_MAX);
  if (body.data_retirada && Number.isNaN(Date.parse(body.data_retirada))) {
    throw httpError(400, 'VALIDATION', 'data_retirada mal formatada (esperado ISO 8601)');
  }
  const db = await getMongoDb();

  const message = await db.collection('mensagens').findOne({ id: messageId });
  if (!message) throw httpError(404, 'NOT_FOUND', 'Mensagem snapshot não encontrada');
  if (message.tipo !== 'snapshot') throw httpError(400, 'VALIDATION', 'Mensagem não é do tipo snapshot');
  const conversation = await db.collection('conversas').findOne({ id: message.conversa_id });
  if (!conversation || conversation.agricultor_id !== req.user.id) {
    throw httpError(403, 'FORBIDDEN', 'Você não é o destinatário desta snapshot');
  }

  const form = await db.collection('formas_pagamento').findOne({ id: formaId });
  if (!form) throw httpError(404, 'NOT_FOUND', 'Forma de pagamento não encontrada');
  const snapshot = payloadSnapshot(message);
  if (!Array.isArray(snapshot?.itens) || !snapshot.itens.length) {
    throw httpError(400, 'VALIDATION', 'Snapshot sem itens');
  }

  const orderId = await nextId('pedidos');
  const client = await getMongoClient();
  let order;
  try {
    await client.withSession(async (session) => session.withTransaction(async () => {
      if (await db.collection('pedidos').findOne({ mensagem_snapshot_id: messageId }, { session })) {
        throw httpError(400, 'SNAPSHOT_USADO', 'Este snapshot já gerou um pedido');
      }

      const items = [];
      for (const item of snapshot.itens) {
        const product = await db.collection('produtos').findOne({
          id: item.produto_id,
          deleted_at: null,
          estoque: { $gte: Number(item.quantidade) },
        }, { session });
        if (!product) {
          const available = await db.collection('produtos').findOne({ id: item.produto_id }, { session });
          if (!available || available.deleted_at) {
            throw httpError(400, 'PRODUTO_INDISPONIVEL', `Produto ${item.produto_id} não disponível`);
          }
          throw httpError(400, 'ESTOQUE_INSUFICIENTE', `Estoque insuficiente para "${available.nome}"`);
        }
        const decrement = await db.collection('produtos').updateOne(
          { id: product.id, estoque: { $gte: Number(item.quantidade) }, deleted_at: null },
          { $inc: { estoque: -Number(item.quantidade) }, $set: { updated_at: new Date().toISOString() } },
          { session }
        );
        if (!decrement.matchedCount) throw httpError(400, 'ESTOQUE_INSUFICIENTE', `Estoque insuficiente para "${product.nome}"`);
        const subtotal = Number((Number(item.preco_unit) * Number(item.quantidade)).toFixed(2));
        items.push({
          produto_id: product.id,
          nome_produto: item.nome || product.nome,
          quantidade: Number(item.quantidade),
          preco_unit: Number(item.preco_unit),
          subtotal,
        });
      }

      const now = new Date().toISOString();
      order = {
        _id: orderId,
        id: orderId,
        conversa_id: message.conversa_id,
        mensagem_snapshot_id: messageId,
        cliente_id: conversation.cliente_id,
        agricultor_id: conversation.agricultor_id,
        forma_pagamento_id: form.id,
        forma_pagamento: { id: form.id, nome: form.nome },
        status: 'pendente',
        total: Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)),
        observacoes: body.observacoes || null,
        tipo_entrega: tipoEntrega,
        data_retirada: body.data_retirada || null,
        local_entrega: localEntrega,
        itens: items,
        created_at: now,
        updated_at: now,
      };
      await db.collection('pedidos').insertOne(order, { session });
    }));
  } catch (error) {
    if (error?.code === 11000) throw httpError(400, 'SNAPSHOT_USADO', 'Este snapshot já gerou um pedido');
    throw error;
  }
  await publicarEvento(db, 'pedido_criado', { pedido: order, ator: req.user });
  res.status(201).json((await serializarComExtras(db, [order]))[0]);
}));

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = paginacao(req.query);
  const filter = req.user.role === 'cliente'
    ? { cliente_id: req.user.id }
    : { agricultor_id: req.user.id };
  if (req.query.status) {
    emEnum(req.query.status, 'status', STATUS_VALIDOS);
    filter.status = req.query.status;
  }
  const db = await getMongoDb();
  const collection = db.collection('pedidos');
  const [total, items] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter, { projection: { _id: 0 } })
      .sort({ created_at: -1, id: -1 }).skip(offset).limit(limit).toArray(),
  ]);
  res.json({ items: await serializarComExtras(db, items), page, limit, total });
}));

// =============================================================
// Pagamento do pedido
// =============================================================

/**
 * GET /pedidos/:id/pagamento — cliente OU agricultor do pedido.
 * Devolve o pagamento, as opções de pagamento (para o cliente escolher)
 * e o que quem está logado pode fazer agora (`pode`).
 */
router.get('/:id/pagamento', requireAuth, asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const db = await getMongoDb();
  const order = await pedidoDaParte(db, id, req.user);
  const [payment, farmer] = await Promise.all([
    db.collection('pagamentos').findOne({ pedido_id: id }),
    db.collection('usuarios').findOne({ id: order.agricultor_id }, { projection: { nome: 1, perfil: 1 } }),
  ]);

  const agreed = metodoCombinado(order);
  // O método combinado no pedido vale mesmo que o agricultor mude o perfil depois.
  const accepted = [...new Set([...(agreed ? [agreed] : []), ...metodosAceitos(farmer?.perfil)])];
  const payable = ['confirmado', 'entregue'].includes(order.status);
  // A chave PIX só aparece para o próprio agricultor ou para o cliente de um pedido já confirmado.
  const canSeeKey = req.user.id === order.agricultor_id || payable;

  res.json({
    pagamento: serializarPagamento(payment),
    opcoes: {
      metodo_combinado: agreed,
      metodos: accepted.map((metodo) => ({
        id: metodo,
        rotulo: rotuloMetodo(metodo),
        confirmacao: METODOS[metodo].confirmacao,
        combinado: metodo === agreed,
      })),
      chave_pix: canSeeKey ? (farmer?.perfil?.chave_pix || null) : null,
      agricultor_nome: farmer?.nome || null,
    },
    pode: permissoesPagamento(order, payment, req.user),
  });
}));

/**
 * POST /pedidos/:id/pagamento — cliente informa como pagou / vai pagar.
 * Pode ser refeito enquanto o pagamento estiver `recusado` ou `pagar_na_entrega`.
 */
router.post('/:id/pagamento', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const db = await getMongoDb();
  const order = await pedidoDaParte(db, id, req.user);
  exigirPedidoPagavel(order);

  const metodo = req.body?.metodo;
  if (!METODOS[metodo]) throw httpError(400, 'VALIDATION', 'Método de pagamento inválido');
  const farmer = await db.collection('usuarios').findOne({ id: order.agricultor_id }, { projection: { perfil: 1 } });
  const agreed = metodoCombinado(order);
  if (metodo !== agreed && !metodosAceitos(farmer?.perfil).includes(metodo)) {
    throw httpError(400, 'METODO_NAO_ACEITO', `Este agricultor não aceita ${rotuloMetodo(metodo)}.`);
  }

  const payments = db.collection('pagamentos');
  const existing = await payments.findOne({ pedido_id: id });
  if (existing && !['recusado', 'pagar_na_entrega'].includes(existing.status)) {
    throw httpError(409, 'PAGAMENTO_JA_REGISTRADO', existing.status === 'aprovado'
      ? 'Este pedido já está pago.'
      : 'Este pedido já possui um pagamento aguardando confirmação.');
  }

  const now = new Date().toISOString();
  const confirmacao = METODOS[metodo].confirmacao;
  const fields = {
    metodo,
    cartao_ultimos4: null,
    valor: order.total,
    simulado: false,
    transacao_id: null,
    observacao: textoOpcional(req.body?.observacao, 'observacao', TEXTO_CURTO_MAX),
    motivo_recusa: null,
    recusado_em: null,
    confirmado_em: null,
    registrado_por: 'cliente',
    informado_em: now,
    updated_at: now,
  };
  let evento;
  if (confirmacao === 'simulada') {
    const last4 = String(req.body?.cartao_ultimos4 || '');
    if (!/^\d{4}$/.test(last4)) throw httpError(400, 'VALIDATION', 'Informe os quatro últimos dígitos do cartão');
    Object.assign(fields, {
      status: 'aprovado', simulado: true, cartao_ultimos4: last4,
      transacao_id: crypto.randomUUID(), confirmado_em: now,
    });
    evento = 'pagamento_confirmado';
  } else if (confirmacao === 'na_entrega' && order.status !== 'entregue') {
    fields.status = 'pagar_na_entrega';
    evento = 'pagamento_na_entrega';
  } else {
    // PIX, transferência — ou dinheiro informado depois da entrega.
    fields.status = 'aguardando_confirmacao';
    evento = 'pagamento_informado';
  }
  const entry = { evento, por: 'cliente', metodo, em: now };

  let payment;
  if (!existing) {
    payment = {
      _id: id, pedido_id: id, cliente_id: order.cliente_id, agricultor_id: order.agricultor_id,
      ...fields, devolucao_pendente: false, created_at: now, historico: [entry],
    };
    try {
      await payments.insertOne(payment);
    } catch (error) {
      if (error?.code === 11000) throw httpError(409, 'PAGAMENTO_JA_REGISTRADO', 'Este pedido já possui um pagamento registrado.');
      throw error;
    }
  } else {
    const result = await payments.updateOne(
      { pedido_id: id, status: existing.status },
      { $set: fields, $push: { historico: entry } }
    );
    if (!result.matchedCount) throw httpError(409, 'PAGAMENTO_JA_REGISTRADO', 'O pagamento foi atualizado por outra operação.');
    payment = await payments.findOne({ pedido_id: id });
  }

  await publicarEvento(db, evento, { pedido: order, pagamento: payment, ator: req.user });
  res.status(201).json({
    pagamento: serializarPagamento(payment),
    pode: permissoesPagamento(order, payment, req.user),
  });
}));

/**
 * PATCH /pedidos/:id/pagamento — agricultor confirma ou contesta o recebimento.
 *   { acao: 'confirmar', metodo? }  → `aprovado` (cria o registro se o cliente não informou nada)
 *   { acao: 'recusar', motivo? }    → `recusado` (cliente pode informar de novo)
 */
router.patch('/:id/pagamento', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  obrigatorio(req.body || {}, ['acao']);
  const { acao } = req.body;
  emEnum(acao, 'acao', ['confirmar', 'recusar']);
  const db = await getMongoDb();
  const order = await pedidoDaParte(db, id, req.user);
  exigirPedidoPagavel(order);

  const payments = db.collection('pagamentos');
  const existing = await payments.findOne({ pedido_id: id });
  const now = new Date().toISOString();
  let evento;
  let motivo = null;

  if (acao === 'confirmar') {
    evento = 'pagamento_confirmado';
    const entry = { evento, por: 'agricultor', em: now };
    if (!existing) {
      // Cliente pagou em mãos / por fora e não registrou: o agricultor registra direto.
      const metodo = req.body.metodo
        || metodoCombinado(order) || 'cash';
      if (!METODOS[metodo]) throw httpError(400, 'VALIDATION', 'Método de pagamento inválido');
      try {
        await payments.insertOne({
          _id: id, pedido_id: id, cliente_id: order.cliente_id, agricultor_id: order.agricultor_id,
          metodo, cartao_ultimos4: null, valor: order.total, status: 'aprovado', simulado: false,
          transacao_id: null, observacao: null, motivo_recusa: null, devolucao_pendente: false,
          registrado_por: 'agricultor', created_at: now, informado_em: now, confirmado_em: now,
          recusado_em: null, updated_at: now, historico: [{ ...entry, metodo }],
        });
      } catch (error) {
        if (error?.code === 11000) throw httpError(409, 'PAGAMENTO_ATUALIZADO', 'O cliente acabou de informar o pagamento. Atualize a página.');
        throw error;
      }
    } else {
      if (existing.status === 'aprovado') throw httpError(409, 'PAGAMENTO_JA_CONFIRMADO', 'Este pagamento já foi confirmado.');
      if (!['aguardando_confirmacao', 'pagar_na_entrega', 'recusado'].includes(existing.status)) {
        throw httpError(409, 'PAGAMENTO_NAO_CONFIRMAVEL', 'Este pagamento não pode mais ser confirmado.');
      }
      const result = await payments.updateOne(
        { pedido_id: id, status: existing.status },
        { $set: { status: 'aprovado', confirmado_em: now, motivo_recusa: null, updated_at: now }, $push: { historico: entry } }
      );
      if (!result.matchedCount) throw httpError(409, 'PAGAMENTO_ATUALIZADO', 'O pagamento foi atualizado por outra operação.');
    }
  } else {
    evento = 'pagamento_recusado';
    if (!existing || existing.status !== 'aguardando_confirmacao') {
      throw httpError(409, 'PAGAMENTO_NAO_CONTESTAVEL', 'Só é possível contestar um pagamento que está aguardando confirmação.');
    }
    motivo = textoOpcional(req.body.motivo, 'motivo', TEXTO_CURTO_MAX);
    const result = await payments.updateOne(
      { pedido_id: id, status: 'aguardando_confirmacao' },
      {
        $set: { status: 'recusado', motivo_recusa: motivo, recusado_em: now, updated_at: now },
        $push: { historico: { evento, por: 'agricultor', motivo, em: now } },
      }
    );
    if (!result.matchedCount) throw httpError(409, 'PAGAMENTO_ATUALIZADO', 'O pagamento foi atualizado por outra operação.');
  }

  const payment = await payments.findOne({ pedido_id: id });
  await publicarEvento(db, evento, { pedido: order, pagamento: payment, ator: req.user, motivo });
  res.json({
    pagamento: serializarPagamento(payment),
    pode: permissoesPagamento(order, payment, req.user),
  });
}));

// =============================================================
// Detalhe e status
// =============================================================

router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const db = await getMongoDb();
  const order = await pedidoDaParte(db, id, req.user);
  res.json((await serializarComExtras(db, [order]))[0]);
}));

router.patch('/:id/status', requireAuth, asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  obrigatorio(req.body || {}, ['status']);
  const newStatus = req.body.status;
  emEnum(newStatus, 'status', STATUS_VALIDOS);
  const db = await getMongoDb();
  const client = await getMongoClient();
  let updatedOrder;

  await client.withSession(async (session) => session.withTransaction(async () => {
    const order = await db.collection('pedidos').findOne({ id }, { session });
    if (!order) throw httpError(404, 'NOT_FOUND', 'Pedido não encontrado');
    const isClient = order.cliente_id === req.user.id && req.user.role === 'cliente';
    const isFarmer = order.agricultor_id === req.user.id && req.user.role === 'agricultor';
    if (!isClient && !isFarmer) throw httpError(403, 'FORBIDDEN', 'Você não é parte deste pedido');

    const current = order.status;
    if (current === newStatus) throw httpError(400, 'TRANSICAO_INVALIDA', 'Pedido já está neste status');
    const allowed = (isFarmer && (
      (current === 'pendente' && newStatus === 'confirmado')
      || (current === 'confirmado' && newStatus === 'entregue')
      || (newStatus === 'cancelado' && current !== 'cancelado' && current !== 'entregue')
    )) || (isClient && current === 'pendente' && newStatus === 'cancelado');
    if (!allowed) {
      throw httpError(403, 'TRANSICAO_INVALIDA', `Transição ${current} → ${newStatus} não permitida para ${req.user.role}`);
    }

    const now = new Date().toISOString();
    const result = await db.collection('pedidos').updateOne(
      { id, status: current },
      { $set: { status: newStatus, updated_at: now } },
      { session }
    );
    if (!result.matchedCount) throw httpError(409, 'TRANSICAO_INVALIDA', 'O pedido foi atualizado por outra operação');

    if (newStatus === 'cancelado') {
      for (const item of order.itens || []) {
        await db.collection('produtos').updateOne(
          { id: item.produto_id },
          { $inc: { estoque: item.quantidade }, $set: { updated_at: now } },
          { session }
        );
      }
    }

    // O pagamento acompanha o pedido.
    const payment = await db.collection('pagamentos').findOne({ pedido_id: id }, { session });
    if (payment && newStatus === 'entregue' && payment.status === 'pagar_na_entrega') {
      // Dinheiro na entrega/retirada: entregar = receber.
      await db.collection('pagamentos').updateOne(
        { pedido_id: id, status: 'pagar_na_entrega' },
        {
          $set: { status: 'aprovado', confirmado_em: now, updated_at: now },
          $push: { historico: { evento: 'pagamento_confirmado', por: 'agricultor', em: now } },
        },
        { session }
      );
    }
    if (payment && newStatus === 'cancelado' && payment.status !== 'cancelado') {
      await db.collection('pagamentos').updateOne(
        { pedido_id: id },
        {
          $set: { status: 'cancelado', devolucao_pendente: payment.status === 'aprovado', updated_at: now },
          $push: { historico: { evento: 'pedido_cancelado', por: req.user.role, em: now } },
        },
        { session }
      );
    }
    updatedOrder = await db.collection('pedidos').findOne({ id }, { session });
  }));

  const payment = await db.collection('pagamentos').findOne({ pedido_id: id });
  const evento = { confirmado: 'pedido_confirmado', entregue: 'pedido_entregue', cancelado: 'pedido_cancelado' }[newStatus];
  if (evento) await publicarEvento(db, evento, { pedido: updatedOrder, pagamento: payment, ator: req.user });
  res.json((await serializarComExtras(db, [updatedOrder]))[0]);
}));

module.exports = router;
