const express = require('express');
const jwt = require('jsonwebtoken');
const { getMongoDb, nextId } = require('../db/mongodb');
const { hashSenha, verificarSenha } = require('../utils/senha');
const { obrigatorio, exigirEmail, exigirSenhaMinima, emEnum } = require('../utils/validacao');
const { httpError } = require('../middleware/error');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, usuarioPublico, enderecoDoUsuario } = require('../utils/mongo-helpers');
const { prepararAtualizacaoEndereco } = require('../utils/endereco');
const { criarImagemSeNecessario } = require('../utils/imagens-mongo');

const router = express.Router();

function gerarToken(usuario) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurada');
  return jwt.sign(
    { sub: usuario.id, role: usuario.role, nome: usuario.nome },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '240h' }
  );
}

router.post('/register', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const { nome, email, senha, role, telefone } = body;
  obrigatorio(body, ['nome', 'email', 'senha', 'role']);
  exigirEmail(email);
  exigirSenhaMinima(senha);
  emEnum(role, 'role', ['cliente', 'agricultor']);

  const db = await getMongoDb();
  const existing = await db.collection('usuarios').findOne({ email, deleted_at: null });
  if (existing) throw httpError(409, 'EMAIL_EM_USO', 'Email já cadastrado');

  const usuario = {
    _id: await nextId('usuarios'),
    nome,
    email,
    senha_hash: await hashSenha(senha),
    role,
    telefone: telefone || null,
    endereco: role === 'cliente' ? {} : null,
    perfil: role === 'agricultor' ? {
      descricao: null,
      cidade: null,
      estado: null,
      cep: null,
      latitude: null,
      longitude: null,
      foto_id: null,
      media_avaliacoes: 0,
      total_avaliacoes: 0,
    } : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };
  usuario.id = usuario._id;

  try {
    await db.collection('usuarios').insertOne(usuario);
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'EMAIL_EM_USO', 'Email já cadastrado');
    throw error;
  }

  const token = gerarToken(usuario);
  res.status(201).json({
    token,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
  });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const { email, senha } = req.body || {};
  obrigatorio(req.body || {}, ['email', 'senha']);
  const db = await getMongoDb();
  const usuario = await db.collection('usuarios').findOne({ email, deleted_at: null });
  const erroCredenciais = httpError(401, 'CREDENCIAIS_INVALIDAS', 'Email ou senha inválidos');
  if (!usuario || !await verificarSenha(senha, usuario.senha_hash)) throw erroCredenciais;
  const token = gerarToken(usuario);
  res.json({ token, usuario: usuarioPublico(usuario) });
}));

router.post('/logout', requireAuth, (req, res) => res.json({ ok: true }));

router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  const usuario = await db.collection('usuarios').findOne(
    { _id: req.user.id, deleted_at: null },
    { projection: { senha_hash: 0 } }
  );
  if (!usuario) throw httpError(401, 'UNAUTHORIZED', 'Usuário não encontrado');
  res.json(usuarioPublico(usuario));
}));

/**
 * PATCH /auth/me — dados básicos do próprio usuário: nome, telefone e foto
 * (foto_base64 + foto_mime, ou foto_id: null para remover).
 * O agricultor continua editando o perfil completo em PATCH /agricultores/me.
 */
router.patch('/me', requireAuth, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const db = await getMongoDb();
  const usuario = await db.collection('usuarios').findOne({ _id: req.user.id, deleted_at: null });
  if (!usuario) throw httpError(401, 'UNAUTHORIZED', 'Usuário não encontrado');

  const updates = { updated_at: new Date().toISOString() };
  if (body.nome !== undefined) {
    const nome = String(body.nome || '').trim();
    if (!nome) throw httpError(400, 'VALIDATION', 'Informe o nome');
    if (nome.length > 120) throw httpError(400, 'VALIDATION', 'nome deve ter até 120 caracteres');
    updates.nome = nome;
  }
  if (body.telefone !== undefined) {
    const tel = body.telefone === null ? '' : String(body.telefone).trim();
    if (tel.length > 30) throw httpError(400, 'VALIDATION', 'telefone deve ter até 30 caracteres');
    updates.telefone = tel || null;
  }
  const campoFoto = usuario.role === 'agricultor' ? 'perfil.foto_id' : 'foto_id';
  if (body.foto_base64) updates[campoFoto] = await criarImagemSeNecessario(body);
  else if (body.foto_id === null) updates[campoFoto] = null;

  await db.collection('usuarios').updateOne({ _id: usuario._id }, { $set: updates });
  const atualizado = await db.collection('usuarios').findOne({ _id: usuario._id });
  res.json(usuarioPublico(atualizado));
}));

/**
 * PATCH /auth/me/endereco — salva o endereço do usuário logado (cliente ou agricultor).
 * Body: { cep, logradouro, numero, complemento, bairro, cidade, estado } e,
 * opcionalmente, { latitude, longitude } (ex.: "usar minha localização").
 * Sem latitude/longitude, elas são calculadas a partir do endereço (OpenStreetMap).
 */
router.patch('/me/endereco', requireAuth, asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  const usuario = await db.collection('usuarios').findOne({ _id: req.user.id, deleted_at: null });
  if (!usuario) throw httpError(401, 'UNAUTHORIZED', 'Usuário não encontrado');

  const prefixo = usuario.role === 'agricultor' ? 'perfil.' : 'endereco.';
  const atual = usuario.role === 'agricultor' ? usuario.perfil : usuario.endereco;
  const { updates, geocodificado } = await prepararAtualizacaoEndereco(req.body || {}, atual, prefixo);

  // Cliente antigo pode ter `endereco: null` — o Mongo não cria subcampos dentro de null.
  if (usuario.role !== 'agricultor' && !usuario.endereco) {
    await db.collection('usuarios').updateOne({ _id: usuario._id }, { $set: { endereco: {} } });
  }
  await db.collection('usuarios').updateOne(
    { _id: usuario._id },
    { $set: { ...updates, updated_at: new Date().toISOString() } }
  );
  const atualizado = await db.collection('usuarios').findOne({ _id: usuario._id });
  res.json({ endereco: enderecoDoUsuario(atualizado), geocodificado });
}));

module.exports = router;