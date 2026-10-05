const { getMongoDb, nextId } = require('../db/mongodb');
const { httpError } = require('../middleware/error');

const MIME_VALIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMG_BYTES = 5 * 1024 * 1024;

async function criarImagemSeNecessario(body) {
  if (!body.foto_base64) return null;
  const mime = body.foto_mime || 'image/jpeg';
  if (!MIME_VALIDOS.includes(mime)) {
    throw httpError(400, 'VALIDATION', 'foto_mime inválido', { aceitos: MIME_VALIDOS });
  }

  const buffer = Buffer.from(body.foto_base64, 'base64');
  if (!buffer.length) throw httpError(400, 'VALIDATION', 'foto_base64 vazia');
  if (buffer.length > MAX_IMG_BYTES) {
    throw httpError(400, 'VALIDATION', `imagem excede ${MAX_IMG_BYTES} bytes`);
  }

  const db = await getMongoDb();
  const id = await nextId('imagens');
  await db.collection('imagens').insertOne({
    _id: id,
    id,
    dados: buffer,
    mime_type: mime,
    tamanho: buffer.length,
    created_at: new Date().toISOString(),
  });
  return id;
}

module.exports = { criarImagemSeNecessario, MIME_VALIDOS, MAX_IMG_BYTES };