// pages/pedido-detalhe.js — Fase D — RF13 + RF11 (avaliação)
//
// Detalhe de um pedido específico, acessado por cliente OU agricultor.
//
// Carrega via GET /pedidos/:id. Mostra:
//   - bloco 1: header (id, status, datas)
//   - bloco 2: partes envolvidas (cliente, agricultor com link)
//   - bloco 3: itens (tabela com nome, qtd, preço, subtotal, total)
//   - bloco 4: detalhes (forma de pagamento, observações)
//   - bloco 5: ações dependentes de role × status
//
// Para o cliente, quando status='entregue', mostra "Avaliar agricultor" OU,
// se já avaliou aquele agricultor antes, mostra um bloco discreto "Você avaliou:"
// com link "Editar avaliação".
//
// Para detectar avaliação existente: paralelamente ao GET /pedidos/:id,
// chamamos GET /agricultores/:id/avaliacoes e procuramos uma onde
// cliente.id === user.id. O backend não devolve avaliações dentro do pedido.

import {
  el, limpar, bannerErro, formatarMoeda, formatarData, loading, toast,
} from '../ui.js';
import {
  getPedido, getPagamentoPedido, atualizarStatusPedido, listarAvaliacoesDoAgricultor,
} from '../api.js';
import { getUser } from '../auth.js';
import { navigate } from '../router.js';
import { renderStatusBadge } from './pedidos-lista.js';
import { abrirModalAvaliacao } from './modal-avaliacao.js';

export async function renderPedidoDetalhe({ outlet, params }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando pedido...'));

  const user = getUser();
  if (!user?.id) return; // exigirRole já barrou.

  const pedidoId = params.id;

  let pedido;
  try {
    pedido = await getPedido(pedidoId);
  } catch (err) {
    limpar(outlet);
    if (err?.status === 404) {
      outlet.appendChild(blocoNaoEncontrado('Pedido não encontrado.'));
      return;
    }
    if (err?.status === 403) {
      outlet.appendChild(blocoNaoEncontrado('Você não tem acesso a este pedido.'));
      return;
    }
    outlet.appendChild(bannerErro(err));
    return;
  }

  // Se o cliente e o pedido está entregue, busca a avaliação existente em
  // paralelo (não bloqueante visualmente — montamos o resto da tela primeiro).
  let avaliacaoExistente = null;
  let pagamentoExistente = null;
  if (user.role === 'cliente' && ['confirmado', 'entregue'].includes(pedido.status)) {
    try {
      const resposta = await getPagamentoPedido(pedido.id);
      pagamentoExistente = resposta?.pagamento || null;
    } catch (error) {
      console.warn('[pedido-detalhe] falha ao consultar pagamento:', error);
    }
  }

  if (user.role === 'cliente' && pedido.status === 'entregue') {
    try {
      // Pega uma janela grande de uma vez; o front filtra por cliente_id local.
      const resp = await listarAvaliacoesDoAgricultor(pedido.agricultor_id, { limit: 50 });
      const minha = (resp?.items || []).find(
        (a) => Number(a.cliente?.id) === Number(user.id)
      );
      if (minha) avaliacaoExistente = minha;
    } catch (err) {
      // Não bloqueia: se falhar, mostra o botão "Avaliar" normalmente —
      // o backend faz upsert mesmo, então no pior caso o cliente "edita" via
      // POST mesmo sem o pré-preenchimento.
      console.warn('[pedido-detalhe] falha ao buscar avaliação:', err);
    }
  }

  limpar(outlet);

  const root = el('div', { className: 'pedido-detalhe-root' });
  outlet.appendChild(root);

  root.appendChild(renderHeaderPedido(pedido));
  root.appendChild(renderPartes(pedido, user));
  root.appendChild(renderItens(pedido));
  root.appendChild(renderDetalhes(pedido));

  // Slot de erro acima do bloco de ações — usado por ações de status.
  const erroAcoes = el('div', { className: 'pedido-detalhe-erro-acoes' });
  root.appendChild(erroAcoes);

  root.appendChild(renderAcoes(pedido, user, erroAcoes, avaliacaoExistente, pagamentoExistente));
}

