// api.js — wrapper único de fetch para o backend.
//
// Declara TODAS as funções do API.md (mesmo as que a Fase A não usa) para que
// as fases futuras só preencham o consumo, sem precisar reabrir esse arquivo.
//
// request() centraliza: BASE_URL, Authorization, parse JSON, erro estruturado
// { status, code, message, details }. Em 401, dispara evento 'auth:expired'
// que o main.js ouve para deslogar e redirecionar.

import { getToken } from './auth.js';

export const BASE_URL = 'http://localhost:3000/api';

/** URL helper para imagens — usar em <img src="..."> */
export function imagemUrl(fotoId) {
  if (!fotoId) return null;
  return `${BASE_URL}/imagens/${fotoId}`;
}

/**
 * Faz uma chamada HTTP ao backend.
 * @param {string} method — GET, POST, PATCH, DELETE
 * @param {string} path — começa com '/', ex.: '/auth/login'
 * @param {object} [body] — payload JSON; ignorado em GET
 * @param {object} [query] — params de query string
 * @returns {Promise<any>} JSON parseado
 * @throws {{status:number, code:string, message:string, details?:any}}
 */
export async function request(method, path, body, query) {
  let url = `${BASE_URL}${path}`;

  if (query && typeof query === 'object') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    const qsStr = qs.toString();
    if (qsStr) url += `?${qsStr}`;
  }

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body !== undefined && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    throw {
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Não foi possível conectar ao servidor. Verifique se o backend está rodando em ' + BASE_URL,
    };
  }

  // 204 No Content
  if (res.status === 204) return null;

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    const errBody = (data && typeof data === 'object' && data.error) ? data.error : null;
    throw {
      status: res.status,
      code: errBody?.code || `HTTP_${res.status}`,
      message: errBody?.message || (typeof data === 'string' ? data : `Erro ${res.status}`),
      details: errBody?.details,
    };
  }

  return data;
}

// =============================================================
// 1. Auth
// =============================================================

/** POST /auth/register — RF01 */
export function authRegister({ nome, email, senha, role, telefone }) {
  return request('POST', '/auth/register', { nome, email, senha, role, telefone });
}

/** POST /auth/login — RF02 */
export function authLogin(email, senha) {
  return request('POST', '/auth/login', { email, senha });
}

/** POST /auth/logout — RF02 */
export function authLogout() {
  return request('POST', '/auth/logout');
}

/** GET /auth/me — RF02 */
export function authMe() {
  return request('GET', '/auth/me');
}

// =============================================================
// 2. Agricultores
// =============================================================

/**
 * GET /agricultores — RF09
 * @param {{q?:string, cidade?:string, estado?:string, page?:number, limit?:number}} [query]
 */
export function listarAgricultores(query = {}) {
  return request('GET', '/agricultores', undefined, query);
}

/** GET /agricultores/:id — RF03, RF09 */
export function getAgricultor(id) {
  return request('GET', `/agricultores/${id}`);
}

/** PATCH /agricultores/me — RF03 (Fase C). Aceita também `chave_pix` e `formas_aceitas`. */
export function atualizarMeuPerfilAgricultor(patch) {
  return request('PATCH', '/agricultores/me', patch);
}

/**
 * GET /agricultores/me/pagamento — dados de recebimento do agricultor logado
 * ({ formas_aceitas, chave_pix, metodos_disponiveis }). A chave PIX não aparece
 * no perfil público, por isso tem endpoint próprio.
 */
export function getMeuRecebimento() {
  return request('GET', '/agricultores/me/pagamento');
}

// =============================================================
// 3. Produtos
// =============================================================

/** GET /agricultores/:id/produtos — RF10 */
export function listarProdutosDoAgricultor(agricultorId, query = {}) {
  return request('GET', `/agricultores/${agricultorId}/produtos`, undefined, query);
}

/**
 * POST /produtos — RF05 (Fase C)
 * Stub JSON. O API.md aceita multipart para upload de foto;
 * essa versão envia apenas JSON (sem foto, ou com foto_id já existente).
 * A versão multipart será adicionada na Fase C, se necessário.
 */
export function criarProduto(payload) {
  return request('POST', '/produtos', payload);
}

/** PATCH /produtos/:id — RF05 (Fase C) */
export function atualizarProduto(id, patch) {
  return request('PATCH', `/produtos/${id}`, patch);
}

/** DELETE /produtos/:id — RF04, RF05 (Fase C) */
export function removerProduto(id) {
  return request('DELETE', `/produtos/${id}`);
}

// =============================================================
// 4. Catálogos (read-only)
// =============================================================

/** GET /categorias — RF06 */
export function listarCategorias() {
  return request('GET', '/categorias');
}

/** GET /formas-pagamento — RF13 */
export function listarFormasPagamento() {
  return request('GET', '/formas-pagamento');
}

// =============================================================
// 5. Carrinho (Fase B)
// =============================================================

/** GET /carrinho/:agricultorId — RF07 */
export function getCarrinho(agricultorId) {
  return request('GET', `/carrinho/${agricultorId}`);
}

