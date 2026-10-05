// pagamento-ui.js — peças de interface compartilhadas do fluxo de pagamento.
//
// Usado por: pages/pagamento.js (cliente), pages/pedido-detalhe.js (os dois
// lados), pages/pedidos-lista.js (badge) e pages/conversa.js (cartões do chat).
//
// Modelo (ver backend/utils/pagamentos.js): o dinheiro vai direto do cliente
// para o agricultor; o sistema registra o combinado e a confirmação de cada lado.
//
//   aguardando_confirmacao  cliente informou; agricultor ainda não confirmou
//   pagar_na_entrega        dinheiro, pago na entrega/retirada
//   aprovado                recebimento confirmado
//   recusado                agricultor não localizou o pagamento
//   cancelado               pedido cancelado

import { el, formatarMoeda, formatarDataHora, toast } from './ui.js';
import { confirmarPagamentoPedido, recusarPagamentoPedido } from './api.js';

export const MOTIVO_MAX = 200;

/** 'entrega' → { substantivo:'entrega', verbo:'entregue', ... } — evita if espalhado. */
export function termosEntrega(pedido) {
  const entrega = pedido?.tipo_entrega === 'entrega';
  return {
    ehEntrega: entrega,
    titulo: entrega ? 'Entrega' : 'Retirada',
    naHora: entrega ? 'na entrega' : 'na retirada',
    concluido: entrega ? 'Entregue' : 'Retirado',
    marcar: entrega ? 'Marcar como entregue' : 'Marcar como retirado',
    rotuloLocal: entrega ? 'Endereço de entrega' : 'Local de retirada',
  };
}

/** "Entrega em 10/10/2026 às 09:00" / "Retirada — data a combinar". */
export function resumoEntrega(pedido) {
  const t = termosEntrega(pedido);
  const quando = formatarDataHora(pedido?.data_retirada);
  return quando ? `${t.titulo} em ${quando}` : `${t.titulo} — data a combinar`;
}

/** Frase do "e agora?" depois que o pagamento está resolvido. */
export function fraseProximoPasso(pedido) {
  if (pedido?.status === 'entregue') {
    return pedido.tipo_entrega === 'entrega' ? 'O pedido já foi entregue.' : 'O pedido já foi retirado.';
  }
  const quando = formatarDataHora(pedido?.data_retirada);
  const local = pedido?.local_entrega;
  if (pedido?.tipo_entrega === 'entrega') {
    if (!quando && !local) return 'O pedido será entregue — combinem data e endereço pelo chat.';
    return `O pedido será entregue${quando ? ` em ${quando}` : ''}${local ? `, no endereço: ${local}` : ''}.`;
  }
  if (!quando && !local) return 'O pedido estará disponível para retirada — combinem data e local pelo chat.';
  return `O pedido estará disponível para retirada${quando ? ` em ${quando}` : ''}${local ? `, em: ${local}` : ''}.`;
}

/** Rótulo curto do status do pagamento, no contexto do pedido. */
export function rotuloStatusPagamento(status, pedido) {
  switch (status) {
    case 'aguardando_confirmacao': return 'Aguardando confirmação';
    case 'pagar_na_entrega': return `Paga ${termosEntrega(pedido).naHora}`;
    case 'aprovado': return 'Pago';
    case 'recusado': return 'Não localizado';
    case 'cancelado': return 'Cancelado';
    default:
      if (['confirmado', 'entregue'].includes(pedido?.status)) return 'A pagar';
      return '—';
  }
}

/** Badge de pagamento — mesma base visual do status do pedido. */
export function renderBadgePagamento(status, pedido) {
  const semRegistro = !status;
  const classe = semRegistro
    ? (['confirmado', 'entregue'].includes(pedido?.status) ? 'pag-a-pagar' : 'pag-vazio')
    : `pag-${status}`;
  return el('span', {
    className: `status-badge pag-badge ${classe}`,
    text: rotuloStatusPagamento(status, pedido),
  });
}

export function rotuloMetodo(metodo) {
  return ({
    pix: 'PIX',
    transfer: 'Transferência bancária',
    cash: 'Dinheiro',
    credit_card: 'Cartão de crédito',
    debit_card: 'Cartão de débito',
  })[metodo] || 'Pagamento';
}

/**
 * Linha do tempo: pedido confirmado → pagamento informado → pagamento
 * confirmado → entregue/retirado. Some em pedidos cancelados.
 */
