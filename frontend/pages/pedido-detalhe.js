// pages/pedido-detalhe.js — Fase D — RF13 + RF11 (avaliação)
//
// Detalhe de um pedido específico, acessado por cliente OU agricultor.
//
// Carrega via GET /pedidos/:id. Mostra:
//   - bloco 1: header (id, status, datas)
//   - bloco 2: partes envolvidas (cliente, agricultor com link)
//   - bloco 3: itens (tabela com nome, qtd, preço, subtotal, total)
//   - bloco 4: detalhes (entrega ou retirada, forma combinada, observações)
//   - bloco 5: pagamento — situação + ações de cada lado:
//         cliente    → pagar / informar de novo / trocar a forma
//         agricultor → confirmar recebimento / avisar que não localizou
//   - bloco 6: ações dependentes de role × status
//
// Para o cliente, quando status='entregue', mostra "Avaliar agricultor" OU,
// se já avaliou aquele agricultor antes, mostra um bloco discreto "Você avaliou:"
// com link "Editar avaliação".
//
// Para detectar avaliação existente: paralelamente ao GET /pedidos/:id,
// chamamos GET /agricultores/:id/avaliacoes e procuramos uma onde
// cliente.id === user.id. O backend não devolve avaliações dentro do pedido.

import {
  el, limpar, bannerErro, formatarMoeda, formatarData, formatarDataHora, loading, toast,
} from '../ui.js';
import {
  getPedido, getPagamentoPedido, atualizarStatusPedido, listarAvaliacoesDoAgricultor,
} from '../api.js';
import { getUser } from '../auth.js';
import { navigate } from '../router.js';
import { renderStatusBadge } from './pedidos-lista.js';
import { abrirModalAvaliacao } from './modal-avaliacao.js';
import {
  termosEntrega, resumoEntrega, fraseProximoPasso, renderEtapas, renderDadosPagamento,
  acaoConfirmarRecebimento, acaoContestarPagamento,
} from '../pagamento-ui.js';

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
  // Pagamento: os DOIS lados consultam. `infoPagamento.pode` diz o que cada um faz agora.
  let infoPagamento = null;
  let erroPagamento = null;
  try {
    infoPagamento = await getPagamentoPedido(pedido.id);
  } catch (error) {
    erroPagamento = error;
    console.warn('[pedido-detalhe] falha ao consultar pagamento:', error);
  }
  const pagamentoExistente = infoPagamento?.pagamento || null;

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

  root.appendChild(renderHeaderPedido(pedido, pagamentoExistente));
  root.appendChild(renderPartes(pedido, user));
  root.appendChild(renderItens(pedido));
  root.appendChild(renderDetalhes(pedido));
  root.appendChild(renderBlocoPagamento(pedido, user, infoPagamento, erroPagamento));

  // Slot de erro acima do bloco de ações — usado por ações de status.
  const erroAcoes = el('div', { className: 'pedido-detalhe-erro-acoes' });
  root.appendChild(erroAcoes);

  root.appendChild(renderAcoes(pedido, user, erroAcoes, avaliacaoExistente, pagamentoExistente));
}