// =============================================================
// Bloco 1 — Header do pedido
// =============================================================
function renderHeaderPedido(pedido) {
  const wrap = el('div', { className: 'pedido-bloco pedido-header-bloco' });

  const linha1 = el('div', { className: 'pedido-header-linha' });
  linha1.appendChild(el('h1', { className: 'pedido-titulo', text: `Pedido #${pedido.id}` }));
  linha1.appendChild(renderStatusBadge(pedido.status));
  wrap.appendChild(linha1);

  const meta = el('div', { className: 'pedido-meta' });
  meta.appendChild(el('span', {
    text: `Criado em ${formatarData(pedido.created_at)}`,
  }));
  if (pedido.updated_at && pedido.updated_at !== pedido.created_at) {
    meta.appendChild(el('span', {
      className: 'pedido-meta-sep',
      text: '•',
    }));
    meta.appendChild(el('span', {
      text: `Atualizado em ${formatarData(pedido.updated_at)}`,
    }));
  }
  if (pedido.data_retirada) {
    meta.appendChild(el('span', {
      className: 'pedido-meta-sep',
      text: '•',
    }));
    meta.appendChild(el('span', {
      text: `Retirada em ${formatarData(pedido.data_retirada)}`,
    }));
  }
  wrap.appendChild(meta);

  return wrap;
}

// =============================================================
// Bloco 2 — Partes envolvidas
// =============================================================
function renderPartes(pedido, user) {
  const wrap = el('div', { className: 'pedido-bloco' });
  wrap.appendChild(el('h2', { className: 'pedido-bloco-titulo', text: 'Partes envolvidas' }));

  const grid = el('div', { className: 'pedido-partes-grid' });

  // Cliente — sem link (cliente não tem perfil público)
  const cliCell = el('div', { className: 'pedido-parte' });
  cliCell.appendChild(el('span', { className: 'pedido-parte-label', text: 'Cliente' }));
  const cliNome = pedido.cliente_nome || pedido.cliente?.nome || `Cliente #${pedido.cliente_id}`;
  cliCell.appendChild(el('span', { className: 'pedido-parte-valor', text: cliNome }));
  grid.appendChild(cliCell);

  // Agricultor — nome + link para o perfil
  const agCell = el('div', { className: 'pedido-parte' });
  agCell.appendChild(el('span', { className: 'pedido-parte-label', text: 'Agricultor' }));
  const agNome = pedido.agricultor_nome || pedido.agricultor?.nome || `Agricultor #${pedido.agricultor_id}`;
  agCell.appendChild(el('a', {
    className: 'pedido-parte-valor',
    text: agNome,
    attrs: { href: `#/agricultores/${pedido.agricultor_id}` },
  }));
  grid.appendChild(agCell);

  wrap.appendChild(grid);

  // "Abrir conversa" — vai pra rota canônica /com/:outroId,
  // que resolve a conversa existente ou abre o pré-rascunho.
  const outroId = user.role === 'cliente' ? pedido.agricultor_id : pedido.cliente_id;
  if (outroId) {
    const acoes = el('div', { className: 'pedido-partes-acoes' });
    acoes.appendChild(el('a', {
      className: 'btn btn-secondary',
      text: 'Abrir conversa',
      attrs: { href: `#/conversas/com/${outroId}` },
    }));
    wrap.appendChild(acoes);
  }

  return wrap;
}

