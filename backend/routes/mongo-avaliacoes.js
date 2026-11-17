const express = require('express');
const { getMongoDb, nextId } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { obrigatorio, inteiroPositivo, paginacao } = require('../utils/validacao');
const { httpError } = require('../middleware/error');
const { asyncRoute, idParam, identidadePublica } = require('../utils/mongo-helpers');

const avaliacoes = express.Router();
const avaliacoesPorAgr = express.Router({ mergeParams: true });

avaliacoes.post('/', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  obrigatorio(body, ['agricultor_id', 'pedido_id', 'nota']);
  const agricultorId = inteiroPositivo(body.agricultor_id, 'agricultor_id');
  const pedidoId = inteiroPositivo(body.pedido_id, 'pedido_id');
  const nota = Number(body.nota);
  const comentario = body.comentario || null;
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    throw httpError(400, 'VALIDATION', 'nota deve ser inteiro entre 1 e 5');
  }

  const db = await getMongoDb();
  const farmer = await db.collection('usuarios').findOne({ id: agricultorId, role: 'agricultor', deleted_at: null });
  if (!farmer) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');
  const order = await db.collection('pedidos').findOne({ id: pedidoId });
  if (!order) throw httpError(404, 'NOT_FOUND', 'Pedido não encontrado');
  if (order.cliente_id !== req.user.id || order.agricultor_id !== agricultorId) {
    throw httpError(400, 'VALIDATION', 'Pedido não pertence a este par cliente-agricultor');
  }
  if (order.status !== 'entregue') throw httpError(400, 'VALIDATION', 'Só é possível avaliar pedidos entregues');

  const collection = db.collection('avaliacoes');
  let review = await collection.findOne({ cliente_id: req.user.id, agricultor_id: agricultorId });
  const now = new Date().toISOString();
  if (review) {
    await collection.updateOne(
      { _id: review._id },
      { $set: { pedido_id: pedidoId, nota, comentario, updated_at: now } }
    );
  } else {
    const id = await nextId('avaliacoes');
    const doc = {
      _id: id, id, cliente_id: req.user.id, agricultor_id: agricultorId,
      pedido_id: pedidoId, nota, comentario, created_at: now, updated_at: now,
    };
    try {
      await collection.insertOne(doc);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      await collection.updateOne(
        { cliente_id: req.user.id, agricultor_id: agricultorId },
        { $set: { pedido_id: pedidoId, nota, comentario, updated_at: now } }
      );
    }
  }

  const [saved, summary] = await Promise.all([
    collection.findOne({ cliente_id: req.user.id, agricultor_id: agricultorId }),
    collection.aggregate([
      { $match: { agricultor_id: agricultorId } },
      { $group: { _id: null, media: { $avg: '$nota' }, total: { $sum: 1 } } },
    ]).next(),
  ]);
  await db.collection('usuarios').updateOne(
    { id: agricultorId },
    { $set: {
      'perfil.media_avaliacoes': summary ? Number(summary.media.toFixed(2)) : 0,
      'perfil.total_avaliacoes': summary?.total || 0,
      'perfil.updated_at': now,
    } }
  );
  res.json({
    id: saved.id,
    cliente_id: saved.cliente_id,
    agricultor_id: saved.agricultor_id,
    pedido_id: saved.pedido_id,
    nota: saved.nota,
    comentario: saved.comentario,
    created_at: saved.created_at,
    updated_at: saved.updated_at,
  });
}));

/** GET /avaliacoes/minhas — avaliações que o cliente logado fez (só ele vê). */
avaliacoes.get('/minhas', requireAuth, requireRole('cliente'), asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  const reviews = await db.collection('avaliacoes').find({ cliente_id: req.user.id }, { projection: { _id: 0 } })
    .sort({ updated_at: -1, id: -1 }).toArray();
  const farmers = await db.collection('usuarios').find(
    { id: { $in: [...new Set(reviews.map((r) => r.agricultor_id))] } },
    { projection: { id: 1, nome: 1, role: 1, 'perfil.foto_id': 1 } }
  ).toArray();
  const byId = new Map(farmers.map((f) => [f.id, f]));
  res.json({
    items: reviews.map((r) => ({
      id: r.id,
      agricultor: { ...identidadePublica(byId.get(r.agricultor_id), 'Agricultor'), id: r.agricultor_id },
      pedido_id: r.pedido_id,
      nota: r.nota,
      comentario: r.comentario,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    total: reviews.length,
  });
}));

avaliacoesPorAgr.get('/', asyncRoute(async (req, res) => {
  const agricultorId = idParam(req.params.id, 'agricultor_id');
  const { page, limit, offset } = paginacao(req.query);
  const db = await getMongoDb();
  const farmer = await db.collection('usuarios').findOne(
    { id: agricultorId, role: 'agricultor', deleted_at: null },
    { projection: { perfil: 1 } }
  );
  if (!farmer) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');

  const collection = db.collection('avaliacoes');
  const [total, reviews] = await Promise.all([
    collection.countDocuments({ agricultor_id: agricultorId }),
    collection.find({ agricultor_id: agricultorId }, { projection: { _id: 0 } })
      .sort({ created_at: -1, id: -1 }).skip(offset).limit(limit).toArray(),
  ]);
  const users = await db.collection('usuarios').find({
    id: { $in: [...new Set(reviews.map((review) => review.cliente_id))] },
  }, { projection: { id: 1, nome: 1, role: 1, foto_id: 1 } }).toArray();
  const byId = new Map(users.map((user) => [user.id, user]));
  const items = reviews.map((review) => ({
    id: review.id,
    // Só nome e foto do cliente — endereço e histórico dele são privados.
    cliente: { ...identidadePublica(byId.get(review.cliente_id), 'Cliente'), id: review.cliente_id },
    nota: review.nota,
    comentario: review.comentario,
    created_at: review.created_at,
  }));
  res.json({
    items,
    page,
    limit,
    total,
    resumo: {
      media: farmer.perfil?.media_avaliacoes || 0,
      total: farmer.perfil?.total_avaliacoes || 0,
    },
  });
}));

module.exports = { avaliacoes, avaliacoesPorAgr };