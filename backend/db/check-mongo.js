/**
 * Diagnóstico do MongoDB — só LÊ, não altera nada.
 * Mostra: conexão, versão, suporte a transações, coleções, índices e contadores.
 *
 * Uso: npm run db:check
 */
require('dotenv').config();
const {
  COLECOES, INDICES, getMongoDb, getMongoClient, closeMongo, nomeDoBanco, uriSemSenha, explicarErroMongo,
} = require('./mongodb');

// coleção → sequência em `contadores` que gera seus ids
const SEQUENCIAS = {
  usuarios: 'usuarios', produtos: 'produtos', imagens: 'imagens', carrinhos: 'carrinhos',
  conversas: 'conversas', mensagens: 'mensagens', pedidos: 'pedidos', avaliacoes: 'avaliacoes',
};

async function main() {
  let problemas = 0;
  const ok = (texto) => console.log(`  ok      ${texto}`);
  const ruim = (texto) => { problemas += 1; console.log(`  ATENÇÃO ${texto}`); };

  console.log(`Conectando em ${uriSemSenha()} ...`);
  const db = await getMongoDb();
  const client = await getMongoClient();
  await db.command({ ping: 1 });
  ok(`conectado ao banco "${nomeDoBanco()}"`);

  try {
    const info = await db.command({ buildInfo: 1 });
    ok(`MongoDB versão ${info.version}`);
  } catch { /* sem permissão para buildInfo: irrelevante */ }

  // Pedidos e migração usam transações: confirma que o servidor aceita.
  const session = client.startSession();
  try {
    session.startTransaction();
    await db.collection('contadores').findOne({}, { session });
    await session.abortTransaction();
    ok('transações disponíveis');
  } catch (error) {
    ruim(`transações indisponíveis — ${explicarErroMongo(error)}`);
  } finally {
    await session.endSession();
  }

  const existentes = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((colecao) => colecao.name)
  );
  console.log('\nColeções:');
  for (const nome of COLECOES) {
    if (!existentes.has(nome)) { ruim(`${nome} não existe — rode "npm run db:init"`); continue; }
    const colecao = db.collection(nome);
    const [documentos, indices] = await Promise.all([colecao.countDocuments(), colecao.indexes()]);
    const esperados = INDICES.filter(([alvo]) => alvo === nome).length + 1; // +1 = _id
    const linha = `${nome.padEnd(18)} ${String(documentos).padStart(6)} documento(s), ${indices.length} índice(s)`;
    if (indices.length < esperados) ruim(`${linha} — esperados ${esperados}; rode "npm run db:init"`);
    else ok(linha);
  }

  console.log('\nContadores de id:');
  for (const [nome, sequencia] of Object.entries(SEQUENCIAS)) {
    if (!existentes.has(nome)) continue;
    const [maior, contador] = await Promise.all([
      db.collection(nome).find({}, { projection: { id: 1 } }).sort({ id: -1 }).limit(1).next(),
      db.collection('contadores').findOne({ _id: sequencia }),
    ]);
    const maiorId = maior?.id || 0;
    const seq = contador?.seq || 0;
    if (seq < maiorId) ruim(`${nome}: contador em ${seq}, mas já existe id ${maiorId} — novos cadastros dariam conflito`);
    else ok(`${nome.padEnd(18)} próximo id ${seq + 1}`);
  }

  const migracao = await db.collection('_migrations').findOne({});
  console.log(`\nMigração do SQLite: ${migracao ? `registrada em ${migracao.completed_at}${migracao.origem === 'reset' ? ' (banco resetado)' : ''}` : 'ainda não feita (rode "npm run db:setup" se houver dados locais)'}`);

  console.log(problemas ? `\n${problemas} ponto(s) de atenção acima.` : '\nTudo certo com o banco.');
  if (problemas) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`\nNão foi possível verificar o MongoDB (${error.name}).\n${explicarErroMongo(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