// =============================================================
// Bloco 3 — Itens do pedido
// =============================================================
function renderItens(pedido) {
  const wrap = el('div', { className: 'pedido-bloco' });
  wrap.appendChild(el('h2', { className: 'pedido-bloco-titulo', text: 'Itens' }));

  const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
  if (itens.length === 0) {
    wrap.appendChild(el('p', { className: 'form-help', text: 'Sem itens.' }));
    return wrap;
  }

  const tabela = el('div', { className: 'pedido-itens-tabela' });

  // Cabeçalho
  const cab = el('div', { className: 'pedido-itens-cab' });
  cab.appendChild(el('span', { text: 'Produto' }));
  cab.appendChild(el('span', { text: 'Quantidade' }));
  cab.appendChild(el('span', { text: 'Preço unit.' }));
  cab.appendChild(el('span', { text: 'Subtotal' }));
  tabela.appendChild(cab);

  for (const it of itens) {
    const linha = el('div', { className: 'pedido-item-linha' });
    linha.appendChild(el('span', {
      className: 'pedido-item-nome',
      text: it.nome_produto || it.nome || `Produto #${it.produto_id}`,
    }));
    linha.appendChild(el('span', {
      className: 'pedido-item-qtd',
      text: formatarQtd(it.quantidade),
    }));
    linha.appendChild(el('span', {
      className: 'pedido-item-preco',
      text: formatarMoeda(it.preco_unit),
    }));
    linha.appendChild(el('span', {
      className: 'pedido-item-subtotal',
      text: formatarMoeda(
        it.subtotal != null ? it.subtotal : Number(it.preco_unit || 0) * Number(it.quantidade || 0)
      ),
    }));
    tabela.appendChild(linha);
  }

  // Total
  const totalLinha = el('div', { className: 'pedido-itens-total' });
  totalLinha.appendChild(el('span', { text: 'Total' }));
  totalLinha.appendChild(el('strong', { text: formatarMoeda(pedido.total) }));
  tabela.appendChild(totalLinha);

  wrap.appendChild(tabela);
  return wrap;
}

// =============================================================
// Bloco 4 — Detalhes (forma de pagamento, observações)
// =============================================================
function renderDetalhes(pedido) {
  const wrap = el('div', { className: 'pedido-bloco' });
  wrap.appendChild(el('h2', { className: 'pedido-bloco-titulo', text: 'Detalhes' }));

  const grid = el('div', { className: 'pedido-detalhes-grid' });

  const fpCell = el('div', { className: 'pedido-parte' });
  fpCell.appendChild(el('span', { className: 'pedido-parte-label', text: 'Forma de pagamento' }));
  const fpNome = pedido.forma_pagamento?.nome
    || pedido.forma_pagamento_nome
    || `#${pedido.forma_pagamento_id || '—'}`;
  fpCell.appendChild(el('span', { className: 'pedido-parte-valor', text: fpNome }));
  grid.appendChild(fpCell);

  wrap.appendChild(grid);

  if (pedido.observacoes) {
    const obsBox = el('div', { className: 'pedido-obs' });
    obsBox.appendChild(el('span', { className: 'pedido-parte-label', text: 'Observações' }));
    obsBox.appendChild(el('p', { className: 'pedido-obs-texto', text: pedido.observacoes }));
    wrap.appendChild(obsBox);
  }

  return wrap;
}

