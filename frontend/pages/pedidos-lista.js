// pages/pedidos-lista.js — Fase D — RF13
//
// Lista de pedidos do usuário logado. Mesma rota pra cliente e agricultor:
// o backend já filtra automaticamente por `cliente_id` ou `agricultor_id`
// conforme o role.
//
// URL:
//   #/pedidos                        → todos
//   #/pedidos?status=pendente        → filtro persistido na query string
//
// Filtros são chips clicáveis — selecionar um chip muda a URL via
// `location.hash`. Refresh/compartilhamento de URL funcionam naturalmente.

import {
  el, limpar, bannerErro, formatarMoeda, formatarData,
  loading, estadoVazio,
} from '../ui.js';
import { listarPedidos } from '../api.js';
import { getUser } from '../auth.js';
import { renderBadgePagamento } from '../pagamento-ui.js';

const LIMIT = 20;

const FILTROS = [
  { value: null, label: 'Todos' },
  { value: 'pendente', label: 'Pendentes' },
  { value: 'confirmado', label: 'Confirmados' },
  { value: 'entregue', label: 'Entregues' },
  { value: 'cancelado', label: 'Cancelados' },
];

const STATUS_LABEL = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export async function renderPedidosLista({ outlet, query }) {
  limpar(outlet);

  const user = getUser();
  if (!user?.id) return; // exigirRole já barrou; defensivo.

  const statusFiltro = parseStatus(query.status);
  const page = Math.max(1, parseInt(query.page, 10) || 1);

  // Header
  outlet.appendChild(renderPageHeader());

  // Chips de filtro
  outlet.appendChild(renderChipsFiltro(statusFiltro));

  // Área onde a lista é renderizada (ou re-renderizada)
  const listaArea = el('div', { className: 'pedidos-lista-area' });
  outlet.appendChild(listaArea);
  listaArea.appendChild(loading('Carregando pedidos...'));

  let resp;
  try {
    resp = await listarPedidos({
      status: statusFiltro || undefined,
      page,
      limit: LIMIT,
    });
  } catch (err) {
    limpar(listaArea);
    listaArea.appendChild(bannerErro(err));
    return;
  }

  limpar(listaArea);
  renderLista(listaArea, resp, page, statusFiltro, user);
}

// =============================================================
// Header
// =============================================================
function renderPageHeader() {
  const wrap = el('div', { className: 'page-header' });
  wrap.appendChild(el('h1', { className: 'page-title', text: 'Pedidos' }));
  wrap.appendChild(el('p', {
    className: 'page-subtitle',
    text: 'Acompanhe o andamento dos pedidos confirmados a partir dos snapshots de carrinho.',
  }));
  return wrap;
}

// =============================================================
// Chips de filtro
// =============================================================
function renderChipsFiltro(statusAtual) {
  const wrap = el('div', { className: 'pedidos-chips' });
  for (const f of FILTROS) {
    const ativo = (f.value || null) === (statusAtual || null);
    const chip = el('button', {
      className: `chip-filtro ${ativo ? 'is-active' : ''}`,
      text: f.label,
      attrs: { type: 'button', 'aria-pressed': ativo ? 'true' : 'false' },
      on: {
        click: () => {
          // Atualiza a URL; o router re-resolve.
          if (f.value) {
            location.hash = `#/pedidos?status=${encodeURIComponent(f.value)}`;
          } else {
            location.hash = '#/pedidos';
          }
        },
      },
    });
    wrap.appendChild(chip);
  }
  return wrap;
}

// =============================================================
// Lista
// =============================================================
function renderLista(area, resp, page, statusFiltro, user) {
  const items = resp?.items || [];
  const total = resp?.total || items.length;

  if (items.length === 0) {
    area.appendChild(estadoVazioPara(user.role, statusFiltro, page));
    return;
  }

  const tabela = el('div', { className: 'pedidos-tabela' });

  // Cabeçalho da "tabela" (visual — não usa <table>; é um grid responsivo)
  const cab = el('div', { className: 'pedidos-tabela-cabecalho' });
  cab.appendChild(el('span', { text: 'Data' }));
  cab.appendChild(el('span', {
    text: user.role === 'cliente' ? 'Agricultor' : 'Cliente',
  }));
  cab.appendChild(el('span', { text: 'Total' }));
  cab.appendChild(el('span', { text: 'Pagamento' }));
  cab.appendChild(el('span', { text: 'Status' }));
  tabela.appendChild(cab);

  for (const p of items) {
    tabela.appendChild(renderLinhaPedido(p, user));
  }
  area.appendChild(tabela);

  // Paginação
  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT));
  if (totalPaginas > 1) {
    area.appendChild(paginacao(page, totalPaginas, statusFiltro));
  }
}

