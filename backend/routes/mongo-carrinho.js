const express = require('express');
const { getMongoDb, nextId } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { obrigatorio, numeroPositivo, inteiroPositivo } = require('../utils/validacao');
const { httpError } = require('../middleware/error');
const { asyncRoute, idParam } = require('../utils/mongo-helpers');

const router = express.Router();

async function agricultorAtivo(db, id) {
  return db.collection('usuarios').findOne(
    { id, role: 'agricultor', deleted_at: null },
    { projection: { _id: 1 } }
  );
}

async function carrinhoAtivo(db, clienteId, agricultorId, criar = false) {
  const collection = db.collection('carrinhos');
  let cart = await collection.findOne({ cliente_id: clienteId, agricultor_id: agricultorId, status: 'ativo' });
  if (cart || !criar) return cart;

  const id = await nextId('carrinhos');
  const now = new Date().toISOString();
  const candidate = {
    _id: id,
    id,
    cliente_id: clienteId,
    agricultor_id: agricultorId,
    status: 'ativo',
    itens: [],
    created_at: now,
    updated_at: now,
  };
  try {
    await collection.insertOne(candidate);
    return candidate;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    cart = await collection.findOne({ cliente_id: clienteId, agricultor_id: agricultorId, status: 'ativo' });
    if (!cart) throw error;
    return cart;
  }
}

async function montarResposta(db, cart, agricultorId) {
  const products = await db.collection('produtos').find({
    id: { $in: (cart.itens || []).map((item) => item.produto_id) },
  }).toArray();
  const productById = new Map(products.map((product) => [product.id, product]));
  const itens = (cart.itens || []).map((item) => {
    const product = productById.get(item.produto_id);
    return {
      id: item.id,
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      preco_unit: item.preco_unit,
      nome: product?.nome || 'Produto indisponível',
      subtotal: item.quantidade * item.preco_unit,
    };
  });
  const total = itens.reduce((sum, item) => sum + item.subtotal, 0);
  return {
    id: cart.id,
    agricultor_id: agricultorId,
    status: cart.status,
    itens,
    total: Number(total.toFixed(2)),
  };
}

router.get('/:agricultorId', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const agricultorId = idParam(req.params.agricultorId, 'agricultor_id');
  const db = await getMongoDb();
  if (!await agricultorAtivo(db, agricultorId)) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');
  const cart = await carrinhoAtivo(db, req.user.id, agricultorId);
  if (!cart) return res.json({ id: null, agricultor_id: agricultorId, status: 'ativo', itens: [], total: 0 });
  res.json(await montarResposta(db, cart, agricultorId));
}));

router.post('/:agricultorId/itens', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const agricultorId = idParam(req.params.agricultorId, 'agricultor_id');
  obrigatorio(req.body || {}, ['produto_id', 'quantidade']);
  const productId = inteiroPositivo(req.body.produto_id, 'produto_id');
  const quantity = numeroPositivo(req.body.quantidade, 'quantidade');
  const db = await getMongoDb();
  if (!await agricultorAtivo(db, agricultorId)) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');
  const product = await db.collection('produtos').findOne({ id: productId, deleted_at: null });
  if (!product) throw httpError(404, 'NOT_FOUND', 'Produto não encontrado');
  if (product.agricultor_id !== agricultorId) {
    throw httpError(400, 'VALIDATION', 'Produto não pertence a este agricultor');
  }

  const cart = await carrinhoAtivo(db, req.user.id, agricultorId, true);
  const existing = (cart.itens || []).find((item) => item.produto_id === productId);
  const now = new Date().toISOString();
  if (existing) {
    await db.collection('carrinhos').updateOne(
      { id: cart.id, 'itens.id': existing.id },
      { $inc: { 'itens.$.quantidade': quantity }, $set: { 'itens.$.preco_unit': product.preco, updated_at: now } }
    );
  } else {
    const item = {
      id: await nextId('itens_carrinho'),
      produto_id: productId,
      quantidade: quantity,
      preco_unit: product.preco,
      updated_at: now,
    };
    await db.collection('carrinhos').updateOne({ id: cart.id }, { $push: { itens: item }, $set: { updated_at: now } });
  }
  const updated = await db.collection('carrinhos').findOne({ id: cart.id });
  res.json(await montarResposta(db, updated, agricultorId));
}));

router.patch('/:agricultorId/itens/:itemId', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const agricultorId = idParam(req.params.agricultorId, 'agricultor_id');
  const itemId = idParam(req.params.itemId, 'item_id');
  obrigatorio(req.body || {}, ['quantidade']);
  const quantity = numeroPositivo(req.body.quantidade, 'quantidade');
  const db = await getMongoDb();
  const cart = await db.collection('carrinhos').findOne({
    cliente_id: req.user.id,
    agricultor_id: agricultorId,
    status: 'ativo',
    'itens.id': itemId,
  });
  if (!cart) throw httpError(404, 'NOT_FOUND', 'Item não encontrado');
  await db.collection('carrinhos').updateOne(
    { id: cart.id, 'itens.id': itemId },
    { $set: { 'itens.$.quantidade': quantity, 'itens.$.updated_at': new Date().toISOString(), updated_at: new Date().toISOString() } }
  );
  res.json(await montarResposta(db, await db.collection('carrinhos').findOne({ id: cart.id }), agricultorId));
}));

router.delete('/:agricultorId/itens/:itemId', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const agricultorId = idParam(req.params.agricultorId, 'agricultor_id');
  const itemId = idParam(req.params.itemId, 'item_id');
  const db = await getMongoDb();
  const cart = await db.collection('carrinhos').findOne({
    cliente_id: req.user.id,
    agricultor_id: agricultorId,
    'itens.id': itemId,
  });
  if (!cart) throw httpError(404, 'NOT_FOUND', 'Item não encontrado');
  await db.collection('carrinhos').updateOne(
    { id: cart.id },
    { $pull: { itens: { id: itemId } }, $set: { updated_at: new Date().toISOString() } }
  );
  res.json(await montarResposta(db, await db.collection('carrinhos').findOne({ id: cart.id }), agricultorId));
}));

router.delete('/:agricultorId', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const agricultorId = idParam(req.params.agricultorId, 'agricultor_id');
  const db = await getMongoDb();
  const cart = await db.collection('carrinhos').findOne({
    cliente_id: req.user.id, agricultor_id: agricultorId, status: 'ativo',
  });
  if (!cart) throw httpError(404, 'NOT_FOUND', 'Carrinho ativo não encontrado');
  await db.collection('carrinhos').updateOne(
    { id: cart.id },
    { $set: { itens: [], updated_at: new Date().toISOString() } }
  );
  res.json({ ok: true });
}));

module.exports = router;