// =============================================================
// Bloco 5 — Ações (depende de role × status)
// =============================================================
function renderAcoes(pedido, user, erroSlot, avaliacaoExistente, pagamentoExistente) {
  const wrap = el('div', { className: 'pedido-bloco pedido-acoes-bloco' });
  wrap.appendChild(el('h2', { className: 'pedido-bloco-titulo', text: 'Ações' }));

  const acoes = el('div', { className: 'pedido-acoes' });

  const role = user.role;
  const status = pedido.status;

  // Agricultor — pode evoluir status
  if (role === 'agricultor') {
    if (status === 'pendente') {
      acoes.appendChild(btnAcaoStatus({
        pedido, erroSlot,
        novoStatus: 'confirmado',
        label: 'Confirmar pedido',
        confirmMsg: 'Confirmar este pedido? O cliente será notificado e o estoque já está reservado.',
        classes: 'btn btn-primary',
      }));
      acoes.appendChild(btnAcaoStatus({
        pedido, erroSlot,
        novoStatus: 'cancelado',
        label: 'Cancelar pedido',
        confirmMsg: 'Cancelar este pedido? Esta ação não pode ser desfeita.',
        classes: 'btn btn-ghost pedido-acao-destrutiva',
      }));
    } else if (status === 'confirmado') {
      acoes.appendChild(btnAcaoStatus({
        pedido, erroSlot,
        novoStatus: 'entregue',
        label: 'Marcar como entregue',
        confirmMsg: 'Confirmar que o pedido foi entregue ao cliente?',
        classes: 'btn btn-primary',
      }));
      acoes.appendChild(btnAcaoStatus({
        pedido, erroSlot,
        novoStatus: 'cancelado',
        label: 'Cancelar pedido',
        confirmMsg: 'Cancelar este pedido? Esta ação não pode ser desfeita.',
        classes: 'btn btn-ghost pedido-acao-destrutiva',
      }));
    } else {
      acoes.appendChild(textoSemAcoes(status));
    }
  }

  // Cliente — pode cancelar enquanto pendente, e avaliar quando entregue
  if (role === 'cliente') {
    if (status === 'pendente') {
      acoes.appendChild(btnAcaoStatus({
        pedido, erroSlot,
        novoStatus: 'cancelado',
        label: 'Cancelar pedido',
        confirmMsg: 'Cancelar este pedido? Esta ação não pode ser desfeita.',
        classes: 'btn btn-ghost pedido-acao-destrutiva',
      }));
    } else if (status === 'confirmado' || status === 'entregue') {
      if (pagamentoExistente?.status === 'aprovado') {
        acoes.appendChild(el('p', {
          className: 'pagamento-aprovado-inline',
          text: `Pagamento aprovado · ${nomeMetodoPagamento(pagamentoExistente.metodo)}`,
        }));
      } else {
        acoes.appendChild(el('a', {
          className: 'btn btn-primary',
          text: 'Realizar pagamento',
          attrs: { href: `#/pedidos/${pedido.id}/pagamento` },
        }));
      }
      if (status === 'entregue') {
      if (avaliacaoExistente) {
        // Já avaliou — mostra bloco discreto + link "Editar avaliação"
        acoes.appendChild(renderJaAvaliado(pedido, avaliacaoExistente));
      } else {
        acoes.appendChild(el('button', {
          className: 'btn btn-primary',
          text: 'Avaliar agricultor',
          attrs: { type: 'button' },
          on: {
            click: () => abrirAvaliacao(pedido, null),
          },
        }));
      }
      }
    } else {
      acoes.appendChild(textoSemAcoes(status));
    }
  }

  wrap.appendChild(acoes);
  return wrap;
}

function nomeMetodoPagamento(metodo) {
  return ({
    pix: 'PIX',
    credit_card: 'cartão de crédito',
    debit_card: 'cartão de débito',
    cash: 'dinheiro na retirada',
  })[metodo] || 'método selecionado';
}

/** Botão genérico que pede confirmação e dispara PATCH /pedidos/:id/status. */
function btnAcaoStatus({ pedido, erroSlot, novoStatus, label, confirmMsg, classes }) {
  const btn = el('button', {
    className: classes,
    text: label,
    attrs: { type: 'button' },
  });
  btn.addEventListener('click', async () => {
    limpar(erroSlot);
    const ok = window.confirm(confirmMsg);
    if (!ok) return;

    btn.disabled = true;
    const textoAnterior = btn.textContent;
    btn.textContent = 'Atualizando...';

    try {
      await atualizarStatusPedido(pedido.id, novoStatus);
      toast(mensagemSucesso(novoStatus), { tipo: 'success' });
      // Re-renderiza a página inteira via navigate. Como a rota é a mesma,
      // o router força resolve(). Mais robusto que atualizar in-place.
      navigate('#/pedidos/' + pedido.id);
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
      btn.disabled = false;
      btn.textContent = textoAnterior;
    }
  });
  return btn;
}