/** POST /carrinho/:agricultorId/itens — RF07 */
export function adicionarItemCarrinho(agricultorId, { produto_id, quantidade }) {
  return request('POST', `/carrinho/${agricultorId}/itens`, { produto_id, quantidade });
}

/** PATCH /carrinho/:agricultorId/itens/:itemId — RF07 */
export function atualizarItemCarrinho(agricultorId, itemId, { quantidade }) {
  return request('PATCH', `/carrinho/${agricultorId}/itens/${itemId}`, { quantidade });
}

/** DELETE /carrinho/:agricultorId/itens/:itemId — RF07 */
export function removerItemCarrinho(agricultorId, itemId) {
  return request('DELETE', `/carrinho/${agricultorId}/itens/${itemId}`);
}

/** DELETE /carrinho/:agricultorId — RF07 */
export function limparCarrinho(agricultorId) {
  return request('DELETE', `/carrinho/${agricultorId}`);
}

// =============================================================
// 6. Conversas / Chat (Fase B)
// =============================================================

/** GET /conversas — RF08, RF12 */
export function listarConversas() {
  return request('GET', '/conversas');
}

/** GET /conversas/:id/mensagens — RF08 (polling com `since`) */
export function listarMensagens(conversaId, { since, limit } = {}) {
  return request('GET', `/conversas/${conversaId}/mensagens`, undefined, { since, limit });
}

/** POST /conversas/com/:outroId/mensagens — RF08, RF12 */
export function enviarMensagem(outroId, { conteudo }) {
  return request('POST', `/conversas/com/${outroId}/mensagens`, { conteudo });
}

/**
 * POST /conversas/com/:agricultorId/snapshot — RF07, RF08
 * `metodo_pagamento`: forma que o CLIENTE escolheu (pix | transfer | cash |
 * credit_card | debit_card), entre as que o agricultor aceita. Vai junto com o
 * carrinho e vira a forma de pagamento do pedido.
 */
export function enviarSnapshot(agricultorId, { metodo_pagamento } = {}) {
  return request('POST', `/conversas/com/${agricultorId}/snapshot`, { metodo_pagamento });
}

// =============================================================
// 7. Pedidos (Fase D)
// =============================================================

/**
 * POST /pedidos — RF13 (agricultor cria a partir de snapshot).
 * `tipo_entrega`: 'retirada' | 'entrega'. `data_retirada` é a data combinada
 * (vale para os dois casos) e `local_entrega` o endereço ou ponto de retirada.
 * A forma de pagamento NÃO vai aqui: é a que o cliente escolheu no carrinho.
 */
export function criarPedido({
  mensagem_snapshot_id, tipo_entrega, data_retirada, local_entrega, observacoes,
}) {
  return request('POST', '/pedidos', {
    mensagem_snapshot_id, tipo_entrega, data_retirada, local_entrega, observacoes,
  });
}

/** GET /pedidos — RF13 */
export function listarPedidos(query = {}) {
  return request('GET', '/pedidos', undefined, query);
}

/** GET /pedidos/:id — RF13 */
export function getPedido(id) {
  return request('GET', `/pedidos/${id}`);
}

/** PATCH /pedidos/:id/status — RF13 */
export function atualizarStatusPedido(id, status) {
  return request('PATCH', `/pedidos/${id}/status`, { status });
}

/**
 * GET /pedidos/:id/pagamento — cliente ou agricultor do pedido.
 * Devolve { pagamento, opcoes: { metodos, metodo_combinado, chave_pix, agricultor_nome },
 *           pode: { pagar, confirmar, recusar } }.
 */
export function getPagamentoPedido(id) {
  return request('GET', `/pedidos/${id}/pagamento`);
}

/**
 * POST /pedidos/:id/pagamento — cliente informa o pagamento.
 * payload: { metodo, cartao_ultimos4?, observacao? }. Nenhum dado sensível é enviado.
 */
export function informarPagamentoPedido(id, payload) {
  return request('POST', `/pedidos/${id}/pagamento`, payload);
}

/** PATCH /pedidos/:id/pagamento — agricultor confirma que recebeu. */
export function confirmarPagamentoPedido(id, { metodo } = {}) {
  return request('PATCH', `/pedidos/${id}/pagamento`, { acao: 'confirmar', metodo });
}

/** PATCH /pedidos/:id/pagamento — agricultor avisa que não localizou o pagamento. */
export function recusarPagamentoPedido(id, motivo) {
  return request('PATCH', `/pedidos/${id}/pagamento`, { acao: 'recusar', motivo });
}

// =============================================================
// 8. Avaliações (Fase D)
// =============================================================

/** POST /avaliacoes — RF11 (upsert por par cliente-agricultor) */
export function criarAvaliacao({ agricultor_id, pedido_id, nota, comentario }) {
  return request('POST', '/avaliacoes', { agricultor_id, pedido_id, nota, comentario });
}

/** GET /agricultores/:id/avaliacoes — RF11 */
export function listarAvaliacoesDoAgricultor(agricultorId, query = {}) {
  return request('GET', `/agricultores/${agricultorId}/avaliacoes`, undefined, query);
}
