/**
 * Copia os dados do antigo banco local (database.sqlite) para o MongoDB.
 *
 * Roda UMA vez: ao terminar grava um marcador em `_migrations` e nunca mais
 * mexe em nada. Não apaga o arquivo SQLite e se recusa a rodar se o MongoDB
 * já tiver dados (para não misturar nem duplicar).
 *
 *   npm run db:migrate    → migra e mostra erro se algo impedir
 *   npm run db:setup      → chama com { auto: true }: se não houver o que
 *                           migrar, apenas avisa e segue em frente
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  getMongoDb, getMongoClient, closeMongo, initializeMongo, explicarErroMongo,
} = require('./mongodb');

const DB_PATH = process.env.DB_PATH || './database.sqlite';
const sqlitePath = path.resolve(__dirname, '..', DB_PATH);
const MIGRATION_ID = 'sqlite-to-mongodb-v1';
const TARGETS = [
  'usuarios', 'imagens', 'categorias', 'formas_pagamento', 'produtos',
  'carrinhos', 'conversas', 'mensagens', 'pedidos', 'avaliacoes',
];

function rows(sqlite, query) {
  return sqlite.prepare(query).all();
}

function groupBy(items, key) {
  const grouped = new Map();
  for (const item of items) {
    const group = grouped.get(item[key]) || [];
    group.push(item);
    grouped.set(item[key], group);
  }
  return grouped;
}

function profileDocument(profile) {
  if (!profile) return null;
  return {
    descricao: profile.descricao,
    cidade: profile.cidade,
    estado: profile.estado,
    cep: profile.cep,
    latitude: profile.latitude,
    longitude: profile.longitude,
    foto_id: profile.foto_id,
    media_avaliacoes: profile.media_avaliacoes,
    total_avaliacoes: profile.total_avaliacoes,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

/**
 * @param {{ auto?: boolean }} [opcoes] auto=true: situações em que não há o que
 *        migrar viram um aviso (retorna { migrado:false, motivo }) em vez de erro.
 * @returns {Promise<{ migrado: boolean, motivo?: string, contagens?: object }>}
 */
