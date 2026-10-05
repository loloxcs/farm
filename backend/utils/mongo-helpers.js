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
  };
}

module.exports = { asyncRoute, idParam, pagina, inteiroPositivo, usuarioPublico };