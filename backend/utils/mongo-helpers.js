const { httpError } = require('../middleware/error');
const { paginacao, inteiroPositivo } = require('./validacao');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function idParam(value, name = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError(400, 'VALIDATION', `${name} inválido`);
  }
  return id;
}

function pagina(query) {
  return paginacao(query);
}

function usuarioPublico(usuario) {
  if (!usuario) return null;
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    role: usuario.role,
    telefone: usuario.telefone,
    endereco: enderecoDoUsuario(usuario),
  };
}

/**
 * Endereço do usuário no mesmo formato para os dois papéis.
 * Cliente: fica em `usuario.endereco`. Agricultor: dentro de `usuario.perfil`
 * (onde já ficavam cidade/estado/cep/latitude/longitude).
 */
function enderecoDoUsuario(usuario) {
  const fonte = (usuario?.role === 'agricultor' ? usuario.perfil : usuario?.endereco) || {};
  return {
    cep: fonte.cep ?? null,
    logradouro: fonte.logradouro ?? null,
    numero: fonte.numero ?? null,
    complemento: fonte.complemento ?? null,
    bairro: fonte.bairro ?? null,
    cidade: fonte.cidade ?? null,
    estado: fonte.estado ?? null,
    latitude: fonte.latitude ?? null,
    longitude: fonte.longitude ?? null,
  };
}

module.exports = { asyncRoute, idParam, pagina, inteiroPositivo, usuarioPublico, enderecoDoUsuario };