const express = require('express');
const { getMongoDb, nextId } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { obrigatorio } = require('../utils/validacao');
const { httpError } = require('../middleware/error');
const { asyncRoute, idParam } = require('../utils/mongo-helpers');

const router = express.Router();

async function getOuCriarConversa(db, clienteId, agricultorId) {
  const collection = db.collection('conversas');
  let conversation = await collection.findOne({ cliente_id: clienteId, agricultor_id: agricultorId });
  if (conversation) return conversation;

  const id = await nextId('conversas');
  const now = new Date().toISOString();
  const candidate = {
    _id: id, id, cliente_id: clienteId, agricultor_id: agricultorId,
    created_at: now, updated_at: now,
  };
  try {
    await collection.insertOne(candidate);
    return candidate;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    conversation = await collection.findOne({ cliente_id: clienteId, agricultor_id: agricultorId });
    if (!conversation) throw error;
    return conversation;
  }
}

function participante(userId, conversation) {
  return conversation && (conversation.cliente_id === userId || conversation.agricultor_id === userId);
}

function serializarMensagem(message) {
  return {
    id: message.id,
    conversa_id: message.conversa_id,
    remetente_id: message.remetente_id,
    tipo: message.tipo,
    conteudo: message.conteudo ?? null,
    snapshot_json: message.snapshot_json ?? null,
    carrinho_id: message.carrinho_id ?? null,
    // Só em mensagens tipo 'sistema' (confirmações de pedido/pagamento).
    evento: message.evento ?? null,
    created_at: message.created_at,
  };
}

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  const conversations = await db.collection('conversas').find({
    $or: [{ cliente_id: req.user.id }, { agricultor_id: req.user.id }],
  }).toArray();

  const items = await Promise.all(conversations.map(async (conversation) => {
    const [client, farmer, lastMessage] = await Promise.all([
      db.collection('usuarios').findOne({ id: conversation.cliente_id }, { projection: { nome: 1 } }),
      db.collection('usuarios').findOne({ id: conversation.agricultor_id }, { projection: { nome: 1 } }),
      db.collection('mensagens').findOne({ conversa_id: conversation.id }, { sort: { created_at: -1, id: -1 } }),
    ]);
    const other = req.user.role === 'cliente'
      ? { id: conversation.agricultor_id, nome: farmer?.nome, role: 'agricultor' }
      : { id: conversation.cliente_id, nome: client?.nome, role: 'cliente' };
    let preview = null;
    if (lastMessage?.tipo === 'texto') preview = lastMessage.conteudo;
    if (lastMessage?.tipo === 'snapshot') preview = '[snapshot do carrinho]';
    if (lastMessage?.tipo === 'sistema') preview = lastMessage.conteudo;
    return {
      id: conversation.id,
      outro: other,
      ultima_mensagem: lastMessage ? {
        tipo: lastMessage.tipo,
        preview,
        created_at: lastMessage.created_at,
      } : null,
    };
  }));
  items.sort((a, b) => (b.ultima_mensagem?.created_at || '').localeCompare(a.ultima_mensagem?.created_at || ''));
  res.json(items);
}));

router.get('/:id/mensagens', requireAuth, asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const db = await getMongoDb();
  const conversation = await db.collection('conversas').findOne({ id });
  if (!conversation) throw httpError(404, 'NOT_FOUND', 'Conversa não encontrada');
  if (!participante(req.user.id, conversation)) {
    throw httpError(403, 'FORBIDDEN', 'Você não participa desta conversa');
  }

  const cursor = req.query.desde || req.query.since;
  let messages;
  if (cursor) {
    const time = Date.parse(cursor);
    if (Number.isNaN(time)) throw httpError(400, 'VALIDATION', '`desde` mal formatado (esperado ISO 8601)');
    messages = await db.collection('mensagens').find({
      conversa_id: id,
      created_at: { $gt: new Date(time).toISOString() },
    }).sort({ created_at: 1, id: 1 }).toArray();
  } else {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    messages = await db.collection('mensagens').find({ conversa_id: id })
      .sort({ created_at: -1, id: -1 }).limit(limit).toArray();
    messages.reverse();
  }
  res.json({ mensagens: messages.map(serializarMensagem), server_time: new Date().toISOString() });
}));

