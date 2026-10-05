/**
 * Conexão única com o MongoDB (Atlas) + definição das coleções e índices.
 *
 * Todo o sistema grava aqui — não existe mais banco local:
 *
 *   usuarios          clientes e agricultores (o perfil do agricultor fica embutido em `perfil`)
 *   produtos          produtos de cada agricultor, com `estoque`
 *   imagens           fotos de perfil e de produto (binário)
 *   categorias        catálogo fixo de categorias
 *   formas_pagamento  catálogo fixo de formas de pagamento
 *   carrinhos         um carrinho ativo por par cliente–agricultor (itens embutidos)
 *   conversas         uma conversa por par cliente–agricultor
 *   mensagens         mensagens do chat (texto, snapshot do carrinho, avisos do sistema)
 *   pedidos           pedidos gerados a partir do carrinho (itens embutidos)
 *   pagamentos        um pagamento por pedido
 *   avaliacoes        avaliação do cliente sobre o agricultor
 *   contadores        sequências dos ids numéricos (1, 2, 3...) de cada coleção
 *
 * Variáveis (backend/.env):
 *   MONGO_URI  obrigatória — string de conexão do Atlas
 *   MONGO_DB   opcional — nome do banco (padrão: farm)
 */
const { MongoClient } = require('mongodb');

let client;
let connection;

const COLECOES = [
  'usuarios', 'produtos', 'imagens', 'categorias', 'formas_pagamento',
  'carrinhos', 'conversas', 'mensagens', 'pedidos', 'pagamentos', 'avaliacoes',
  'contadores',
];

// [coleção, chaves, opções]
const INDICES = [
  ['usuarios', { email: 1, deleted_at: 1 }, { unique: true }],
  ['produtos', { agricultor_id: 1, deleted_at: 1 }, {}],
  ['produtos', { categoria_id: 1, deleted_at: 1 }, {}],
  ['carrinhos', { cliente_id: 1, agricultor_id: 1 }, { unique: true, partialFilterExpression: { status: 'ativo' } }],
  ['conversas', { cliente_id: 1, agricultor_id: 1 }, { unique: true }],
  ['mensagens', { conversa_id: 1, created_at: 1 }, {}],
  ['pedidos', { mensagem_snapshot_id: 1 }, { unique: true }],
  ['pedidos', { cliente_id: 1, status: 1, created_at: -1 }, {}],
  ['pedidos', { agricultor_id: 1, status: 1, created_at: -1 }, {}],
  ['avaliacoes', { cliente_id: 1, agricultor_id: 1 }, { unique: true }],
  ['avaliacoes', { agricultor_id: 1, created_at: -1 }, {}],
  ['pagamentos', { pedido_id: 1 }, { unique: true }],
  ['categorias', { nome: 1 }, { unique: true }],
  ['formas_pagamento', { nome: 1 }, { unique: true }],
];

const CATEGORIAS = [
  'Frutas',
  'Verduras e Folhosas',
  'Legumes e Raízes',
  'Grãos e Cereais',
  'Laticínios e Ovos',
  'Mel e Derivados',
  'Conservas e Processados',
  'Ervas e Temperos',
];

const FORMAS_PAGAMENTO = [
  'Dinheiro',
  'PIX',
  'Cartão de Débito',
  'Cartão de Crédito',
  'Transferência Bancária',
];

function nomeDoBanco() {
  return process.env.MONGO_DB || 'farm';
}

async function getMongoDb() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI não configurada');

  if (!connection) {
    // 15 s para achar o cluster: falha rápido e com mensagem clara se o IP não estiver liberado.
    client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    connection = client.connect()
      .then(() => client.db(nomeDoBanco()))
      .catch((error) => {
        connection = null;
        client = null;
        throw error;
      });
  }

  return connection;
}

async function getMongoClient() {
  await getMongoDb();
  return client;
}

/** Fecha a conexão (scripts de linha de comando). O servidor nunca chama isto. */
async function closeMongo() {
  const atual = client;
  client = null;
  connection = null;
  if (atual) await atual.close();
}

async function nextId(sequenceName) {
  const db = await getMongoDb();
  const counter = await db.collection('contadores').findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return counter.seq;
}

