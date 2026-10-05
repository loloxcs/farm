const express = require('express');
const { getMongoDb } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../utils/mongo-helpers');

const router = express.Router();

router.get('/categorias', asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  const items = await db.collection('categorias').find({}, { projection: { _id: 0, id: 1, nome: 1 } })
    .sort({ nome: 1 }).toArray();
  res.json(items);
}));

router.get('/formas-pagamento', requireAuth, asyncRoute(async (req, res) => {
  const db = await getMongoDb();
  const items = await db.collection('formas_pagamento').find({}, { projection: { _id: 0, id: 1, nome: 1 } })
    .sort({ id: 1 }).toArray();
  res.json(items);
}));

module.exports = router;