async function migrate({ auto = false } = {}) {
  const pular = (motivo) => {
    if (!auto) throw new Error(motivo);
    return { migrado: false, motivo };
  };

  const mongo = await getMongoDb();
  const client = await getMongoClient();
  if (await mongo.collection('_migrations').findOne({ _id: MIGRATION_ID })) {
    return { migrado: false, motivo: 'A migração do SQLite já foi feita antes. Nenhum dado alterado.' };
  }

  if (!fs.existsSync(sqlitePath)) {
    return pular(`Não há banco local para migrar (${path.basename(sqlitePath)} não existe).`);
  }
  let sqlite;
  try {
    // Só é carregado aqui: o servidor não depende mais do SQLite.
    const Database = require('better-sqlite3');
    sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    return pular(`Não foi possível abrir o banco local (${error.code || error.message}). Rode "npm install" no backend e depois "npm run db:migrate".`);
  }

  try {
    const categories = rows(sqlite, 'SELECT * FROM categorias');
    const paymentForms = rows(sqlite, 'SELECT * FROM formas_pagamento');
    const seededCatalogs = new Map();
    for (const [name, sourceRows] of [['categorias', categories], ['formas_pagamento', paymentForms]]) {
      const existing = await mongo.collection(name).find({}, { projection: { _id: 0, id: 1, nome: 1 } }).toArray();
      if (existing.length) {
        const byId = new Map(existing.map((item) => [item.id, item.nome]));
        if (existing.length !== sourceRows.length || sourceRows.some((item) => byId.get(item.id) !== item.nome)) {
          return pular(`Migração cancelada: o catálogo ${name} do MongoDB difere do SQLite.`);
        }
        seededCatalogs.set(name, true);
      }
    }

    const occupied = [];
    for (const name of TARGETS.filter((collection) => !['categorias', 'formas_pagamento'].includes(collection))) {
      if (await mongo.collection(name).countDocuments()) occupied.push(name);
    }
    if (occupied.length) {
      return pular(`O MongoDB já tem dados (${occupied.join(', ')}); a cópia do SQLite foi ignorada para não misturar nem duplicar registros.`);
    }

    const users = rows(sqlite, 'SELECT * FROM usuarios');
    const profiles = new Map(rows(sqlite, 'SELECT * FROM perfis_agricultor').map((row) => [row.usuario_id, row]));
    const images = rows(sqlite, 'SELECT * FROM imagens');
    const products = rows(sqlite, 'SELECT * FROM produtos');
    const carts = rows(sqlite, 'SELECT * FROM carrinhos');
    const cartItems = rows(sqlite, 'SELECT * FROM itens_carrinho');
    const conversations = rows(sqlite, 'SELECT * FROM conversas');
    const messages = rows(sqlite, 'SELECT * FROM mensagens');
    const orders = rows(sqlite, 'SELECT * FROM pedidos');
    const orderItems = rows(sqlite, 'SELECT * FROM itens_pedido');
    const ratings = rows(sqlite, 'SELECT * FROM avaliacoes');
    const itemsByCart = groupBy(cartItems, 'carrinho_id');
    const itemsByOrder = groupBy(orderItems, 'pedido_id');

    const documents = new Map([
      ['usuarios', users.map((user) => ({
        _id: user.id,
        id: user.id,
        nome: user.nome,
        email: user.email,
        senha_hash: user.senha_hash,
        role: user.role,
        telefone: user.telefone,
        perfil: profileDocument(profiles.get(user.id)),
        created_at: user.created_at,
        updated_at: user.updated_at,
        deleted_at: user.deleted_at,
      }))],
      ['imagens', images.map((image) => ({
        _id: image.id,
        id: image.id,
        dados: image.dados,
        mime_type: image.mime_type,
        tamanho: image.tamanho,
        created_at: image.created_at,
      }))],
      ...(!seededCatalogs.has('categorias') ? [['categorias', categories.map((row) => ({ _id: row.id, id: row.id, nome: row.nome }))]] : []),
      ...(!seededCatalogs.has('formas_pagamento') ? [['formas_pagamento', paymentForms.map((row) => ({ _id: row.id, id: row.id, nome: row.nome }))]] : []),
      ['produtos', products.map((row) => ({
        _id: row.id,
        id: row.id,
        agricultor_id: row.agricultor_id,
        categoria_id: row.categoria_id,
        nome: row.nome,
        descricao: row.descricao,
        preco: row.preco,
        unidade: row.unidade,
        estoque: row.estoque,
        foto_id: row.foto_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      }))],
      ['carrinhos', carts.map((row) => ({
        _id: row.id,
        id: row.id,
        cliente_id: row.cliente_id,
        agricultor_id: row.agricultor_id,
        status: row.status,
        itens: (itemsByCart.get(row.id) || []).map((item) => ({
          id: item.id,
          produto_id: item.produto_id,
          quantidade: item.quantidade,
          preco_unit: item.preco_unit,
          updated_at: item.updated_at,
        })),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))],
      ['conversas', conversations.map((row) => ({
        _id: row.id,
        id: row.id,
        cliente_id: row.cliente_id,
        agricultor_id: row.agricultor_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))],
      ['mensagens', messages.map((row) => ({
        _id: row.id,
        id: row.id,
        conversa_id: row.conversa_id,
        remetente_id: row.remetente_id,
        tipo: row.tipo,
        conteudo: row.conteudo,
        snapshot_json: row.snapshot_json ? JSON.parse(row.snapshot_json) : null,
        carrinho_id: row.carrinho_id,
        created_at: row.created_at,
      }))],
      ['pedidos', orders.map((row) => ({
        _id: row.id,
        id: row.id,
        conversa_id: row.conversa_id,
        mensagem_snapshot_id: row.mensagem_snapshot_id,
        cliente_id: row.cliente_id,
        agricultor_id: row.agricultor_id,
        forma_pagamento_id: row.forma_pagamento_id,
        forma_pagamento: paymentForms.find((form) => form.id === row.forma_pagamento_id) || null,
        status: row.status,
        total: row.total,
        observacoes: row.observacoes,
        data_retirada: row.data_retirada,
        itens: (itemsByOrder.get(row.id) || []).map((item) => ({
          produto_id: item.produto_id,
          nome_produto: item.nome_produto,
          quantidade: item.quantidade,
          preco_unit: item.preco_unit,
          subtotal: item.subtotal,
        })),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))],
      ['avaliacoes', ratings.map((row) => ({
        _id: row.id,
        id: row.id,
        cliente_id: row.cliente_id,
        agricultor_id: row.agricultor_id,
        pedido_id: row.pedido_id,
        nota: row.nota,
        comentario: row.comentario,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))],
    ]);

    await initializeMongo({ seedCatalogs: false });
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        for (const [name, documentsForCollection] of documents) {
          if (documentsForCollection.length) {
            await mongo.collection(name).insertMany(documentsForCollection, { session });
          }
        }
        await mongo.collection('_migrations').insertOne({
          _id: MIGRATION_ID,
          source: path.basename(sqlitePath),
          completed_at: new Date().toISOString(),
          counts: Object.fromEntries([...documents].map(([name, items]) => [name, items.length])),
        }, { session });
      });
    } finally {
      await session.endSession();
    }

    const sequences = {
      usuarios: 'usuarios', imagens: 'imagens', produtos: 'produtos',
      carrinhos: 'carrinhos', itens_carrinho: 'itens_carrinho',
      conversas: 'conversas', mensagens: 'mensagens', pedidos: 'pedidos',
      avaliacoes: 'avaliacoes',
    };
    for (const [table, sequence] of Object.entries(sequences)) {
      const maxId = sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`).get().n;
      await mongo.collection('contadores').updateOne(
        { _id: sequence },
        { $max: { seq: maxId } },
        { upsert: true }
      );
    }

    return {
      migrado: true,
      contagens: Object.fromEntries([...documents].map(([name, items]) => [name, items.length])),
    };
  } finally {
    sqlite.close();
  }
}

module.exports = { migrate, MIGRATION_ID };

if (require.main === module) {
  migrate()
    .then((resultado) => {
      if (resultado.migrado) {
        console.log('Migração SQLite → MongoDB concluída.');
        console.log(JSON.stringify(resultado.contagens));
      } else {
        console.log(resultado.motivo);
      }
    })
    .catch((error) => {
      console.error('Migração falhou:', explicarErroMongo(error));
      process.exitCode = 1;
    })
    .finally(() => closeMongo());
}