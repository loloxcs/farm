// pages/meus-produtos.js — RF04, RF05, RF06 — Fase C
//
// Painel do agricultor para gerenciar seus produtos:
//   GET /agricultores/:id/produtos      → lista
//   POST /produtos                      → criar (modal)
//   PATCH /produtos/:id                 → editar (modal)
//   DELETE /produtos/:id                → inativar (soft delete)
//   GET /categorias                     → popular select do modal
//
// Padrão "atualizar localmente quando responsivo, re-buscar quando crítico":
// depois de criar/editar/inativar, **re-busca** a listagem inteira pra evitar
// qualquer inconsistência local com paginação e filtros.

import {
  el, limpar, bannerErro, formatarMoeda, loading, estadoVazio, toast,
  campoUploadFoto, icone,
} from '../ui.js';
import {
  listarProdutosDoAgricultor, criarProduto, atualizarProduto,
  removerProduto, listarCategorias, imagemUrl,
} from '../api.js';
import { getUser } from '../auth.js';

const LIMIT = 50;
const UNIDADES = ['un', 'kg', 'g', 'L', 'mL', 'dz', 'cx', 'mç'];
const DESC_MAX = 500;

// Cache de categorias em memória — populadas no primeiro render da página.
let categoriasCache = null;

export async function renderMeusProdutos({ outlet, query }) {
  limpar(outlet);

  const user = getUser();
  if (!user?.id) return; // exigirRole já barrou; defensivo

  const page = Math.max(1, parseInt(query.page, 10) || 1);

  // Header da página
  outlet.appendChild(renderPageHeader());

  // Slot de erro acima da listagem
  const erroSlot = el('div', { className: 'meus-produtos-erro-slot' });
  outlet.appendChild(erroSlot);

  // Área da lista (vamos re-renderizar aqui após mutações)
  const listaArea = el('div');
  outlet.appendChild(listaArea);
  listaArea.appendChild(loading('Carregando produtos...'));

  // Carrega categorias em paralelo com a lista. As categorias são pequenas
  // e ficam em cache pra abertura instantânea do modal.
  let produtosResp;
  try {
    const [cats, p] = await Promise.all([
      categoriasCache ? Promise.resolve(categoriasCache) : listarCategorias(),
      listarProdutosDoAgricultor(user.id, { page, limit: LIMIT }),
    ]);
    if (!categoriasCache) categoriasCache = cats || [];
    produtosResp = p;
  } catch (err) {
    limpar(listaArea);
    listaArea.appendChild(bannerErro(err));
    return;
  }

  // Recarrega a lista — função reutilizável após criar/editar/inativar
  async function recarregar() {
    limpar(listaArea);
    listaArea.appendChild(loading('Atualizando...'));
    try {
      const novo = await listarProdutosDoAgricultor(user.id, { page, limit: LIMIT });
      renderLista(listaArea, novo, page, erroSlot, recarregar);
    } catch (err) {
      limpar(listaArea);
      listaArea.appendChild(bannerErro(err));
    }
  }

  renderLista(listaArea, produtosResp, page, erroSlot, recarregar);

  // Wire do botão "+ Novo produto" no header
  const btnNovo = outlet.querySelector('[data-acao="novo-produto"]');
  if (btnNovo) {
    btnNovo.addEventListener('click', () => abrirModalProduto({
      modo: 'criar',
      onSalvo: recarregar,
    }));
  }
}

// =============================================================
// Render da página
// =============================================================

function renderPageHeader() {
  const wrap = el('div', { className: 'page-header meus-produtos-header' });

  const info = el('div');
  info.appendChild(el('h1', { className: 'page-title', text: 'Meus produtos' }));
  info.appendChild(el('p', {
    className: 'page-subtitle',
    text: 'Cadastre, edite e inative os produtos que você oferece aos clientes.',
  }));
  wrap.appendChild(info);

  wrap.appendChild(el('button', {
    className: 'btn btn-primary',
    attrs: { type: 'button', 'data-acao': 'novo-produto' },
    children: [icone('mais', { tamanho: 18 }), el('span', { text: 'Novo produto' })],
  }));

  return wrap;
}

