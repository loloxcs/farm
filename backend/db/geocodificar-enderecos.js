/**
 * Preenche latitude/longitude de quem já tem endereço salvo mas ainda não tem
 * coordenadas (ex.: agricultores cadastrados antes do mapa existir).
 *
 *   npm run db:geocodificar
 *
 * Usa o OpenStreetMap (Nominatim): 1 consulta por segundo, então pode demorar
 * alguns segundos por usuário. Não apaga nada; pode rodar quantas vezes quiser.
 */
require('dotenv').config();
const { getMongoDb, closeMongo, explicarErroMongo } = require('./mongodb');
const { geocodificar, temCoordenadas } = require('../utils/endereco');

async function main() {
  const db = await getMongoDb();
  const usuarios = await db.collection('usuarios').find({ deleted_at: null }).toArray();
  let atualizados = 0;
  let semResultado = 0;

  for (const u of usuarios) {
    const agricultor = u.role === 'agricultor';
    const end = agricultor ? u.perfil : u.endereco;
    if (!end || temCoordenadas(end) || (!end.cidade && !end.cep)) continue;

    const r = await geocodificar(end);
    const prefixo = agricultor ? 'perfil.' : 'endereco.';
    if (!r) {
      semResultado += 1;
      console.log(`  ✗ ${u.nome} (${end.cidade || end.cep}): endereço não encontrado`);
      continue;
    }
    await db.collection('usuarios').updateOne({ _id: u._id }, {
      $set: {
        [prefixo + 'latitude']: r.latitude,
        [prefixo + 'longitude']: r.longitude,
        [prefixo + 'localizacao_fonte']: `endereco:${r.precisao}`,
      },
    });
    atualizados += 1;
    console.log(`  ✓ ${u.nome}: ${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)} (precisão: ${r.precisao})`);
  }
  console.log(`\nPronto: ${atualizados} atualizado(s), ${semResultado} sem resultado.`);
}

main()
  .catch((error) => {
    console.error(explicarErroMongo(error));
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
