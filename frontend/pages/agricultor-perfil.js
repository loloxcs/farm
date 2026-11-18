// pages/agricultor-perfil.js
// RF03/RF09 (GET /agricultores/:id), RF10 (GET /agricultores/:id/produtos),
// RF11 (GET /agricultores/:id/avaliacoes)
// Fase B: ativa botões "Abrir conversa", "Ver carrinho" e "Adicionar ao carrinho".

import {
  el, limpar, bannerErro, criarAvatar, renderEstrelas,
  formatarMoeda, formatarData, loading, estadoVazio, toast, icone,
} from '../ui.js';
import {
  getAgricultor, listarProdutosDoAgricultor, listarAvaliacoesDoAgricultor,
  adicionarItemCarrinho, imagemUrl, listarFeiras,
} from '../api.js';
import { textoHorarios, enderecoFeira } from '../feira-ui.js';
import { isAuthenticated, getUser } from '../auth.js';

export async function renderAgricultorPerfil({ outlet, params }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando perfil...'));

  const id = params.id;

  let agricultor, produtosResp, avaliacoesResp, feirasResp;
  try {
    // Em paralelo: cada uma é um endpoint distinto.
    [agricultor, produtosResp, avaliacoesResp, feirasResp] = await Promise.all([
      getAgricultor(id),
      listarProdutosDoAgricultor(id, { page: 1, limit: 50 }).catch(() => ({ items: [] })),
      listarAvaliacoesDoAgricultor(id, { page: 1, limit: 20 }).catch(() => ({ items: [], resumo: {} })),
      listarFeiras({ agricultor_id: id }).catch(() => ({ items: [] })),
    ]);
  } catch (err) {
    limpar(outlet);
    outlet.appendChild(bannerErro(err));
    return;
  }

  limpar(outlet);

  outlet.appendChild(renderHeader(agricultor));

  // Produtos
  const secProd = el('section', { className: 'section' });
  const produtos = produtosResp?.items || [];
  secProd.appendChild(el('h2', {
    className: 'section-title',
    children: [el('span', { text: 'Produtos disponíveis' }), produtos.length ? el('span', { className: 'section-title-extra', text: String(produtos.length) }) : null],
  }));
  if (produtos.length === 0) {
    secProd.appendChild(estadoVazio('Este agricultor ainda não cadastrou produtos.'));
  } else {
    const grid = el('div', { className: 'grid' });
    for (const p of produtos) grid.appendChild(cardProduto(p, agricultor.id));
    secProd.appendChild(grid);
  }
  outlet.appendChild(secProd);

  // Feiras onde vende
  const feiras = feirasResp?.items || [];
  if (feiras.length) {
    const secFeiras = el('section', { className: 'section' });
    secFeiras.appendChild(el('h2', { className: 'section-title', text: 'Onde encontrar nas feiras' }));
    const lista = el('div', { className: 'feiras-lista' });
    for (const f of feiras) {
      const meu = f.participantes.find((p) => Number(p.agricultor.id) === Number(agricultor.id));
      const card = el('div', { className: 'card feira-card' });
      card.appendChild(el('h3', { children: [el('span', { className: 'feira-card-icone', children: [icone('barraca', { tamanho: 18 })] }), el('span', { text: f.nome })] }));
      card.appendChild(el('p', { className: 'feira-endereco', text: enderecoFeira(f) }));
      card.appendChild(el('p', { className: 'feira-meus-horarios', text: textoHorarios(meu?.horarios || []) }));
      lista.appendChild(card);
    }
    secFeiras.appendChild(lista);
    secFeiras.appendChild(el('a', {
      className: 'btn btn-ghost',
      attrs: { href: '#/mapa' },
      children: [icone('mapa', { tamanho: 16 }), el('span', { text: 'Ver feiras no mapa' })],
    }));
    outlet.appendChild(secFeiras);
  }

  // Avaliações
  const secAval = el('section', { className: 'section' });
  const resumo = avaliacoesResp?.resumo || {};
  const tituloAval = resumo.total
    ? `Avaliações (${resumo.total})`
    : 'Avaliações';
  secAval.appendChild(el('h2', { className: 'section-title', text: tituloAval }));

  const avaliacoes = avaliacoesResp?.items || [];
  if (avaliacoes.length === 0) {
    secAval.appendChild(estadoVazio('Este agricultor ainda não recebeu avaliações.'));
  } else {
    const lista = el('div', { className: 'review-list' });
    for (const av of avaliacoes) lista.appendChild(itemAvaliacao(av));
    secAval.appendChild(lista);
  }
  outlet.appendChild(secAval);
}

