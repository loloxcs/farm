/**
 * Regras compartilhadas de pagamento.
 *
 * O pagamento acontece direto entre cliente e agricultor (a plataforma não
 * movimenta dinheiro). Quem escolhe a forma de pagamento é sempre o CLIENTE
 * (ao enviar o carrinho, entre as formas que o agricultor aceita; pode trocar
 * na hora de pagar). O sistema registra a escolha e as confirmações de cada lado:
 *
 *   PIX / transferência → cliente informa que pagou → agricultor confirma (ou contesta)
 *   Dinheiro            → cliente avisa que paga na entrega/retirada → agricultor confirma ao receber
 *   Cartão              → aprovação simulada na hora (demonstração acadêmica)
 */

const METODOS = {
  pix:         { rotulo: 'PIX',                    confirmacao: 'agricultor' },
  transfer:    { rotulo: 'Transferência bancária', confirmacao: 'agricultor' },
  cash:        { rotulo: 'Dinheiro',               confirmacao: 'na_entrega' },
  credit_card: { rotulo: 'Cartão de crédito',      confirmacao: 'simulada' },
  debit_card:  { rotulo: 'Cartão de débito',       confirmacao: 'simulada' },
};
const METODOS_IDS = Object.keys(METODOS);

/**
 * Forma de pagamento do catálogo (`formas_pagamento`, escolhida ao gerar o
 * pedido) → método. Casa pelo nome e, se o nome for desconhecido, pelo id do seed.
 */
const METODO_POR_NOME = {
  dinheiro: 'cash',
  pix: 'pix',
  'cartao de debito': 'debit_card',
  'cartao de credito': 'credit_card',
  'transferencia bancaria': 'transfer',
};
const METODO_POR_FORMA_ID = { 1: 'cash', 2: 'pix', 3: 'debit_card', 4: 'credit_card', 5: 'transfer' };

const STATUS_PAGAMENTO = [
  'aguardando_confirmacao', // cliente informou; falta o agricultor confirmar
  'pagar_na_entrega',       // dinheiro: será pago na entrega/retirada
  'aprovado',               // recebimento confirmado (ou cartão simulado)
  'recusado',               // agricultor não localizou o pagamento
  'cancelado',              // pedido cancelado
];

const TIPOS_ENTREGA = ['retirada', 'entrega'];

function rotuloMetodo(metodo) {
  return METODOS[metodo]?.rotulo || 'Pagamento';
}

/** Método → forma do catálogo `formas_pagamento` (mesmos ids e nomes do seed). */
const FORMA_POR_METODO = {
  cash:        { id: 1, nome: 'Dinheiro' },
  pix:         { id: 2, nome: 'PIX' },
  debit_card:  { id: 3, nome: 'Cartão de Débito' },
  credit_card: { id: 4, nome: 'Cartão de Crédito' },
  transfer:    { id: 5, nome: 'Transferência Bancária' },
};

/** { id, nome } da forma de pagamento correspondente ao método (ou null). */
function formaDoMetodo(metodo) {
  return FORMA_POR_METODO[metodo] ? { ...FORMA_POR_METODO[metodo] } : null;
}

/**
 * Método que o CLIENTE escolheu ao enviar o carrinho (fica gravado no pedido
 * como `forma_pagamento`). Null se ele ainda não escolheu — pedidos antigos ou
 * carrinhos enviados sem forma; nesse caso ele define na hora de pagar.
 */
function metodoCombinado(pedido) {
  const forma = pedido?.forma_pagamento || {};
  const nome = String(forma.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return METODO_POR_NOME[nome] || METODO_POR_FORMA_ID[forma.id ?? pedido?.forma_pagamento_id] || null;
}

/** Métodos que o agricultor aceita. Perfis antigos (sem o campo) aceitam todos. */
function metodosAceitos(perfil) {
  const lista = Array.isArray(perfil?.formas_aceitas)
    ? perfil.formas_aceitas.filter((metodo) => METODOS[metodo])
    : [];
  return lista.length ? lista : [...METODOS_IDS];
}

function serializarPagamento(pagamento) {
  if (!pagamento) return null;
  return {
    pedido_id: pagamento.pedido_id,
    metodo: pagamento.metodo,
    metodo_rotulo: rotuloMetodo(pagamento.metodo),
    cartao_ultimos4: pagamento.cartao_ultimos4 || null,
    valor: pagamento.valor,
    status: pagamento.status,
    simulado: Boolean(pagamento.simulado),
    transacao_id: pagamento.transacao_id || null,
    observacao: pagamento.observacao || null,
    motivo_recusa: pagamento.motivo_recusa || null,
    devolucao_pendente: Boolean(pagamento.devolucao_pendente),
    registrado_por: pagamento.registrado_por || 'cliente',
    created_at: pagamento.created_at,
    informado_em: pagamento.informado_em || pagamento.created_at || null,
    confirmado_em: pagamento.confirmado_em || null,
    recusado_em: pagamento.recusado_em || null,
    updated_at: pagamento.updated_at || pagamento.created_at || null,
    historico: Array.isArray(pagamento.historico) ? pagamento.historico : [],
  };
}

/** Versão curta, embutida no pedido (lista e detalhe). */
function resumoPagamento(pagamento) {
  if (!pagamento) return null;
  return {
    status: pagamento.status,
    metodo: pagamento.metodo,
    metodo_rotulo: rotuloMetodo(pagamento.metodo),
  };
}

/** O que cada parte pode fazer agora — o front só segue estas flags. */
function permissoesPagamento(pedido, pagamento, usuario) {
  const pagavel = ['confirmado', 'entregue'].includes(pedido.status);
  const status = pagamento?.status || null;
  const ehCliente = usuario.role === 'cliente' && pedido.cliente_id === usuario.id;
  const ehAgricultor = usuario.role === 'agricultor' && pedido.agricultor_id === usuario.id;
  return {
    pagar: ehCliente && pagavel && (!pagamento || ['recusado', 'pagar_na_entrega'].includes(status)),
    confirmar: ehAgricultor && pagavel
      && (!pagamento || ['aguardando_confirmacao', 'pagar_na_entrega', 'recusado'].includes(status)),
    recusar: ehAgricultor && pagavel && status === 'aguardando_confirmacao',
  };
}

module.exports = {
  METODOS,
  METODOS_IDS,
  STATUS_PAGAMENTO,
  TIPOS_ENTREGA,
  rotuloMetodo,
  metodoCombinado,
  formaDoMetodo,
  metodosAceitos,
  serializarPagamento,
  resumoPagamento,
  permissoesPagamento,
};