export function renderEtapas(pedido, pagamento) {
  if (pedido.status === 'cancelado') return null;
  const t = termosEntrega(pedido);
  const st = pagamento?.status || null;
  const pago = st === 'aprovado';
  const etapas = [
    { rotulo: 'Pedido confirmado', estado: ['confirmado', 'entregue'].includes(pedido.status) ? 'ok' : 'atual' },
    st === 'pagar_na_entrega'
      ? { rotulo: `Pagamento ${t.naHora}`, estado: 'ok' }
      : {
        rotulo: st === 'recusado' ? 'Pagamento não localizado' : 'Pagamento informado',
        estado: st === 'recusado' ? 'alerta' : (st ? 'ok' : 'pendente'),
      },
    { rotulo: 'Pagamento confirmado', estado: pago ? 'ok' : 'pendente' },
    { rotulo: t.concluido, estado: pedido.status === 'entregue' ? 'ok' : 'pendente' },
  ];
  // A primeira etapa ainda não concluída é a "atual".
  const proxima = etapas.find((e) => e.estado === 'pendente');
  if (proxima && etapas[0].estado === 'ok') proxima.estado = 'atual';

  const lista = el('ol', { className: 'etapas', attrs: { 'aria-label': 'Andamento do pedido' } });
  for (const etapa of etapas) {
    const item = el('li', { className: `etapa etapa-${etapa.estado}` });
    item.appendChild(el('span', {
      className: 'etapa-marca',
      text: etapa.estado === 'ok' ? '✓' : (etapa.estado === 'alerta' ? '!' : ''),
      attrs: { 'aria-hidden': 'true' },
    }));
    item.appendChild(el('span', { className: 'etapa-rotulo', text: etapa.rotulo }));
    if (etapa.estado === 'atual') item.setAttribute('aria-current', 'step');
    lista.appendChild(item);
  }
  return lista;
}

/** Lista "rótulo: valor" com os dados do pagamento (para os dois lados). */
export function renderDadosPagamento(pagamento, pedido) {
  const grid = el('div', { className: 'pedido-detalhes-grid pagamento-dados' });
  function celula(rotulo, valor) {
    if (valor == null || valor === '') return;
    const cell = el('div', { className: 'pedido-parte' });
    cell.appendChild(el('span', { className: 'pedido-parte-label', text: rotulo }));
    if (valor instanceof Node) cell.appendChild(valor);
    else cell.appendChild(el('span', { className: 'pedido-parte-valor', text: valor }));
    grid.appendChild(cell);
  }
  celula('Situação', renderBadgePagamento(pagamento.status, pedido));
  celula('Forma', rotuloMetodo(pagamento.metodo)
    + (pagamento.cartao_ultimos4 ? ` · final ${pagamento.cartao_ultimos4}` : '')
    + (pagamento.simulado ? ' (simulação)' : ''));
  celula('Valor', formatarMoeda(pagamento.valor));
  if (pagamento.status === 'pagar_na_entrega') {
    celula('Combinado em', formatarDataHora(pagamento.informado_em));
  } else {
    celula(pagamento.registrado_por === 'agricultor' ? 'Registrado em' : 'Informado em',
      formatarDataHora(pagamento.informado_em));
  }
  celula('Confirmado em', formatarDataHora(pagamento.confirmado_em));
  if (pagamento.status === 'recusado') {
    celula('Contestado em', formatarDataHora(pagamento.recusado_em));
    celula('Motivo informado', pagamento.motivo_recusa || 'Sem motivo informado');
  }
  celula('Observação do cliente', pagamento.observacao);
  return grid;
}

// =============================================================
// Ações do agricultor (usadas no detalhe do pedido e no chat)
// =============================================================

/**
 * Pede confirmação e registra o recebimento.
 * @returns {Promise<object|null>} resposta da API, ou null se o usuário desistiu.
 */
export async function acaoConfirmarRecebimento({ pedidoId, valor, metodo, semRegistro = false }) {
  const pergunta = semRegistro
    ? `Registrar que você recebeu ${formatarMoeda(valor)} deste pedido? O cliente será avisado pelo chat.`
    : `Confirmar que você recebeu ${formatarMoeda(valor)}${metodo ? ` via ${rotuloMetodo(metodo)}` : ''}? `
      + 'O cliente será avisado pelo chat.';
  if (!window.confirm(pergunta)) return null;
  const resposta = await confirmarPagamentoPedido(pedidoId);
  toast('Recebimento confirmado', { tipo: 'success' });
  return resposta;
}

/**
 * Pergunta o motivo (opcional) e marca o pagamento como não localizado.
 * @returns {Promise<object|null>} resposta da API, ou null se o usuário desistiu.
 */
export async function acaoContestarPagamento({ pedidoId }) {
  const motivo = window.prompt(
    'O cliente será avisado pelo chat de que você não localizou o pagamento e poderá informar de novo.\n\n'
    + 'Quer dizer o motivo? (opcional)',
    ''
  );
  if (motivo === null) return null; // cancelou o diálogo
  const resposta = await recusarPagamentoPedido(pedidoId, motivo.trim().slice(0, MOTIVO_MAX) || undefined);
  toast('Cliente avisado de que o pagamento não foi localizado', { tipo: 'info' });
  return resposta;
}
