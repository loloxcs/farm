/**
 * RESET: apaga TODOS os dados do sistema no MongoDB e recria as coleções
 * vazias, com índices e catálogos.
 *
 * ATENÇÃO: o banco fica no Atlas (online). O reset vale para todo mundo que
 * usa a mesma MONGO_URI — não só para este computador.
 *
 * Uso: npm run db:reset -- --confirmar      (o ./reset.sh pede a confirmação e passa a flag)
 */
require('dotenv').config();
const {
  COLECOES, getMongoDb, initializeMongo, closeMongo, nomeDoBanco, uriSemSenha, explicarErroMongo,
} = require('./mongodb');
const { MIGRATION_ID } = require('./migrate-sqlite-to-mongo');
const { mostrarResumo } = require('./init-mongo');

async function main() {
  if (!process.argv.includes('--confirmar')) {
    console.error(`Isto apaga TODOS os dados do banco "${nomeDoBanco()}" em ${uriSemSenha()}.`);
    console.error('Para confirmar, rode:  npm run db:reset -- --confirmar');
    process.exitCode = 1;
    return;
  }

  const db = await getMongoDb();
  const existentes = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((colecao) => colecao.name)
  );
  for (const nome of COLECOES) {
    if (!existentes.has(nome)) continue;
    await db.collection(nome).drop();
    console.log(`  apagada: ${nome}`);
  }

  // "Começar do zero" de verdade: marca a migração como feita para o ./run.sh
  // não trazer de volta os dados antigos do database.sqlite.
  await db.collection('_migrations').updateOne(
    { _id: MIGRATION_ID },
    { $setOnInsert: { origem: 'reset', completed_at: new Date().toISOString() } },
    { upsert: true }
  );

  await initializeMongo();
  console.log('Banco recriado do zero.');
  await mostrarResumo();
}

main()
  .catch((error) => {
    console.error(`\nFalha ao resetar o MongoDB (${error.name}).\n${explicarErroMongo(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