function renderHeader(agricultor) {
  // O backend devolve { id, nome, telefone, perfil: { ... } }
  const perfil = agricultor.perfil || {};
  const wrap = el('div', { className: 'profile-header' });

  wrap.appendChild(criarAvatar(agricultor.nome, perfil.foto_id, 96));

  const info = el('div', { className: 'profile-info' });
  info.appendChild(el('h1', { className: 'profile-nome', text: agricultor.nome || 'Agricultor' }));

  const local = [perfil.cidade, perfil.estado].filter(Boolean).join(' / ');
  if (local) {
    info.appendChild(el('p', {
      className: 'profile-local',
      children: [icone('pino', { tamanho: 16 }), el('span', { text: local })],
    }));
  }

  if (perfil.descricao) {
    info.appendChild(el('p', { className: 'profile-descricao', text: perfil.descricao }));
  }

  info.appendChild(renderEstrelas(perfil.media_avaliacoes, perfil.total_avaliacoes));

  // Formas de pagamento aceitas (a chave PIX em si só aparece no pagamento de um pedido confirmado)
  if (Array.isArray(perfil.formas_aceitas) && perfil.formas_aceitas.length > 0) {
    const formas = el('div', { className: 'profile-pagamento' });
    formas.appendChild(el('span', { className: 'profile-pagamento-label', text: 'Aceita' }));
    for (const f of perfil.formas_aceitas) {
      formas.appendChild(el('span', { className: 'chip', text: f.rotulo }));
    }
    info.appendChild(formas);
  }

  // Actions — Fase B: ativadas conforme role
  const actions = el('div', { className: 'profile-actions' });
  const logado = isAuthenticated();
  const user = getUser();
  const role = user?.role;
  const ehSiMesmo = logado && role === 'agricultor' && Number(user.id) === Number(agricultor.id);

  // "Abrir conversa" — qualquer logado que NÃO seja o próprio agricultor
  if (!ehSiMesmo) {
    if (logado) {
      actions.appendChild(el('button', {
        className: 'btn btn-primary',
        attrs: { type: 'button' },
        children: [icone('conversa', { tamanho: 18 }), el('span', { text: 'Abrir conversa' })],
        on: {
          click: () => { location.hash = `#/conversas/com/${agricultor.id}`; },
        },
      }));
    } else {
      // Não logado → leva pro login
      actions.appendChild(el('a', {
        className: 'btn btn-primary',
        text: 'Entrar para conversar',
        attrs: { href: '#/login' },
      }));
    }
  }

  // "Ver carrinho" — só cliente logado
  if (role === 'cliente') {
    actions.appendChild(el('a', {
      className: 'btn btn-secondary',
      attrs: { href: `#/carrinho/${agricultor.id}` },
      children: [icone('cesta', { tamanho: 18 }), el('span', { text: 'Ver carrinho' })],
    }));
  } else if (!logado) {
    actions.appendChild(el('a', {
      className: 'btn btn-secondary',
      text: 'Entrar para comprar',
      attrs: { href: '#/login' },
    }));
  } else if (role === 'agricultor' && !ehSiMesmo) {
    // Agricultor visitando outro agricultor: mantém tooltip explicando
    const wrapCarrinho = el('span', {
      className: 'tooltip-wrap',
      attrs: { 'data-tooltip': 'Apenas clientes podem comprar' },
    });
    wrapCarrinho.appendChild(el('button', {
      className: 'btn btn-secondary',
      text: 'Ver carrinho',
      attrs: { type: 'button', disabled: true },
    }));
    actions.appendChild(wrapCarrinho);
  }

  info.appendChild(actions);
  wrap.appendChild(info);
  return wrap;
}

