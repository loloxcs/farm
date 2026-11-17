const express = require('express');
const { getMongoDb } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { paginacao } = require('../utils/validacao');
const { httpError } = require('../middleware/error');
const { criarImagemSeNecessario } = require('../utils/imagens-mongo');
const { asyncRoute, idParam } = require('../utils/mongo-helpers');
const { METODOS, metodosAceitos, rotuloMetodo } = require('../utils/pagamentos');
const { prepararAtualizacaoEndereco, distanciaKm, temCoordenadas } = require('../utils/endereco');
const { usuarioAtualOpcional } = require('../middleware/auth');

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
      bairro: perfil.bairro ?? null,
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

/** Endereço completo — só para o próprio agricultor (o público vê bairro/cidade/UF). */
function enderecoCompleto(perfil = {}) {
  return {
    cep: perfil?.cep ?? null,
    logradouro: perfil?.logradouro ?? null,
    numero: perfil?.numero ?? null,
    complemento: perfil?.complemento ?? null,
    bairro: perfil?.bairro ?? null,
    cidade: perfil?.cidade ?? null,
    estado: perfil?.estado ?? null,
    latitude: perfil?.latitude ?? null,
    longitude: perfil?.longitude ?? null,
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

/**
 * GET /agricultores/proximos — agricultores ordenados do mais perto ao mais longe.
 * Origem: ?lat=&lng= (ex.: localização do navegador) ou, sem eles, o endereço
 * salvo do usuário logado. Opcionais: raio_km, limit (padrão 50, máx. 200).
 */
router.get('/proximos', usuarioAtualOpcional, asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  let origem = null;

  if (req.query.lat !== undefined || req.query.lng !== undefined) {
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw httpError(400, 'VALIDATION', 'lat/lng inválidos');
    }
    origem = { latitude, longitude, fonte: 'parametro' };
  } else if (req.user) {
    const eu = await db.collection('usuarios').findOne(
      { id: req.user.id, deleted_at: null },
      { projection: { role: 1, endereco: 1, perfil: 1 } }
    );
    const end = eu?.role === 'agricultor' ? eu?.perfil : eu?.endereco;
    if (temCoordenadas(end)) origem = { latitude: end.latitude, longitude: end.longitude, fonte: 'endereco' };
  }
  if (!origem) {
    throw httpError(400, 'SEM_LOCALIZACAO',
      'Cadastre seu endereço ou permita o uso da sua localização para ver os agricultores próximos.');
  }

  let raio = null;
  if (req.query.raio_km !== undefined && req.query.raio_km !== '') {
    raio = Number(req.query.raio_km);
    if (!Number.isFinite(raio) || raio <= 0) throw httpError(400, 'VALIDATION', 'raio_km deve ser positivo');
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

  const agricultores = await db.collection('usuarios').find(
    { role: 'agricultor', deleted_at: null },
    {
      projection: {
        _id: 0, id: 1, nome: 1, 'perfil.cidade': 1, 'perfil.estado': 1, 'perfil.bairro': 1,
        'perfil.latitude': 1, 'perfil.longitude': 1, 'perfil.foto_id': 1,
        'perfil.media_avaliacoes': 1, 'perfil.total_avaliacoes': 1, 'perfil.descricao': 1,
      },
    }
  ).toArray();

  let semLocalizacao = 0;
  const comDistancia = [];
  for (const user of agricultores) {
    if (req.user && user.id === req.user.id) continue;
    const p = user.perfil || {};
    if (!temCoordenadas(p)) { semLocalizacao += 1; continue; }
    const distancia = distanciaKm(origem, p);
    if (raio !== null && distancia > raio) continue;
    comDistancia.push({
      id: user.id,
      nome: user.nome,
      descricao: p.descricao ?? null,
      bairro: p.bairro ?? null,
      cidade: p.cidade ?? null,
      estado: p.estado ?? null,
      latitude: p.latitude,
      longitude: p.longitude,
      foto_id: p.foto_id ?? null,
      media_avaliacoes: p.media_avaliacoes ?? 0,
      total_avaliacoes: p.total_avaliacoes ?? 0,
      distancia_km: Math.round(distancia * 10) / 10,
    });
  }
  comDistancia.sort((a, b) => a.distancia_km - b.distancia_km || a.nome.localeCompare(b.nome));

  res.json({
    origem,
    items: comDistancia.slice(0, limit),
    total: comDistancia.length,
    sem_localizacao: semLocalizacao,
  });
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
  const profileFields = ['descricao', 'foto_id', 'formas_aceitas', 'chave_pix'];
  const db = await getMongoDb();
  const atual = await db.collection('usuarios').findOne(
    { id: req.user.id, role: 'agricultor', deleted_at: null },
    { projection: { perfil: 1 } }
  );
  if (!atual) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');
  // Endereço (cep, rua, número, bairro, cidade, UF) + latitude/longitude automáticas
  const { updates: updatesEndereco, geocodificado } = await prepararAtualizacaoEndereco(body, atual.perfil, 'perfil.');
  const updates = { updated_at: new Date().toISOString(), ...updatesEndereco };
  for (const field of userFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  for (const field of profileFields) {
    if (body[field] !== undefined) updates[`perfil.${field}`] = body[field];
  }

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
  res.json({
    ...perfilPublico(user),
    endereco: enderecoCompleto(user.perfil),
    geocodificado,
    recebimento: dadosRecebimento(user),
  });
}));

module.exports = router;