function renderLista(area, produtosResp, page, erroSlot, recarregar) {
  limpar(area);

  const items = produtosResp?.items || [];
  if (items.length === 0) {
    if (page > 1) {
      // Página vazia — talvez itens tenham sido inativados
      area.appendChild(estadoVazio('Nenhum produto nesta página.'));
      area.appendChild(paginacao(page, page, false));
      return;
    }
    // Estado vazio "primeira vez"
    const vazio = el('div', { className: 'meus-produtos-vazio' });
    vazio.appendChild(estadoVazio('Você ainda não cadastrou produtos.'));
    const acao = el('div', { className: 'meus-produtos-vazio-acao' });
    acao.appendChild(el('button', {
      className: 'btn btn-primary',
      text: 'Cadastrar primeiro produto',
      attrs: { type: 'button' },
      on: {
        click: () => abrirModalProduto({ modo: 'criar', onSalvo: recarregar }),
      },
    }));
    vazio.appendChild(acao);
    area.appendChild(vazio);
    return;
  }

  const grid = el('div', { className: 'grid' });
  for (const p of items) {
    grid.appendChild(cardProduto(p, erroSlot, recarregar));
  }
  area.appendChild(grid);

  // Paginação se passar do limit
  const total = produtosResp.total || items.length;
  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT));
  if (totalPaginas > 1) {
    area.appendChild(paginacao(page, totalPaginas, true));
  }
}

function cardProduto(produto, erroSlot, recarregar) {
  const esgotado = Number(produto.estoque) <= 0;
  const card = el('div', { className: `card card-produto card-meu-produto${esgotado ? ' is-esgotado' : ''}` });

  // Foto
  const fotoWrap = el('div', { className: 'produto-foto' });
  if (produto.foto_id) {
    const img = el('img', { attrs: { src: imagemUrl(produto.foto_id), alt: produto.nome || '' } });
    img.addEventListener('error', () => {
      limpar(fotoWrap);
      fotoWrap.textContent = 'Sem foto';
    });
    fotoWrap.appendChild(img);
  } else {
    fotoWrap.textContent = 'Sem foto';
  }
  if (esgotado) fotoWrap.appendChild(el('span', { className: 'produto-selo', text: 'Sem estoque' }));
  card.appendChild(fotoWrap);

  // Nome
  card.appendChild(el('p', { className: 'produto-nome', text: produto.nome || 'Produto' }));

  // Categoria
  if (produto.categoria?.nome) {
    card.appendChild(el('span', {
      className: 'produto-categoria chip',
      text: produto.categoria.nome,
    }));
  }

  // Preço por unidade + estoque
  card.appendChild(el('div', {
    className: 'produto-rodape',
    children: [
      el('p', {
        className: 'produto-preco',
        children: [el('span', { text: formatarMoeda(produto.preco) }), el('span', { className: 'produto-unidade', text: ` / ${produto.unidade || 'un'}` })],
      }),
      el('span', {
        className: 'produto-estoque',
        text: `Estoque: ${formatarEstoque(produto.estoque, produto.unidade)}`,
      }),
    ],
  }));

  // Botões de ação no rodapé do card
  const acoes = el('div', { className: 'meu-produto-acoes' });

  acoes.appendChild(el('button', {
    className: 'btn btn-secondary',
    text: 'Editar',
    attrs: { type: 'button' },
    on: {
      click: () => abrirModalProduto({ modo: 'editar', produto, onSalvo: recarregar }),
    },
  }));

  acoes.appendChild(el('button', {
    className: 'btn btn-ghost meu-produto-btn-inativar',
    text: 'Inativar',
    attrs: { type: 'button' },
    on: {
      click: () => inativarProduto(produto, erroSlot, recarregar),
    },
  }));

  card.appendChild(acoes);
  return card;
}

async function inativarProduto(produto, erroSlot, recarregar) {
  limpar(erroSlot);
  const ok = window.confirm('Inativar este produto? Ele deixará de aparecer pra clientes.');
  if (!ok) return;

  try {
    await removerProduto(produto.id);
    toast('Produto inativado', { tipo: 'success' });
    await recarregar();
  } catch (err) {
    erroSlot.appendChild(bannerErro(err));
  }
}

