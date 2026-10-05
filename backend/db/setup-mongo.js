/**
 * Preparação completa do banco, usada pelo ./run.sh antes de subir o servidor:
 *
 *   1. cria coleções, índices e catálogos que faltarem (igual ao db:init);
 *   2. se ainda existir o antigo database.sqlite e o MongoDB estiver vazio,
 *      copia os dados para o MongoDB — uma única vez.
 *
 * Seguro para rodar sempre: nunca apaga dados.
 *
 * Uso: npm run db:setup
 */
require('dotenv').config();
const { initializeMongo, closeMongo, explicarErroMongo } = require('./mongodb');
const { migrate } = require('./migrate-sqlite-to-mongo');
const { mostrarResumo } = require('./init-mongo');

async function main() {
  await initializeMongo();
  console.log('MongoDB pronto: coleções, índices e catálogos conferidos.');

  const resultado = await migrate({ auto: true });
  if (resultado.migrado) {
    console.log('Dados do banco local (SQLite) copiados para o MongoDB:');
    console.log(' ', JSON.stringify(resultado.contagens));
  } else {
    console.log(`Migração do SQLite: ${resultado.motivo}`);
  }

  await mostrarResumo();
}

main()
  .catch((error) => {
    console.error(`\nFalha ao preparar o MongoDB (${error.name}).\n${explicarErroMongo(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