function mensagemSucesso(novoStatus) {
  if (novoStatus === 'confirmado') return 'Pedido confirmado';
  if (novoStatus === 'entregue') return 'Pedido marcado como entregue';
  if (novoStatus === 'cancelado') return 'Pedido cancelado';
  return 'Status atualizado';
}

function textoSemAcoes(status) {
  return el('p', {
    className: 'pedido-sem-acoes form-help',
    text: status === 'entregue'
      ? 'Pedido concluído.'
      : (status === 'cancelado' ? 'Pedido cancelado.' : 'Sem ações disponíveis neste momento.'),
  });
}

// =============================================================
// "Já avaliado" — exibição da própria avaliação + link "Editar"
// =============================================================
function renderJaAvaliado(pedido, avaliacao) {
  const wrap = el('div', { className: 'pedido-ja-avaliado' });

  // Estrelas estáticas (★★★★☆) — montadas inline para ficar na mesma linha do texto.
  const nota = Number(avaliacao.nota) || 0;
  const cheias = Math.max(0, Math.min(5, Math.round(nota)));
  const cabec = el('span', { className: 'pedido-ja-avaliado-cabec' });
  cabec.appendChild(el('span', {
    className: 'pedido-ja-avaliado-titulo',
    text: 'Você avaliou: ',
  }));
  const estrelas = el('span', { className: 'pedido-ja-avaliado-stars' });
  estrelas.appendChild(el('span', { className: 'stars', text: '★'.repeat(cheias) }));
  if (cheias < 5) {
    estrelas.appendChild(el('span', {
      className: 'stars-empty',
      text: '★'.repeat(5 - cheias),
    }));
  }
  cabec.appendChild(estrelas);
  wrap.appendChild(cabec);

  if (avaliacao.comentario) {
    wrap.appendChild(el('p', {
      className: 'pedido-ja-avaliado-comentario',
      text: `“${avaliacao.comentario}”`,
    }));
  }

  // Link "Editar avaliação" — reabre o modal preenchido.
  const linkEditar = el('button', {
    className: 'btn btn-ghost pedido-ja-avaliado-editar',
    text: 'Editar avaliação',
    attrs: { type: 'button' },
    on: {
      click: () => abrirAvaliacao(pedido, avaliacao),
    },
  });
  wrap.appendChild(linkEditar);

  return wrap;
}

/** Abre o modal de avaliação, com ou sem pré-preenchimento. */
function abrirAvaliacao(pedido, avaliacaoExistente) {
  // Anexa o nome do agricultor no objeto pedido pra o modal usar no header.
  const pedidoEnriquecido = {
    ...pedido,
    agricultor_nome: pedido.agricultor_nome || pedido.agricultor?.nome,
  };
  abrirModalAvaliacao({
    pedido: pedidoEnriquecido,
    avaliacaoExistente,
    onAvaliado: () => {
      toast('Avaliação enviada', { tipo: 'success' });
      // Re-render via navigate — refaz o GET do pedido + GET das avaliações,
      // então o bloco "Já avaliado" aparece com os novos valores.
      navigate('#/pedidos/' + pedido.id);
    },
  });
}

// =============================================================
// Bloco de erro amigável (404 / 403)
// =============================================================
function blocoNaoEncontrado(mensagem) {
  const box = el('div', { className: 'em-breve' });
  box.appendChild(el('h2', { text: mensagem }));
  box.appendChild(el('p', { text: 'Volte para a lista de pedidos para continuar.' }));
  box.appendChild(el('a', {
    className: 'btn btn-secondary',
    text: '← Voltar para pedidos',
    attrs: { href: '#/pedidos' },
  }));
  return box;
}

// =============================================================
// Helpers
// =============================================================
function formatarQtd(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace('.', ',');
}