function paginacao(pageAtual, totalPaginas, podeAvancar) {
  const wrap = el('div', { className: 'pagination' });

  function hashPara(p) {
    const params = new URLSearchParams();
    if (p > 1) params.set('page', p);
    const qs = params.toString();
    return '#/meus-produtos' + (qs ? '?' + qs : '');
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
  if (pageAtual >= totalPaginas || !podeAvancar) next.disabled = true;

  wrap.appendChild(prev);
  wrap.appendChild(el('span', {
    className: 'pagination-info',
    text: `Página ${pageAtual} de ${totalPaginas}`,
  }));
  wrap.appendChild(next);

  return wrap;
}

function formatarEstoque(estoque, unidade) {
  const n = Number(estoque);
  if (!Number.isFinite(n)) return '—';
  const txt = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return `${txt} ${unidade || 'un'}`;
}

// =============================================================
// Modal de criar/editar produto
// =============================================================
//
// Acessibilidade básica:
//  - Foco automático no primeiro input ao abrir
//  - Esc fecha
//  - Click no overlay (fora do card) fecha
//  - Tab trap NÃO implementado (projeto acadêmico, conforme prompt)

function abrirModalProduto({ modo, produto, onSalvo }) {
  const ehEdicao = modo === 'editar' && produto;
  const titulo = ehEdicao ? 'Editar produto' : 'Novo produto';

  const overlay = el('div', { className: 'modal-overlay' });
  const card = el('div', { className: 'modal-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo } });

  // Header do modal
  const header = el('div', { className: 'modal-header' });
  header.appendChild(el('h2', { className: 'modal-title', text: titulo }));
  const btnClose = el('button', {
    className: 'btn btn-ghost modal-close',
    text: '×',
    attrs: { type: 'button', 'aria-label': 'Fechar' },
  });
  header.appendChild(btnClose);
  card.appendChild(header);

  // Corpo do modal (form)
  const form = el('form', { className: 'modal-form', attrs: { novalidate: true } });
  const erroSlot = el('div');
  form.appendChild(erroSlot);

  // Upload de foto
  const upload = campoUploadFoto({
    fotoIdInicial: ehEdicao ? produto.foto_id : null,
    label: 'Foto do produto',
  });
  form.appendChild(upload.node);

  // Nome
  const nomeField = campoTexto({
    id: 'mp-nome', label: 'Nome', type: 'text',
    value: ehEdicao ? produto.nome : '', required: true,
  });
  form.appendChild(nomeField.node);

  // Descrição
  const descWrap = el('div', { className: 'form-field' });
  descWrap.appendChild(el('label', { text: 'Descrição', attrs: { for: 'mp-descricao' } }));
  const descTextarea = el('textarea', {
    attrs: { id: 'mp-descricao', maxlength: DESC_MAX, rows: 3 },
  });
  descTextarea.value = ehEdicao ? (produto.descricao || '') : '';
  descWrap.appendChild(descTextarea);
  const descContador = el('span', { className: 'form-help form-contador' });
  descWrap.appendChild(descContador);
  function atualizarContador() {
    descContador.textContent = `${descTextarea.value.length} / ${DESC_MAX}`;
  }
  atualizarContador();
  descTextarea.addEventListener('input', atualizarContador);
  form.appendChild(descWrap);

  // Categoria (select populado do cache)
  const catWrap = el('div', { className: 'form-field' });
  catWrap.appendChild(el('label', { text: 'Categoria', attrs: { for: 'mp-categoria' } }));
  const catSelect = el('select', { attrs: { id: 'mp-categoria', required: true } });
  catSelect.appendChild(el('option', { text: '— selecione —', attrs: { value: '' } }));
  for (const c of (categoriasCache || [])) {
    catSelect.appendChild(el('option', { text: c.nome, attrs: { value: String(c.id) } }));
  }
  if (ehEdicao && produto.categoria?.id) {
    catSelect.value = String(produto.categoria.id);
  }
  catWrap.appendChild(catSelect);
  form.appendChild(catWrap);

  // Preço + Unidade em linha
  const linhaPreco = el('div', { className: 'form-linha-dupla' });
  const precoField = campoTexto({
    id: 'mp-preco', label: 'Preço (R$)', type: 'number',
    value: ehEdicao ? String(produto.preco) : '',
    required: true,
    extraAttrs: { min: '0', step: '0.01', inputmode: 'decimal' },
  });
  precoField.node.classList.add('form-linha-flex');
  linhaPreco.appendChild(precoField.node);

  const unidWrap = el('div', { className: 'form-field' });
  unidWrap.appendChild(el('label', { text: 'Unidade', attrs: { for: 'mp-unidade' } }));
  const unidSelect = el('select', { attrs: { id: 'mp-unidade', required: true } });
  for (const u of UNIDADES) {
    unidSelect.appendChild(el('option', { text: u, attrs: { value: u } }));
  }
  unidSelect.value = ehEdicao ? (produto.unidade || 'un') : 'un';
  unidWrap.appendChild(unidSelect);
  linhaPreco.appendChild(unidWrap);
  form.appendChild(linhaPreco);

  // Estoque
  const estoqueField = campoTexto({
    id: 'mp-estoque', label: 'Estoque', type: 'number',
    value: ehEdicao ? String(produto.estoque ?? 0) : '0',
    required: true,
    extraAttrs: { min: '0', step: '0.01', inputmode: 'decimal' },
  });
  form.appendChild(estoqueField.node);

  // Rodapé do modal — botões
  const footer = el('div', { className: 'modal-footer' });
  const btnCancelar = el('button', {
    className: 'btn btn-ghost',
    text: 'Cancelar',
    attrs: { type: 'button' },
  });
  const btnSalvar = el('button', {
    className: 'btn btn-primary',
    text: ehEdicao ? 'Salvar alterações' : 'Cadastrar produto',
    attrs: { type: 'submit' },
  });
  footer.appendChild(btnCancelar);
  footer.appendChild(btnSalvar);
  form.appendChild(footer);

  card.appendChild(form);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Fechar — três caminhos: botão ×, botão Cancelar, click no overlay, Esc.
  function fechar() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', escListener);
    document.body.classList.remove('modal-aberto');
  }
  function escListener(ev) {
    if (ev.key === 'Escape') fechar();
  }
  btnClose.addEventListener('click', fechar);
  btnCancelar.addEventListener('click', fechar);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) fechar();
  });
  document.addEventListener('keydown', escListener);
  document.body.classList.add('modal-aberto');

  // Foco no primeiro input
  setTimeout(() => nomeField.input.focus(), 0);

  // Submit do form
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erroSlot);

    const nome = nomeField.input.value.trim();
    const descricao = descTextarea.value.trim();
    const categoria_id = parseInt(catSelect.value, 10);
    const preco = parseFloat(precoField.input.value);
    const unidade = unidSelect.value;
    const estoque = parseFloat(estoqueField.input.value);

    // Validações
    if (!nome) {
      erroSlot.appendChild(bannerErro('Informe o nome do produto.'));
      return;
    }
    if (descricao.length > DESC_MAX) {
      erroSlot.appendChild(bannerErro(`Descrição não pode passar de ${DESC_MAX} caracteres.`));
      return;
    }
    if (!Number.isInteger(categoria_id) || categoria_id <= 0) {
      erroSlot.appendChild(bannerErro('Selecione uma categoria.'));
      return;
    }
    if (!Number.isFinite(preco) || preco < 0) {
      erroSlot.appendChild(bannerErro('Preço deve ser um número maior ou igual a zero.'));
      return;
    }
    if (!UNIDADES.includes(unidade)) {
      erroSlot.appendChild(bannerErro('Selecione uma unidade válida.'));
      return;
    }
    if (!Number.isFinite(estoque) || estoque < 0) {
      erroSlot.appendChild(bannerErro('Estoque deve ser um número maior ou igual a zero.'));
      return;
    }

    btnSalvar.disabled = true;
    btnSalvar.textContent = ehEdicao ? 'Salvando...' : 'Cadastrando...';

    // Lê a foto (se houver nova)
    let fotoPayload;
    try {
      fotoPayload = await upload.getValue();
    } catch (err) {
      erroSlot.appendChild(bannerErro('Não foi possível ler o arquivo de foto: ' + (err?.message || 'erro desconhecido')));
      btnSalvar.disabled = false;
      btnSalvar.textContent = ehEdicao ? 'Salvar alterações' : 'Cadastrar produto';
      return;
    }

    try {
      if (ehEdicao) {
        // Editar — patch só com o que mudou
        const patch = {};
        if (nome !== produto.nome) patch.nome = nome;
        if ((descricao || '') !== (produto.descricao || '')) patch.descricao = descricao || null;
        if (categoria_id !== produto.categoria?.id) patch.categoria_id = categoria_id;
        if (preco !== Number(produto.preco)) patch.preco = preco;
        if (unidade !== produto.unidade) patch.unidade = unidade;
        if (estoque !== Number(produto.estoque)) patch.estoque = estoque;
        if (fotoPayload) {
          patch.foto_base64 = fotoPayload.foto_base64;
          patch.foto_mime = fotoPayload.foto_mime;
        }
        if (Object.keys(patch).length === 0) {
          toast('Nada a salvar', { tipo: 'info' });
          fechar();
          return;
        }
        await atualizarProduto(produto.id, patch);
        toast('Produto atualizado', { tipo: 'success' });
      } else {
        // Criar
        const payload = {
          nome, descricao: descricao || null, categoria_id, preco, unidade, estoque,
          ...(fotoPayload || {}),
        };
        await criarProduto(payload);
        toast('Produto cadastrado', { tipo: 'success' });
      }
      fechar();
      if (typeof onSalvo === 'function') await onSalvo();
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
      btnSalvar.disabled = false;
      btnSalvar.textContent = ehEdicao ? 'Salvar alterações' : 'Cadastrar produto';
    }
  });
}

// =============================================================
// Helpers
// =============================================================

function campoTexto({ id, label, type = 'text', value = '', required = false, extraAttrs = {} }) {
  const node = el('div', { className: 'form-field' });
  node.appendChild(el('label', { text: label, attrs: { for: id } }));
  const attrs = { id, name: id, type, ...extraAttrs };
  if (required) attrs.required = true;
  const input = el('input', { attrs });
  input.value = value;
  node.appendChild(input);
  return { node, input };
}