/**
 * Cria o que estiver faltando: coleções, índices e os catálogos fixos.
 * Pode rodar quantas vezes quiser — nunca apaga nem sobrescreve dados.
 */
async function initializeMongo({ seedCatalogs = true } = {}) {
  const db = await getMongoDb();

  const existentes = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((colecao) => colecao.name)
  );
  for (const nome of COLECOES) {
    if (existentes.has(nome)) continue;
    try {
      await db.createCollection(nome);
    } catch (error) {
      // Outro processo criou no meio do caminho: tudo bem.
      if (error?.code !== 48 && error?.codeName !== 'NamespaceExists') throw error;
    }
  }

  // Um de cada vez: evita disputa entre índices da mesma coleção.
  for (const [colecao, chaves, opcoes] of INDICES) {
    await db.collection(colecao).createIndex(chaves, opcoes);
  }

  if (seedCatalogs) {
    await Promise.all([
      ...CATEGORIAS.map((nome, index) => db.collection('categorias').updateOne(
        { id: index + 1 },
        { $setOnInsert: { _id: index + 1, id: index + 1, nome } },
        { upsert: true }
      )),
      ...FORMAS_PAGAMENTO.map((nome, index) => db.collection('formas_pagamento').updateOne(
        { id: index + 1 },
        { $setOnInsert: { _id: index + 1, id: index + 1, nome } },
        { upsert: true }
      )),
    ]);
  }

  return db;
}

/** [{ nome, documentos }] de todas as coleções do sistema — para os scripts mostrarem. */
async function resumoDoBanco() {
  const db = await getMongoDb();
  const linhas = [];
  for (const nome of COLECOES) {
    linhas.push({ nome, documentos: await db.collection(nome).countDocuments() });
  }
  return linhas;
}

/** URI sem a senha, para mostrar em log. */
function uriSemSenha() {
  return String(process.env.MONGO_URI || '').replace(/(:\/\/[^:/@]+):[^@]*@/, '$1:****@');
}

/** Traduz os erros de conexão mais comuns em "o que fazer". */
function explicarErroMongo(error) {
  const texto = `${error?.name || ''} ${error?.codeName || ''} ${error?.message || ''}`;
  if (/MONGO_URI não configurada/.test(texto)) {
    return 'MONGO_URI não está definida. Preencha a linha MONGO_URI= no arquivo backend/.env com a string de conexão do Atlas.';
  }
  if (/bad auth|Authentication failed|AuthenticationFailed/i.test(texto)) {
    return 'O Atlas recusou o usuário/senha do MONGO_URI. Confira em Atlas → Database Access se o usuário existe e se a senha é a mesma do backend/.env.';
  }
  if (/querySrv|ENOTFOUND|ENODATA|EAI_AGAIN/i.test(texto)) {
    return 'Não foi possível localizar o cluster pelo nome. Confira o endereço no MONGO_URI e a sua conexão com a internet (algumas redes bloqueiam esse tipo de consulta; teste em outra rede ou no 4G).';
  }
  if (/ServerSelection|MongoNetwork|ETIMEDOUT|ECONNREFUSED|timed out/i.test(texto)) {
    return 'Não consegui chegar no cluster. Causa mais comum: o seu IP não está liberado no Atlas — entre em Atlas → Network Access → Add IP Address → "Add Current IP Address". '
      + 'Outras causas: cluster pausado ou a rede bloqueando a porta 27017.';
  }
  if (/not authorized|Unauthorized/i.test(texto)) {
    return 'O usuário do MONGO_URI não tem permissão para esta operação. Em Atlas → Database Access, dê a ele o papel "Read and write to any database".';
  }
  if (/Transaction numbers are only allowed|replica set/i.test(texto)) {
    return 'Este servidor MongoDB não aceita transações (precisa ser replica set). No Atlas isso já vem pronto; num MongoDB local, inicie com --replSet.';
  }
  return error?.message || String(error);
}

module.exports = {
  COLECOES,
  INDICES,
  nomeDoBanco,
  getMongoDb,
  getMongoClient,
  closeMongo,
  nextId,
  initializeMongo,
  resumoDoBanco,
  uriSemSenha,
  explicarErroMongo,
};
