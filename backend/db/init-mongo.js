/**
 * Cria no MongoDB o que estiver faltando: coleções, índices e catálogos
 * (categorias e formas de pagamento). Não apaga nem altera dados existentes.
 *
 * Uso: npm run db:init
 */
require('dotenv').config();
const {
  initializeMongo, closeMongo, resumoDoBanco, nomeDoBanco, uriSemSenha, explicarErroMongo,
} = require('./mongodb');

async function mostrarResumo() {
  console.log(`\nBanco "${nomeDoBanco()}" em ${uriSemSenha()}`);
  for (const { nome, documentos } of await resumoDoBanco()) {
    console.log(`  ${nome.padEnd(18)} ${String(documentos).padStart(6)} documento(s)`);
  }
}

async function main() {
  await initializeMongo();
  console.log('MongoDB pronto: coleções, índices e catálogos conferidos.');
  await mostrarResumo();
}

module.exports = { mostrarResumo };

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`\nFalha ao preparar o MongoDB (${error.name}).\n${explicarErroMongo(error)}`);
      process.exitCode = 1;
    })
    .finally(() => closeMongo());
}
