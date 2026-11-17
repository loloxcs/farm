/**
 * Feiras livres.
 *
 * Uma feira é um LUGAR (nome + endereço + coordenadas). Vários agricultores
 * podem vender na mesma feira, cada um com os próprios dias e horários:
 *
 *   {
 *     id, nome, nome_normalizado,
 *     cep, logradouro, numero, complemento, bairro, cidade, estado,
 *     latitude, longitude, localizacao_fonte,
 *     participantes: [{ agricultor_id, horarios: [{ dia: 'sab', inicio: '07:00', fim: '12:00' }] }],
 *     criado_por, created_at, updated_at, deleted_at
 *   }
 *
 * Agrupamento: ao cadastrar uma feira que já existe (mesmo nome na mesma
 * cidade/UF, ou mesmo nome a menos de 500 m), o agricultor entra na feira
 * existente em vez de criar outra. Assim o mapa mostra um único ponto.
 *
 *   GET    /feiras                       público — lista (com distância se ?lat&lng)
 *   GET    /feiras/minhas                agricultor — feiras em que ele participa
 *   POST   /feiras                       agricultor — cria (ou entra na existente)
 *   PUT    /feiras/:id/participacao      agricultor — entra / atualiza seus horários
 *   DELETE /feiras/:id/participacao      agricultor — sai da feira
 *   PATCH  /feiras/:id                   agricultor participante — corrige nome/endereço
 */
const express = require('express');
const { getMongoDb, nextId } = require('../db/mongodb');
const { requireAuth, usuarioAtualOpcional } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { httpError } = require('../middleware/error');
const { asyncRoute, idParam, identidadePublica } = require('../utils/mongo-helpers');
const {
  CAMPOS_ENDERECO, normalizarEndereco, prepararAtualizacaoEndereco, distanciaKm, temCoordenadas,
} = require('../utils/endereco');

const router = express.Router();

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const NOME_MAX = 120;
const RAIO_MESMA_FEIRA_KM = 0.5;

function normalizarNome(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(feira|livre|de|da|do|das|dos)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function validarNome(nome) {
  const texto = String(nome || '').trim();
  if (!texto) throw httpError(400, 'VALIDATION', 'Informe o nome da feira');
  if (texto.length > NOME_MAX) throw httpError(400, 'VALIDATION', `nome deve ter até ${NOME_MAX} caracteres`);
  return texto;
}

/** Valida [{ dia, inicio, fim }]. Ordena por dia e horário; não aceita sobreposição no mesmo dia. */
function validarHorarios(horarios) {
  if (!Array.isArray(horarios) || !horarios.length) {
    throw httpError(400, 'VALIDATION', 'Informe ao menos um dia e horário na feira');
  }
  if (horarios.length > 14) throw httpError(400, 'VALIDATION', 'No máximo 14 horários por feira');
  const out = horarios.map((h) => {
    const dia = String(h?.dia || '').toLowerCase();
    const inicio = String(h?.inicio || '');
    const fim = String(h?.fim || '');
    if (!DIAS.includes(dia)) throw httpError(400, 'VALIDATION', 'dia inválido', { aceitos: DIAS });
    if (!HORA_RE.test(inicio) || !HORA_RE.test(fim)) throw httpError(400, 'VALIDATION', 'Horário deve estar no formato HH:MM');
    if (inicio >= fim) throw httpError(400, 'VALIDATION', 'O horário de início deve ser antes do fim');
    return { dia, inicio, fim };
  });
  out.sort((a, b) => DIAS.indexOf(a.dia) - DIAS.indexOf(b.dia) || a.inicio.localeCompare(b.inicio));
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].dia === out[i - 1].dia && out[i].inicio < out[i - 1].fim) {
      throw httpError(400, 'VALIDATION', 'Há horários sobrepostos no mesmo dia');
    }
  }
  return out;
}

/** Feira para resposta, com nome/foto dos agricultores (só isso — nada privado). */
function serializarFeira(feira, agricultoresPorId, origem) {
  const participantes = (feira.participantes || [])
    .map((p) => {
      const ag = agricultoresPorId.get(p.agricultor_id);
      if (!ag) return null; // conta removida
      return { agricultor: identidadePublica(ag, 'Agricultor'), horarios: p.horarios || [] };
    })
    .filter(Boolean)
    .sort((a, b) => a.agricultor.nome.localeCompare(b.agricultor.nome));
  const dias = [...new Set(participantes.flatMap((p) => p.horarios.map((h) => h.dia)))]
    .sort((a, b) => DIAS.indexOf(a) - DIAS.indexOf(b));
  const out = {
    id: feira.id,
    nome: feira.nome,
    cep: feira.cep ?? null,
    logradouro: feira.logradouro ?? null,
    numero: feira.numero ?? null,
    complemento: feira.complemento ?? null,
    bairro: feira.bairro ?? null,
    cidade: feira.cidade ?? null,
    estado: feira.estado ?? null,
    latitude: feira.latitude ?? null,
    longitude: feira.longitude ?? null,
    dias,
    participantes,
  };
  if (origem && temCoordenadas(feira)) out.distancia_km = Math.round(distanciaKm(origem, feira) * 10) / 10;
  return out;
}