function cardProduto(p, agricultorId) {
  const esgotado = Number(p.estoque) <= 0;
  const card = el('div', { className: `card card-produto${esgotado ? ' is-esgotado' : ''}` });

  const fotoWrap = el('div', { className: 'produto-foto' });
  if (p.foto_id) {
    const img = el('img', { attrs: { src: imagemUrl(p.foto_id), alt: p.nome || '' } });
    img.addEventListener('error', () => {
      limpar(fotoWrap);
      fotoWrap.textContent = 'Sem foto';
    });
    fotoWrap.appendChild(img);
  } else {
    fotoWrap.textContent = 'Sem foto';
  }
  if (esgotado) fotoWrap.appendChild(el('span', { className: 'produto-selo', text: 'Esgotado' }));
  card.appendChild(fotoWrap);

  card.appendChild(el('p', { className: 'produto-nome', text: p.nome || 'Produto' }));
  if (p.descricao) card.appendChild(el('p', { className: 'produto-descricao', text: p.descricao }));

  if (p.categoria?.nome) {
    card.appendChild(el('span', { className: 'produto-categoria', text: p.categoria.nome }));
  }

  card.appendChild(el('div', {
    className: 'produto-rodape',
    children: [
      el('p', {
        className: 'produto-preco',
        children: [el('span', { text: formatarMoeda(p.preco) }), el('span', { className: 'produto-unidade', text: ` / ${p.unidade || 'un'}` })],
      }),
      el('span', {
        className: 'produto-estoque',
        text: esgotado ? 'Sem estoque' : `${formatarEstoque(p.estoque, p.unidade)} disponíveis`,
      }),
    ],
  }));

  // Fase B — Adicionar ao carrinho. Comportamento depende do role.
  card.appendChild(addToCartArea(p, agricultorId));

  return card;
}

/**
 * Bloco de "Adicionar ao carrinho" dentro do card de produto.
 * - Não logado → botão "Entrar para comprar" → #/login
 * - Logado como agricultor → desabilitado com tooltip
 * - Logado como cliente → botão expande prompt inline com qtd + "Adicionar"
 */
function addToCartArea(produto, agricultorId) {
  const wrap = el('div', { className: 'produto-actions' });
  const user = getUser();
  const role = user?.role;

  if (!isAuthenticated()) {
    wrap.appendChild(el('a', {
      className: 'btn btn-secondary btn-block',
      text: 'Entrar para comprar',
      attrs: { href: '#/login' },
    }));
    return wrap;
  }

  if (role !== 'cliente') {
    const wrapBtn = el('span', {
      className: 'tooltip-wrap',
      attrs: { 'data-tooltip': 'Apenas clientes podem comprar' },
    });
    wrapBtn.appendChild(el('button', {
      className: 'btn btn-secondary btn-block',
      text: 'Adicionar ao carrinho',
      attrs: { type: 'button', disabled: true },
    }));
    wrap.appendChild(wrapBtn);
    return wrap;
  }

  if (Number(produto.estoque) <= 0) {
    wrap.appendChild(el('button', {
      className: 'btn btn-secondary btn-block',
      text: 'Esgotado',
      attrs: { type: 'button', disabled: true },
    }));
    return wrap;
  }

  // Cliente — abre prompt inline ao clicar
  const btnInicial = el('button', {
    className: 'btn btn-secondary btn-block',
    text: 'Adicionar ao carrinho',
    attrs: { type: 'button' },
  });
  wrap.appendChild(btnInicial);

  btnInicial.addEventListener('click', () => {
    limpar(wrap);
    wrap.appendChild(montarPromptQtd(produto, agricultorId, wrap));
  });

  return wrap;
}