function renderLinhaPedido(pedido, user) {
  // O backend pode devolver `cliente_nome`/`agricultor_nome` direto OU em
  // objetos aninhados; tratamos os dois formatos defensivamente.
  const linha = el('a', {
    className: 'pedido-linha',
    attrs: { href: `#/pedidos/${pedido.id}` },
  });

  // Coluna 1: data
  linha.appendChild(el('span', {
    className: 'pedido-linha-data',
    text: formatarData(pedido.created_at),
  }));

  // Coluna 2: outro lado (sempre o "outro" relativo ao usuário logado)
  const outroNome = user.role === 'cliente'
    ? (pedido.agricultor_nome || pedido.agricultor?.nome || `Agricultor #${pedido.agricultor_id}`)
    : (pedido.cliente_nome || pedido.cliente?.nome || `Cliente #${pedido.cliente_id}`);

  // Cliente vê o nome do agricultor LINKADO pro perfil dele; agricultor vê
  // apenas texto (não há perfil público de cliente).
  if (user.role === 'cliente') {
    const linkAg = el('span', {
      className: 'pedido-linha-outro',
      text: outroNome,
    });
    // Wrap em span (não <a> aninhado) — clique na linha já abre o pedido.
    // Pro perfil do agricultor, oferecemos botão dedicado no detalhe do pedido.
    linha.appendChild(linkAg);
  } else {
    linha.appendChild(el('span', {
      className: 'pedido-linha-outro',
      text: outroNome,
    }));
  }

  // Coluna 3: total
  linha.appendChild(el('span', {
    className: 'pedido-linha-total',
    text: formatarMoeda(pedido.total),
  }));

  // Coluna 4: situação do pagamento (o backend embute { status, metodo } no pedido)
  const pag = renderBadgePagamento(pedido.pagamento?.status, pedido);
  pag.classList.add('pedido-linha-pagamento');
  linha.appendChild(pag);

  // Coluna 5: status badge
  linha.appendChild(renderStatusBadge(pedido.status));

  return linha;
}

/**
 * Status badge reutilizado entre lista e detalhe.
 * Exportado para que `pedido-detalhe.js` use a mesma instância visual.
 */
export function renderStatusBadge(status) {
  const txt = STATUS_LABEL[status] || status || '—';
  return el('span', {
    className: `status-badge status-${status || 'desconhecido'}`,
    text: txt,
  });
}

// =============================================================
// Paginação — segue o padrão de meus-produtos.js / agricultores-lista.js
// =============================================================
function paginacao(pageAtual, totalPaginas, statusFiltro) {
  const wrap = el('div', { className: 'pagination' });

  function hashPara(p) {
    const params = new URLSearchParams();
    if (statusFiltro) params.set('status', statusFiltro);
    if (p > 1) params.set('page', p);
    const qs = params.toString();
    return '#/pedidos' + (qs ? '?' + qs : '');
  }

  const prev = el('button', {
    className: 'btn btn-secondary',
    text: '← Anterior',
    attrs: { type: 'button' },
    on: { click: () => { if (pageAtual > 1) location.hash = hashPara(pageAtual - 1); } },
  });
  if (pageAtual <= 1) prev.disabled = true;

  const next = el('button', {
    className: 'btn btn-secondary',
    text: 'Próxima →',
    attrs: { type: 'button' },
    on: { click: () => { if (pageAtual < totalPaginas) location.hash = hashPara(pageAtual + 1); } },
  });
  if (pageAtual >= totalPaginas) next.disabled = true;

  wrap.appendChild(prev);
  wrap.appendChild(el('span', {
    className: 'pagination-info',
    text: `Página ${pageAtual} de ${totalPaginas}`,
  }));
  wrap.appendChild(next);

  return wrap;
}

// =============================================================
// Helpers
// =============================================================

function parseStatus(raw) {
  if (!raw) return null;
  const v = String(raw).toLowerCase();
  if (['pendente', 'confirmado', 'entregue', 'cancelado'].includes(v)) return v;
  return null;
}

function estadoVazioPara(role, statusFiltro, page) {
  if (page > 1) {
    return estadoVazio('Nenhum pedido nesta página.');
  }
  if (statusFiltro) {
    const label = (STATUS_LABEL[statusFiltro] || statusFiltro).toLowerCase();
    return estadoVazio(`Nenhum pedido com status "${label}".`);
  }
  if (role === 'cliente') {
    return estadoVazio(
      'Você ainda não fez pedidos. Quando um agricultor confirmar um carrinho seu, ele aparece aqui.'
    );
  }
  if (role === 'agricultor') {
    return estadoVazio(
      'Você ainda não recebeu pedidos. Quando um cliente enviar um snapshot e você confirmar, o pedido aparece aqui.'
    );
  }
  return estadoVazio('Nenhum pedido para mostrar.');
}