async function carregarAgricultores(db, feiras) {
  const ids = [...new Set(feiras.flatMap((f) => (f.participantes || []).map((p) => p.agricultor_id)))];
  if (!ids.length) return new Map();
  const users = await db.collection('usuarios').find(
    { id: { $in: ids }, role: 'agricultor', deleted_at: null },
    { projection: { id: 1, nome: 1, role: 1, 'perfil.foto_id': 1 } }
  ).toArray();
  return new Map(users.map((u) => [u.id, u]));
}

async function feiraAtiva(db, id) {
  const feira = await db.collection('feiras').findOne({ id, deleted_at: null });
  if (!feira) throw httpError(404, 'NOT_FOUND', 'Feira não encontrada');
  return feira;
}

function participa(feira, agricultorId) {
  return (feira.participantes || []).some((p) => p.agricultor_id === agricultorId);
}

/** Procura uma feira já cadastrada que seja "a mesma" (para agrupar no mapa). */
async function acharFeiraIgual(db, { nome, cidade, estado, latitude, longitude }) {
  const alvo = normalizarNome(nome);
  if (!alvo) return null;
  const candidatas = await db.collection('feiras').find({ deleted_at: null }).toArray();
  return candidatas.find((f) => {
    if (normalizarNome(f.nome) !== alvo) return false;
    const mesmaCidade = cidade && f.cidade
      && normalizarNome(f.cidade) === normalizarNome(cidade)
      && (!estado || !f.estado || f.estado === estado);
    const perto = Number.isFinite(latitude) && temCoordenadas(f)
      && distanciaKm({ latitude, longitude }, f) <= RAIO_MESMA_FEIRA_KM;
    return mesmaCidade || perto;
  }) || null;
}

async function responderFeira(db, res, id, status = 200, extras = {}) {
  const feira = await db.collection('feiras').findOne({ id });
  const agricultores = await carregarAgricultores(db, [feira]);
  res.status(status).json({ ...serializarFeira(feira, agricultores), ...extras });
}

async function salvarParticipacao(db, feira, agricultorId, horarios) {
  const participantes = (feira.participantes || []).filter((p) => p.agricultor_id !== agricultorId);
  participantes.push({ agricultor_id: agricultorId, horarios });
  await db.collection('feiras').updateOne(
    { id: feira.id },
    { $set: { participantes, updated_at: new Date().toISOString() } }
  );
}

// ---------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------

/**
 * GET /feiras — público.
 * Query: lat, lng (ordena por distância), raio_km, q (nome), cidade, estado, agricultor_id.
 * Sem lat/lng mas logado, usa o endereço salvo do usuário para calcular a distância.
 */
router.get('/', usuarioAtualOpcional, asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  let origem = null;
  if (req.query.lat !== undefined || req.query.lng !== undefined) {
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw httpError(400, 'VALIDATION', 'lat/lng inválidos');
    }
    origem = { latitude, longitude };
  } else if (req.user) {
    const eu = await db.collection('usuarios').findOne({ id: req.user.id }, { projection: { role: 1, endereco: 1, perfil: 1 } });
    const end = eu?.role === 'agricultor' ? eu?.perfil : eu?.endereco;
    if (temCoordenadas(end)) origem = { latitude: end.latitude, longitude: end.longitude };
  }

  let feiras = await db.collection('feiras').find({ deleted_at: null }).toArray();
  feiras = feiras.filter((f) => (f.participantes || []).length);
  if (req.query.agricultor_id) {
    const agId = idParam(req.query.agricultor_id, 'agricultor_id');
    feiras = feiras.filter((f) => participa(f, agId));
  }
  if (req.query.q) {
    const q = normalizarNome(req.query.q) || String(req.query.q).toLowerCase();
    feiras = feiras.filter((f) => normalizarNome(f.nome).includes(q) || String(f.nome).toLowerCase().includes(q));
  }
  if (req.query.cidade) feiras = feiras.filter((f) => normalizarNome(f.cidade) === normalizarNome(req.query.cidade));
  if (req.query.estado) feiras = feiras.filter((f) => f.estado === String(req.query.estado).toUpperCase());

  const agricultores = await carregarAgricultores(db, feiras);
  let items = feiras.map((f) => serializarFeira(f, agricultores, origem)).filter((f) => f.participantes.length);
  if (origem) {
    if (req.query.raio_km) {
      const raio = Number(req.query.raio_km);
      if (!Number.isFinite(raio) || raio <= 0) throw httpError(400, 'VALIDATION', 'raio_km deve ser positivo');
      items = items.filter((f) => f.distancia_km !== undefined && f.distancia_km <= raio);
    }
    items.sort((a, b) => (a.distancia_km ?? Infinity) - (b.distancia_km ?? Infinity) || a.nome.localeCompare(b.nome));
  } else {
    items.sort((a, b) => a.nome.localeCompare(b.nome));
  }
  res.json({ origem, items, total: items.length });
}));

