const crypto = require('node:crypto');
const express = require('express');
const db = require('../db/connection');
const { getMongoDb } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { httpError } = require('../middleware/error');

const router = express.Router();
const METODOS = ['pix', 'credit_card', 'debit_card', 'cash'];
const METODOS_VALIDOS = new Set(METODOS);

function carregarPedidoDoCliente(id, clienteId) {
  const pedido = db.prepare(`
    SELECT id, cliente_id, agricultor_id, status, total
    FROM pedidos WHERE id = ?
  `).get(id);

  if (!pedido) throw httpError(404, 'NOT_FOUND', 'Pedido não encontrado');
  if (pedido.cliente_id !== clienteId) {
    throw httpError(403, 'FORBIDDEN', 'Você não é o cliente deste pedido');
  }
  return pedido;
}

function serializarPagamento(pagamento) {
  if (!pagamento) return null;
  return {
    pedido_id: pagamento.pedido_id,
    metodo: pagamento.metodo,
    cartao_ultimos4: pagamento.cartao_ultimos4 || null,
    valor: pagamento.valor,
    status: pagamento.status,
    transacao_id: pagamento.transacao_id,
    created_at: pagamento.created_at,
  };
}

async function collectionPagamentos() {
  if (!process.env.MONGO_URI) {
    throw httpError(503, 'MONGO_NAO_CONFIGURADO', 'Configure MONGO_URI para usar pagamentos.');
  }

  try {
    const mongoDb = await getMongoDb();
    const collection = mongoDb.collection('pagamentos');
    await collection.createIndex({ pedido_id: 1 }, { unique: true });
    return collection;
  } catch {
    throw httpError(503, 'MONGO_INDISPONIVEL', 'Não foi possível acessar o MongoDB.');
  }
}

router.get('/:pedidoId/pagamento', requireAuth, requireRole('cliente'), async (req, res, next) => {
  try {
    const pedidoId = Number.parseInt(req.params.pedidoId, 10);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      throw httpError(400, 'VALIDATION', 'ID do pedido inválido');
    }

    carregarPedidoDoCliente(pedidoId, req.user.id);
    const collection = await collectionPagamentos();
    const pagamento = await collection.findOne({ pedido_id: pedidoId });
    res.json({ pagamento: serializarPagamento(pagamento) });
  } catch (error) {
    next(error);
  }
});

router.post('/:pedidoId/pagamento', requireAuth, requireRole('cliente'), async (req, res, next) => {
  try {
    const pedidoId = Number.parseInt(req.params.pedidoId, 10);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      throw httpError(400, 'VALIDATION', 'ID do pedido inválido');
    }

    const pedido = carregarPedidoDoCliente(pedidoId, req.user.id);
    if (!['confirmado', 'entregue'].includes(pedido.status)) {
      throw httpError(409, 'PEDIDO_NAO_PAGAVEL', 'O pagamento fica disponível após a confirmação do pedido.');
    }

    const metodo = req.body?.metodo;
    if (!METODOS_VALIDOS.has(metodo)) {
      throw httpError(400, 'VALIDATION', 'Método de pagamento inválido');
    }

    const dadosPagamento = {
      pedido_id: pedido.id,
      cliente_id: pedido.cliente_id,
      agricultor_id: pedido.agricultor_id,
      metodo,
      cartao_ultimos4: null,
      valor: pedido.total,
      status: 'aprovado',
      transacao_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };

    if (metodo === 'credit_card' || metodo === 'debit_card') {
      const ultimos4 = String(req.body?.cartao_ultimos4 || '');
      if (!/^\d{4}$/.test(ultimos4)) {
        throw httpError(400, 'VALIDATION', 'Informe os quatro últimos dígitos do cartão');
      }
      dadosPagamento.cartao_ultimos4 = ultimos4;
    }

    const collection = await collectionPagamentos();
    try {
      const resultado = await collection.insertOne(dadosPagamento);
      res.status(201).json({ pagamento: serializarPagamento({ ...dadosPagamento, _id: resultado.insertedId }) });
    } catch (error) {
      if (error?.code === 11000) {
        throw httpError(409, 'PAGAMENTO_JA_REGISTRADO', 'Este pedido já possui um pagamento registrado.');
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;