/** Refaz o botão inicial dentro do mesmo wrap (usado pelo "Cancelar"). */
function reativarBotaoAdicionar(produto, agricultorId, wrap) {
  limpar(wrap);
  const btn = el('button', {
    className: 'btn btn-secondary btn-block',
    text: 'Adicionar ao carrinho',
    attrs: { type: 'button' },
  });
  btn.addEventListener('click', () => {
    limpar(wrap);
    wrap.appendChild(montarPromptQtd(produto, agricultorId, wrap));
  });
  wrap.appendChild(btn);
}

function montarPromptQtd(produto, agricultorId, wrap) {
  const form = el('form', { className: 'add-cart-form', attrs: { novalidate: true } });

  const inputId = `qtd-${produto.id}`;
  const field = el('div', { className: 'form-field' });
  field.appendChild(el('label', { text: `Quantidade (${produto.unidade || 'un'})`, attrs: { for: inputId } }));
  const input = el('input', {
    attrs: {
      id: inputId,
      type: 'number',
      min: '0.01',
      step: '0.01',
      value: '1',
      required: true,
    },
  });
  field.appendChild(input);
  form.appendChild(field);

  const linha = el('div', { className: 'add-cart-actions' });
  const btnAdicionar = el('button', {
    className: 'btn btn-primary',
    text: 'Adicionar',
    attrs: { type: 'submit' },
  });
  const btnCancelar = el('button', {
    className: 'btn btn-ghost',
    text: 'Cancelar',
    attrs: { type: 'button' },
    on: {
      click: () => reativarBotaoAdicionar(produto, agricultorId, wrap),
    },
  });
  linha.appendChild(btnAdicionar);
  linha.appendChild(btnCancelar);
  form.appendChild(linha);

  const erroSlot = el('div');
  form.appendChild(erroSlot);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erroSlot);

    const qtd = Number(input.value);
    if (!Number.isFinite(qtd) || qtd <= 0) {
      erroSlot.appendChild(bannerErro('Informe uma quantidade maior que zero.'));
      return;
    }

    btnAdicionar.disabled = true;
    btnAdicionar.textContent = 'Adicionando...';

    try {
      await adicionarItemCarrinho(agricultorId, {
        produto_id: produto.id,
        quantidade: qtd,
      });
      // Recolhe o prompt e mostra confirmação no card
      limpar(wrap);
      const ok = el('div', { className: 'add-cart-ok' });
      ok.appendChild(el('span', { text: 'Adicionado ao carrinho' }));
      ok.appendChild(el('a', {
        className: 'btn btn-ghost',
        text: 'Ver carrinho',
        attrs: { href: `#/carrinho/${agricultorId}` },
      }));
      wrap.appendChild(ok);
      toast('Item adicionado ao carrinho', { tipo: 'success' });
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
      btnAdicionar.disabled = false;
      btnAdicionar.textContent = 'Adicionar';
    }
  });

  return form;
}

function formatarEstoque(estoque, unidade) {
  const n = Number(estoque);
  if (!Number.isFinite(n)) return '—';
  // estoque é REAL no schema; mostrar inteiro se for inteiro
  const txt = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return `${txt} ${unidade || 'un'}`;
}

function itemAvaliacao(av) {
  const wrap = el('div', { className: 'review-item' });

  const header = el('div', { className: 'review-header' });
  const author = el('div', { className: 'review-author' });
  author.appendChild(criarAvatar(av.cliente?.nome, av.cliente?.foto_id, 32));
  author.appendChild(el('span', { text: av.cliente?.nome || 'Cliente' }));
  header.appendChild(author);

  // Nota visual (estrelas) + data
  const dir = el('div', { className: 'review-header-right' });
  dir.appendChild(renderEstrelas(av.nota, 0));
  if (av.created_at) {
    dir.appendChild(el('div', {
      className: 'review-date',
      text: formatarData(av.created_at),
    }));
  }
  header.appendChild(dir);
  wrap.appendChild(header);

  if (av.comentario) {
    wrap.appendChild(el('p', { className: 'review-comentario', text: av.comentario }));
  }
  return wrap;
}