router.post('/com/:outroId/mensagens', requireAuth, asyncRoute(async (req, res) => {
  const outroId = idParam(req.params.outroId, 'outroId');
  obrigatorio(req.body || {}, ['conteudo']);
  const conteudo = String(req.body.conteudo).trim();
  if (!conteudo) throw httpError(400, 'VALIDATION', 'conteudo vazio');

  const db = await getMongoDb();
  const other = await db.collection('usuarios').findOne({ id: outroId, deleted_at: null });
  if (!other) throw httpError(404, 'NOT_FOUND', 'Usuário destinatário não encontrado');
  if (other.role === req.user.role) throw httpError(403, 'FORBIDDEN', 'Conversa requer um cliente e um agricultor');

  const clienteId = req.user.role === 'cliente' ? req.user.id : other.id;
  const agricultorId = req.user.role === 'agricultor' ? req.user.id : other.id;
  const conversation = await getOuCriarConversa(db, clienteId, agricultorId);
  const now = new Date().toISOString();
  const id = await nextId('mensagens');
  const message = {
    _id: id, id, conversa_id: conversation.id, remetente_id: req.user.id,
    tipo: 'texto', conteudo, snapshot_json: null, carrinho_id: null, created_at: now,
  };
  await Promise.all([
    db.collection('mensagens').insertOne(message),
    db.collection('conversas').updateOne({ id: conversation.id }, { $set: { updated_at: now } }),
  ]);
  res.status(201).json({ conversa_id: conversation.id, mensagem: serializarMensagem(message) });
}));

router.post('/com/:agricultorId/snapshot', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const agricultorId = idParam(req.params.agricultorId, 'agricultor_id');
  const db = await getMongoDb();
  const farmer = await db.collection('usuarios').findOne({ id: agricultorId, role: 'agricultor', deleted_at: null });
  if (!farmer) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');

  const cart = await db.collection('carrinhos').findOne({
    cliente_id: req.user.id, agricultor_id: agricultorId, status: 'ativo',
  });
  if (!cart || !cart.itens?.length) throw httpError(400, 'CARRINHO_VAZIO', 'Carrinho está vazio');

  const productIds = [...new Set(cart.itens.map((item) => item.produto_id))];
  const products = await db.collection('produtos').find({ id: { $in: productIds } }).toArray();
  const productById = new Map(products.map((product) => [product.id, product]));
  const items = cart.itens.map((item) => {
    const product = productById.get(item.produto_id);
    if (!product) throw httpError(400, 'PRODUTO_INDISPONIVEL', `Produto ${item.produto_id} não encontrado`);
    const subtotal = item.quantidade * item.preco_unit;
    return {
      produto_id: item.produto_id,
      nome: product.nome,
      quantidade: item.quantidade,
      preco_unit: item.preco_unit,
      subtotal: Number(subtotal.toFixed(2)),
    };
  });
  const payload = {
    itens: items,
    total: Number(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)),
  };

  const conversation = await getOuCriarConversa(db, req.user.id, agricultorId);
  const id = await nextId('mensagens');
  const message = {
    _id: id, id, conversa_id: conversation.id, remetente_id: req.user.id,
    tipo: 'snapshot', conteudo: null, snapshot_json: payload, carrinho_id: cart.id,
    created_at: new Date().toISOString(),
  };
  await Promise.all([
    db.collection('mensagens').insertOne(message),
    db.collection('conversas').updateOne(
      { id: conversation.id },
      { $set: { updated_at: message.created_at } }
    ),
  ]);
  res.status(201).json({ conversa_id: conversation.id, mensagem: serializarMensagem(message) });
}));

module.exports = router;