/** GET /feiras/minhas — feiras do agricultor logado, com os horários dele em `meus_horarios`. */
router.get('/minhas', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  const todas = await db.collection('feiras').find({ deleted_at: null }).toArray();
  const minhas = todas.filter((f) => participa(f, req.user.id));
  const agricultores = await carregarAgricultores(db, minhas);
  const items = minhas.map((f) => ({
    ...serializarFeira(f, agricultores),
    meus_horarios: f.participantes.find((p) => p.agricultor_id === req.user.id)?.horarios || [],
  })).sort((a, b) => a.nome.localeCompare(b.nome));
  res.json({ items, total: items.length });
}));

/**
 * POST /feiras — agricultor cadastra uma feira em que vende.
 * Body: { nome, cep, logradouro, numero, complemento, bairro, cidade, estado,
 *         latitude?, longitude?, horarios: [{ dia, inicio, fim }] }
 * Se a feira já existir (mesmo nome na mesma cidade ou a < 500 m), entra nela:
 * resposta 200 com `agrupada: true`. Senão cria: 201 com `agrupada: false`.
 */
router.post('/', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const nome = validarNome(body.nome);
  const horarios = validarHorarios(body.horarios);
  const endereco = normalizarEndereco(body);
  if (!endereco.cidade) throw httpError(400, 'VALIDATION', 'Informe a cidade da feira');

  const db = await getMongoDb();
  // Coordenadas: as enviadas (ex.: "estou na feira agora") ou calculadas pelo endereço.
  const { updates } = await prepararAtualizacaoEndereco({ ...body, cidade: endereco.cidade }, {}, '');

  const existente = await acharFeiraIgual(db, {
    nome, cidade: endereco.cidade, estado: endereco.estado, latitude: updates.latitude, longitude: updates.longitude,
  });
  if (existente) {
    await salvarParticipacao(db, existente, req.user.id, horarios);
    return responderFeira(db, res, existente.id, 200, { agrupada: true });
  }

  const now = new Date().toISOString();
  const id = await nextId('feiras');
  const feira = {
    _id: id,
    id,
    nome,
    nome_normalizado: normalizarNome(nome),
    ...Object.fromEntries(CAMPOS_ENDERECO.map((c) => [c, endereco[c] ?? null])),
    latitude: updates.latitude ?? null,
    longitude: updates.longitude ?? null,
    localizacao_fonte: updates.localizacao_fonte ?? null,
    participantes: [{ agricultor_id: req.user.id, horarios }],
    criado_por: req.user.id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await db.collection('feiras').insertOne(feira);
  return responderFeira(db, res, id, 201, { agrupada: false });
}));

/** PUT /feiras/:id/participacao — entra numa feira existente ou troca os próprios horários. */
router.put('/:id/participacao', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const horarios = validarHorarios(req.body?.horarios);
  const db = await getMongoDb();
  const feira = await feiraAtiva(db, id);
  await salvarParticipacao(db, feira, req.user.id, horarios);
  return responderFeira(db, res, id);
}));

/** DELETE /feiras/:id/participacao — sai da feira. Sem ninguém, a feira some do mapa. */
router.delete('/:id/participacao', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const db = await getMongoDb();
  const feira = await feiraAtiva(db, id);
  if (!participa(feira, req.user.id)) throw httpError(404, 'NOT_FOUND', 'Você não participa desta feira');
  const participantes = feira.participantes.filter((p) => p.agricultor_id !== req.user.id);
  const now = new Date().toISOString();
  await db.collection('feiras').updateOne({ id }, {
    $set: { participantes, updated_at: now, ...(participantes.length ? {} : { deleted_at: now }) },
  });
  res.json({ ok: true, feira_removida: !participantes.length });
}));

/** PATCH /feiras/:id — qualquer agricultor que vende lá pode corrigir nome e endereço. */
router.patch('/:id', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const body = req.body || {};
  const db = await getMongoDb();
  const feira = await feiraAtiva(db, id);
  if (!participa(feira, req.user.id)) throw httpError(403, 'FORBIDDEN', 'Só quem vende nesta feira pode editá-la');

  const { updates } = await prepararAtualizacaoEndereco(body, feira, '');
  if (body.nome !== undefined) {
    updates.nome = validarNome(body.nome);
    updates.nome_normalizado = normalizarNome(updates.nome);
  }
  if (updates.cidade === null) throw httpError(400, 'VALIDATION', 'Informe a cidade da feira');
  await db.collection('feiras').updateOne({ id }, { $set: { ...updates, updated_at: new Date().toISOString() } });
  return responderFeira(db, res, id);
}));

module.exports = router;
module.exports.DIAS = DIAS;