// =============================================================
// Bloco 1 — Header do pedido
// =============================================================
function renderHeaderPedido(pedido, pagamento) {
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
  meta.appendChild(el('span', { className: 'pedido-meta-sep', text: '•' }));
  meta.appendChild(el('span', { text: resumoEntrega(pedido) }));
  wrap.appendChild(meta);

  // Linha do tempo: confirmado → pagamento informado → pagamento confirmado → entregue/retirado
  const etapas = renderEtapas(pedido, pagamento);
  if (etapas) wrap.appendChild(etapas);

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

  const t = termosEntrega(pedido);
  function celula(rotulo, valor) {
    const cell = el('div', { className: 'pedido-parte' });
    cell.appendChild(el('span', { className: 'pedido-parte-label', text: rotulo }));
    cell.appendChild(el('span', { className: 'pedido-parte-valor', text: valor }));
    grid.appendChild(cell);
  }

  celula('Como o cliente recebe', t.ehEntrega ? 'Entrega pelo agricultor' : 'Retirada com o agricultor');
  celula(`Data da ${t.titulo.toLowerCase()}`, formatarDataHora(pedido.data_retirada) || 'A combinar pelo chat');
  celula(t.rotuloLocal, pedido.local_entrega || 'A combinar pelo chat');

  const fpNome = pedido.forma_pagamento?.nome
    || pedido.forma_pagamento_nome
    || `#${pedido.forma_pagamento_id || '—'}`;
  celula('Forma de pagamento combinada', fpNome);

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
// Bloco 5 — Pagamento (situação + ações de cada lado)
// =============================================================
function renderBlocoPagamento(pedido, user, info, erroCarga) {
  const wrap = el('div', { className: 'pedido-bloco pedido-pagamento-bloco' });
  wrap.appendChild(el('h2', { className: 'pedido-bloco-titulo', text: 'Pagamento' }));

  if (erroCarga) {
    wrap.appendChild(bannerErro('Não foi possível carregar a situação do pagamento. Recarregue a página.'));
    return wrap;
  }

  const pagamento = info?.pagamento || null;
  const pode = info?.pode || {};
  const ehCliente = user.role === 'cliente';
  const t = termosEntrega(pedido);
  const outro = ehCliente
    ? (pedido.agricultor_nome || 'o agricultor')
    : (pedido.cliente_nome || 'o cliente');

  // ---------- frase de situação ----------
  wrap.appendChild(el('p', {
    className: 'pedido-pagamento-frase',
    text: fraseSituacao({ pedido, pagamento, ehCliente, outro, t }),
  }));

  if (pagamento) wrap.appendChild(renderDadosPagamento(pagamento, pedido));

  // ---------- ações ----------
  const erro = el('div', { className: 'pedido-detalhe-erro-acoes' });
  const acoes = el('div', { className: 'pedido-acoes' });

  if (ehCliente && pode.pagar) {
    acoes.appendChild(el('a', {
      className: pagamento?.status === 'pagar_na_entrega' ? 'btn btn-secondary' : 'btn btn-primary',
      text: !pagamento ? 'Realizar pagamento'
        : (pagamento.status === 'recusado' ? 'Informar pagamento novamente' : 'Pagar de outra forma'),
      attrs: { href: `#/pedidos/${pedido.id}/pagamento` },
    }));
  } else if (ehCliente && pagamento && pagamento.status !== 'cancelado') {
    acoes.appendChild(el('a', {
      className: 'btn btn-secondary',
      text: 'Ver detalhes do pagamento',
      attrs: { href: `#/pedidos/${pedido.id}/pagamento` },
    }));
  }

  if (!ehCliente && pode.confirmar) {
    acoes.appendChild(botaoAcaoPagamento({
      erro, pedido,
      classes: 'btn btn-primary',
      label: pagamento ? 'Confirmar recebimento' : 'Registrar pagamento recebido',
      executar: () => acaoConfirmarRecebimento({
        pedidoId: pedido.id, valor: pedido.total, metodo: pagamento?.metodo, semRegistro: !pagamento,
      }),
    }));
  }
  if (!ehCliente && pode.recusar) {
    acoes.appendChild(botaoAcaoPagamento({
      erro, pedido,
      classes: 'btn btn-ghost pedido-acao-destrutiva',
      label: 'Não recebi',
      executar: () => acaoContestarPagamento({ pedidoId: pedido.id }),
    }));
  }

  if (acoes.childNodes.length > 0) {
    wrap.appendChild(erro);
    wrap.appendChild(acoes);
  }
  return wrap;
}

function fraseSituacao({ pedido, pagamento, ehCliente, outro, t }) {
  const valor = formatarMoeda(pagamento?.valor ?? pedido.total);
  if (!pagamento) {
    if (pedido.status === 'pendente') {
      return ehCliente
        ? `O pagamento fica disponível quando ${outro} confirmar o pedido.`
        : 'Confirme o pedido para liberar o pagamento ao cliente.';
    }
    if (pedido.status === 'cancelado') return 'Pedido cancelado — nenhum pagamento registrado.';
    return ehCliente
      ? `Falta pagar ${valor}. Escolha a forma e avise ${outro} — a confirmação chega pelo chat.`
      : `${outro} ainda não informou o pagamento de ${valor}. Se você já recebeu (em mãos, por exemplo), registre aqui.`;
  }
  switch (pagamento.status) {
    case 'aguardando_confirmacao':
      return ehCliente
        ? `Você informou o pagamento de ${valor}. Aguardando ${outro} confirmar o recebimento.`
        : `${outro} informou que pagou ${valor}. Confira se o valor chegou e confirme o recebimento.`;
    case 'pagar_na_entrega':
      return ehCliente
        ? `Você vai pagar ${valor} em dinheiro ${t.naHora}. ${fraseProximoPasso(pedido)}`
        : `${outro} vai pagar ${valor} em dinheiro ${t.naHora}. Ao receber, confirme aqui `
          + `(ou use “${t.marcar}”, que já confirma o recebimento).`;
    case 'aprovado':
      return `Pagamento de ${valor} confirmado. ${fraseProximoPasso(pedido)}`;
    case 'recusado':
      return ehCliente
        ? `${outro} não localizou o pagamento. Confira no seu banco e informe novamente.`
        : `Você avisou que não localizou o pagamento. ${outro} pode informar de novo — se o valor apareceu, é só confirmar.`;
    case 'cancelado':
      if (!pagamento.devolucao_pendente) return 'Pedido cancelado — pagamento cancelado.';
      return `O pedido foi cancelado depois de pago. Combine com ${outro} a devolução de ${valor} pelo chat.`;
    default:
      return '';
  }
}

/** Botão que executa uma ação de pagamento e recarrega a página em sucesso. */
function botaoAcaoPagamento({ erro, pedido, classes, label, executar }) {
  const btn = el('button', { className: classes, text: label, attrs: { type: 'button' } });
  btn.addEventListener('click', async () => {
    limpar(erro);
    btn.disabled = true;
    try {
      const resposta = await executar();
      if (resposta) { navigate('#/pedidos/' + pedido.id); return; }
    } catch (err) {
      erro.appendChild(bannerErro(err));
    }
    btn.disabled = false;
  });
  return btn;
}

// =============================================================
// Bloco 6 — Ações (depende de role × status)
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
      const t = termosEntrega(pedido);
      const stPag = pagamentoExistente?.status || null;
      const base = t.ehEntrega
        ? 'Confirmar que o pedido foi entregue ao cliente?'
        : 'Confirmar que o cliente retirou o pedido?';
      const sobrePagamento = stPag === 'aprovado' ? ''
        : stPag === 'pagar_na_entrega'
          ? `\n\nO pagamento em dinheiro (${formatarMoeda(pedido.total)}) também será marcado como recebido.`
          : '\n\nAtenção: o pagamento deste pedido ainda NÃO foi confirmado.';
      acoes.appendChild(btnAcaoStatus({
        pedido, erroSlot,
        novoStatus: 'entregue',
        label: stPag === 'pagar_na_entrega' ? `${t.marcar} e pago` : t.marcar,
        confirmMsg: base + sobrePagamento + '\n\nO cliente será avisado pelo chat.',
        classes: 'btn btn-primary',
      }));
      acoes.appendChild(btnAcaoStatus({
        pedido, erroSlot,
        novoStatus: 'cancelado',
        label: 'Cancelar pedido',
        confirmMsg: 'Cancelar este pedido? Esta ação não pode ser desfeita.'
          + (stPag === 'aprovado' ? '\n\nO pagamento já foi confirmado: você precisará combinar a devolução com o cliente.' : ''),
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
    } else if (status === 'confirmado') {
      // Pagamento tem bloco próprio acima; aqui não sobra ação para o cliente.
      acoes.appendChild(el('p', {
        className: 'pedido-sem-acoes form-help',
        text: 'Pedido confirmado. Acompanhe o pagamento acima e combine os detalhes pelo chat.',
      }));
    } else if (status === 'entregue') {
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
    } else {
      acoes.appendChild(textoSemAcoes(status));
    }
  }

  wrap.appendChild(acoes);
  return wrap;
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
  if (novoStatus === 'entregue') return 'Pedido concluído — cliente avisado pelo chat';
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
