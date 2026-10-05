const express = require('express');
const { getMongoDb, nextId } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const {
  obrigatorio, numeroNaoNegativo, inteiroPositivo, emEnum, paginacao,
} = require('../utils/validacao');
const { httpError } = require('../middleware/error');
const { criarImagemSeNecessario } = require('../utils/imagens-mongo');
const { asyncRoute, idParam } = require('../utils/mongo-helpers');

const produtos = express.Router();
const produtosPorAgr = express.Router({ mergeParams: true });
const imagens = express.Router();
const UNIDADES = ['un', 'kg', 'g', 'L', 'mL', 'dz', 'cx', 'mç'];

async function produtoCompleto(db, product) {
  if (!product) return null;
  const category = await db.collection('categorias').findOne({ id: product.categoria_id });
  if (!category) return null;
  return {
    id: product.id,
    agricultor_id: product.agricultor_id,
    nome: product.nome,
    descricao: product.descricao,
    preco: product.preco,
    unidade: product.unidade,
    estoque: product.estoque,
    foto_id: product.foto_id,
    categoria: { id: category.id, nome: category.nome },
  };
}

produtosPorAgr.get('/', asyncRoute(async (req, res) => {
  const agricultorId = idParam(req.params.id, 'agricultor_id');
  const { page, limit, offset } = paginacao(req.query);
  const db = await getMongoDb();
  const farmer = await db.collection('usuarios').findOne(
    { id: agricultorId, role: 'agricultor', deleted_at: null },
    { projection: { _id: 1 } }
  );
  if (!farmer) throw httpError(404, 'NOT_FOUND', 'Agricultor não encontrado');

  const filter = { agricultor_id: agricultorId, deleted_at: null };
  if (req.query.categoria_id) filter.categoria_id = inteiroPositivo(req.query.categoria_id, 'categoria_id');
  const collection = db.collection('produtos');
  const [total, products] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter, { projection: { _id: 0 } })
      .sort({ nome: 1 }).skip(offset).limit(limit).toArray(),
  ]);
  const categories = new Map((await db.collection('categorias').find({
    id: { $in: [...new Set(products.map((item) => item.categoria_id))] },
  }).toArray()).map((category) => [category.id, category]));
  const items = products.map((product) => {
    const category = categories.get(product.categoria_id);
    return {
      id: product.id,
      nome: product.nome,
      descricao: product.descricao,
      preco: product.preco,
      unidade: product.unidade,
      estoque: product.estoque,
      foto_id: product.foto_id,
      categoria: category ? { id: category.id, nome: category.nome } : null,
    };
  });
  res.json({ items, page, limit, total });
}));

produtos.post('/', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  obrigatorio(body, ['nome', 'preco', 'unidade', 'categoria_id']);
  const preco = numeroNaoNegativo(body.preco, 'preco');
  const estoque = body.estoque !== undefined ? numeroNaoNegativo(body.estoque, 'estoque') : 0;
  const categoriaId = inteiroPositivo(body.categoria_id, 'categoria_id');
  emEnum(body.unidade, 'unidade', UNIDADES);

  const db = await getMongoDb();
  if (!await db.collection('categorias').findOne({ id: categoriaId })) {
    throw httpError(400, 'VALIDATION', 'categoria inexistente');
  }
  let fotoId = body.foto_id ?? null;
  if (fotoId === null) fotoId = await criarImagemSeNecessario(body);
  else if (!await db.collection('imagens').findOne({ id: fotoId }, { projection: { _id: 1 } })) {
    throw httpError(400, 'VALIDATION', 'foto_id inexistente');
  }

  const id = await nextId('produtos');
  const now = new Date().toISOString();
  const product = {
    _id: id,
    id,
    agricultor_id: req.user.id,
    categoria_id: categoriaId,
    nome: body.nome,
    descricao: body.descricao || null,
    preco,
    unidade: body.unidade,
    estoque,
    foto_id: fotoId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await db.collection('produtos').insertOne(product);
  res.status(201).json(await produtoCompleto(db, product));
}));

produtos.patch('/:id', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const body = req.body || {};
  const db = await getMongoDb();
  const collection = db.collection('produtos');
  const product = await collection.findOne({ id, deleted_at: null });
  if (!product) throw httpError(404, 'NOT_FOUND', 'Produto não encontrado');
  if (product.agricultor_id !== req.user.id) {
    throw httpError(403, 'FORBIDDEN', 'Produto não pertence ao agricultor logado');
  }

  if (body.preco !== undefined) body.preco = numeroNaoNegativo(body.preco, 'preco');
  if (body.estoque !== undefined) body.estoque = numeroNaoNegativo(body.estoque, 'estoque');
  if (body.categoria_id !== undefined) {
    body.categoria_id = inteiroPositivo(body.categoria_id, 'categoria_id');
    if (!await db.collection('categorias').findOne({ id: body.categoria_id })) {
      throw httpError(400, 'VALIDATION', 'categoria inexistente');
    }
  }
  if (body.unidade !== undefined) emEnum(body.unidade, 'unidade', UNIDADES);
  if (body.foto_base64) body.foto_id = await criarImagemSeNecessario(body);
  else if (body.foto_id !== undefined && body.foto_id !== null
    && !await db.collection('imagens').findOne({ id: body.foto_id }, { projection: { _id: 1 } })) {
    throw httpError(400, 'VALIDATION', 'foto_id inexistente');
  }

  const fields = ['nome', 'descricao', 'preco', 'unidade', 'estoque', 'categoria_id', 'foto_id'];
  const updates = { updated_at: new Date().toISOString() };
  for (const field of fields) if (body[field] !== undefined) updates[field] = body[field];
  await collection.updateOne({ id }, { $set: updates });
  res.json(await produtoCompleto(db, await collection.findOne({ id })));
}));

produtos.delete('/:id', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const db = await getMongoDb();
  const product = await db.collection('produtos').findOne({ id, deleted_at: null });
  if (!product) throw httpError(404, 'NOT_FOUND', 'Produto não encontrado');
  if (product.agricultor_id !== req.user.id) {
    throw httpError(403, 'FORBIDDEN', 'Produto não pertence ao agricultor logado');
  }
  await db.collection('produtos').updateOne({ id }, { $set: { deleted_at: new Date().toISOString() } });
  res.json({ ok: true });
}));

imagens.get('/:id', asyncRoute(async (req, res) => {
  const id = idParam(req.params.id);
  const db = await getMongoDb();
  const image = await db.collection('imagens').findOne({ id });
  if (!image) throw httpError(404, 'NOT_FOUND', 'Imagem não encontrada');
  res.set('Content-Type', image.mime_type || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('ETag', `"img-${id}"`);
  res.send(image.dados.buffer || image.dados);
}));

module.exports = { produtos, produtosPorAgr, imagens };