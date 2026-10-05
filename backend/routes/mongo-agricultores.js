const express = require('express');
const { getMongoDb } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { paginacao } = require('../utils/validacao');
const { httpError } = require('../middleware/error');
const { criarImagemSeNecessario } = require('../utils/imagens-mongo');
const { asyncRoute, idParam } = require('../utils/mongo-helpers');
const { METODOS, metodosAceitos, rotuloMetodo } = require('../utils/pagamentos');

const CHAVE_PIX_MAX = 140;

const router = express.Router();

function perfilPublico(usuario) {
  const perfil = usuario.perfil || {};
  return {
    id: usuario.id,
    nome: usuario.nome,
    telefone: usuario.telefone,
    perfil: {
      descricao: perfil.descricao ?? null,
      cidade: perfil.cidade ?? null,
      estado: perfil.estado ?? null,
      cep: perfil.cep ?? null,
      latitude: perfil.latitude ?? null,
      longitude: perfil.longitude ?? null,
      foto_id: perfil.foto_id ?? null,
      media_avaliacoes: perfil.media_avaliacoes ?? 0,
      total_avaliacoes: perfil.total_avaliacoes ?? 0,
      // Público: só QUAIS formas ele aceita. A chave PIX nunca sai por aqui.
      formas_aceitas: metodosAceitos(perfil).map((id) => ({ id, rotulo: rotuloMetodo(id) })),
    },
  };
}

/** Dados de recebimento — visíveis apenas para o próprio agricultor. */
function dadosRecebimento(usuario) {
  const perfil = usuario.perfil || {};
  return {
    formas_aceitas: metodosAceitos(perfil),
    chave_pix: perfil.chave_pix ?? null,
    metodos_disponiveis: Object.entries(METODOS).map(([id, metodo]) => ({ id, rotulo: metodo.rotulo })),
  };
}

router.get('/', asyncRoute(async (req, res) => {
  const { page, limit, offset } = paginacao(req.query);
  const filters = [{ role: 'agricultor', deleted_at: null }];
  const { q, cidade, estado } = req.query;

  if (estado && String(estado).length !== 2) {
    throw httpError(400, 'VALIDATION', 'estado deve ter 2 caracteres');
  }
  if (q) {
    const escaped = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filters.push({ $or: [{ nome: regex }, { 'perfil.descricao': regex }] });
  }
  if (cidade) filters.push({ 'perfil.cidade': cidade });
  if (estado) filters.push({ 'perfil.estado': estado });

  const db = await getMongoDb();
  const filter = { $and: filters };
  const collection = db.collection('usuarios');
  const [total, users] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter, {
      projection: {
        _id: 0, id: 1, nome: 1, 'perfil.cidade': 1, 'perfil.estado': 1,
        'perfil.media_avaliacoes': 1, 'perfil.total_avaliacoes': 1, 'perfil.foto_id': 1,
      },
    }).sort({ 'perfil.media_avaliacoes': -1, nome: 1 }).skip(offset).limit(limit).toArray(),
  ]);

  const items = users.map((user) => ({
    id: user.id,
    nome: user.nome,
    cidade: user.perfil?.cidade ?? null,
    estado: user.perfil?.estado ?? null,
    media_avaliacoes: user.perfil?.media_avaliacoes ?? 0,
    total_avaliacoes: user.perfil?.total_avaliacoes ?? 0,
    foto_id: user.perfil?.foto_id ?? null,
  }));
  res.json({ items, page, limit, total });
}));

router.get('/me/pagamento', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  const user = await db.collection('usuarios').findOne({ id: req.user.id, role: 'agricultor', deleted_at: null });
  if (!user) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');
  res.json(dadosRecebimento(user));
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const db = await getMongoDb();
  const user = await db.collection('usuarios').findOne({
    id, role: 'agricultor', deleted_at: null,
  });
  if (!user) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');
  res.json(perfilPublico(user));
}));

router.patch('/me', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (body.estado !== undefined && body.estado !== null && String(body.estado).length !== 2) {
    throw httpError(400, 'VALIDATION', 'estado deve ter 2 caracteres');
  }
  if (body.latitude !== undefined && body.latitude !== null) {
    const latitude = Number(body.latitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw httpError(400, 'VALIDATION', 'latitude fora de range');
    }
    body.latitude = latitude;
  }
  if (body.longitude !== undefined && body.longitude !== null) {
    const longitude = Number(body.longitude);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw httpError(400, 'VALIDATION', 'longitude fora de range');
    }
    body.longitude = longitude;
  }

  if (body.formas_aceitas !== undefined) {
    const formas = body.formas_aceitas;
    if (!Array.isArray(formas) || !formas.length || formas.some((metodo) => !METODOS[metodo])) {
      throw httpError(400, 'VALIDATION', 'formas_aceitas deve listar ao menos uma forma de pagamento válida', {
        aceitos: Object.keys(METODOS),
      });
    }
    body.formas_aceitas = [...new Set(formas)];
  }
  if (body.chave_pix !== undefined && body.chave_pix !== null) {
    const chave = String(body.chave_pix).trim();
    if (chave.length > CHAVE_PIX_MAX) {
      throw httpError(400, 'VALIDATION', `chave_pix deve ter até ${CHAVE_PIX_MAX} caracteres`);
    }
    body.chave_pix = chave || null;
  }

  if (body.foto_base64) body.foto_id = await criarImagemSeNecessario(body);
  const userFields = ['nome', 'telefone'];
  const profileFields = [
    'descricao', 'cidade', 'estado', 'cep', 'latitude', 'longitude', 'foto_id',
    'formas_aceitas', 'chave_pix',
  ];
  const updates = { updated_at: new Date().toISOString() };
  for (const field of userFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  for (const field of profileFields) {
    if (body[field] !== undefined) updates[`perfil.${field}`] = body[field];
  }

  const db = await getMongoDb();
  if (body.foto_id !== undefined && body.foto_id !== null && !body.foto_base64) {
    const image = await db.collection('imagens').findOne({ id: body.foto_id }, { projection: { _id: 1 } });
    if (!image) throw httpError(400, 'VALIDATION', 'foto_id inexistente');
  }
  const result = await db.collection('usuarios').updateOne(
    { id: req.user.id, role: 'agricultor', deleted_at: null },
    { $set: updates }
  );
  if (!result.matchedCount) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');
  const user = await db.collection('usuarios').findOne({ id: req.user.id });
  res.json({ ...perfilPublico(user), recebimento: dadosRecebimento(user) });
}));

module.exports = router;