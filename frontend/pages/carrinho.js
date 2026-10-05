// pages/carrinho.js — RF07 (carrinho por par cliente-agricultor) — Fase B
//
// Fluxo da página:
//   GET /carrinho/:agricultorId            → estado inicial
//   PATCH /carrinho/:agricultorId/itens/:itemId  (debounced ~400ms ao editar qtd)
//   DELETE /carrinho/:agricultorId/itens/:itemId (botão remover)
//   DELETE /carrinho/:agricultorId               (Limpar carrinho)
//   POST   /conversas/com/:agricultorId/snapshot (Enviar para o agricultor)
//
// Antes de enviar, o CLIENTE escolhe a forma de pagamento entre as que o
// agricultor aceita (perfil.formas_aceitas). A escolha vai junto com o
// carrinho e vira a forma de pagamento do pedido — o agricultor não escolhe.

import {
  el, limpar, bannerErro, criarAvatar, formatarMoeda,
  loading, estadoVazio, toast,
} from '../ui.js';
import {
  getCarrinho, atualizarItemCarrinho, removerItemCarrinho,
  limparCarrinho, enviarSnapshot, getAgricultor, imagemUrl,
} from '../api.js';
import { navigate } from '../router.js';

const DEBOUNCE_MS = 400;

const DICA_FORMA = {
  pix: 'Você paga no app do banco; o agricultor confirma.',
  transfer: 'Você transfere; o agricultor confirma.',
  cash: 'Você paga em mãos, na entrega ou retirada.',
  credit_card: 'Simulação acadêmica — nada é cobrado.',
  debit_card: 'Simulação acadêmica — nada é cobrado.',
};

export async function renderCarrinho({ outlet, params }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando carrinho...'));

  const agricultorId = params.agricultorId;

  let agricultor, carrinho;
  try {
    // Em paralelo: precisamos dos dois para montar header + lista.
    [agricultor, carrinho] = await Promise.all([
      getAgricultor(agricultorId),
      getCarrinho(agricultorId),
    ]);
  } catch (err) {
    limpar(outlet);
    outlet.appendChild(bannerErro(err));
    return;
  }

  limpar(outlet);

  // Header com info do agricultor
  outlet.appendChild(renderHeader(agricultor));

  // Container principal — re-renderizado a cada mutação do carrinho
  const container = el('div', { className: 'carrinho-container' });
  outlet.appendChild(container);

  renderConteudo(container, agricultorId, agricultor, carrinho);
}

function renderHeader(agricultor) {
  const wrap = el('div', { className: 'page-header carrinho-header' });

  const linha = el('div', { className: 'carrinho-header-linha' });
  linha.appendChild(criarAvatar(agricultor.nome, agricultor.perfil?.foto_id, 56));

  const info = el('div', { className: 'carrinho-header-info' });
  info.appendChild(el('p', { className: 'page-subtitle', text: 'Seu carrinho com' }));
  info.appendChild(el('a', {
    className: 'carrinho-header-link',
    text: agricultor.nome || 'Agricultor',
    attrs: { href: `#/agricultores/${agricultor.id}` },
  }));
  linha.appendChild(info);

  wrap.appendChild(linha);
  return wrap;
}

/** Renderiza o miolo da página (itens + total + ações). Chamada após cada update. */
function renderConteudo(container, agricultorId, agricultor, carrinho) {
  limpar(container);

  const itens = carrinho?.itens || [];

  if (itens.length === 0) {
    container.appendChild(estadoVazio('Seu carrinho está vazio.'));
    const voltar = el('div', { className: 'carrinho-vazio-actions' });
    voltar.appendChild(el('a', {
      className: 'btn btn-primary',
      text: '← Voltar ao perfil do agricultor',
      attrs: { href: `#/agricultores/${agricultorId}` },
    }));
    container.appendChild(voltar);
    return;
  }

  // Lista
  const lista = el('div', { className: 'carrinho-lista' });
  for (const item of itens) {
    lista.appendChild(linhaItem(item, agricultorId, agricultor, container));
  }
  container.appendChild(lista);

  // Total
  const totalBox = el('div', { className: 'carrinho-total' });
  totalBox.appendChild(el('span', { className: 'carrinho-total-label', text: 'Total' }));
  totalBox.appendChild(el('span', {
    className: 'carrinho-total-valor',
    text: formatarMoeda(carrinho.total || 0),
  }));
  container.appendChild(totalBox);

  // Forma de pagamento — escolhida pelo cliente. A seleção fica guardada no
  // container para sobreviver aos re-renders (editar quantidade, remover item).
  const formas = Array.isArray(agricultor?.perfil?.formas_aceitas) ? agricultor.perfil.formas_aceitas : [];
  if (formas.length > 0) {
    if (!formas.some((f) => f.id === container.dataset.metodo)) delete container.dataset.metodo;
    const bloco = el('div', { className: 'carrinho-pagamento' });
    bloco.appendChild(el('h2', { className: 'carrinho-pagamento-titulo', text: 'Como você quer pagar?' }));
    bloco.appendChild(el('p', {
      className: 'form-help',
      text: `Formas que ${agricultor.nome || 'o agricultor'} aceita. Você paga só depois que o pedido for confirmado, e ainda pode trocar na hora de pagar.`,
    }));
    const grupo = el('div', {
      className: 'pagamento-metodos',
      attrs: { role: 'radiogroup', 'aria-label': 'Forma de pagamento' },
    });
    const opcoes = [];
    for (const forma of formas) {
      const input = el('input', {
        attrs: { type: 'radio', name: 'carrinho-forma', value: forma.id, id: `carrinho-forma-${forma.id}` },
      });
      input.checked = container.dataset.metodo === forma.id;
      const label = el('label', {
        className: `radio-option pagamento-metodo ${input.checked ? 'is-selected' : ''}`,
        attrs: { for: `carrinho-forma-${forma.id}` },
      });
      label.appendChild(input);
      const textos = el('span', { className: 'pagamento-metodo-textos' });
      textos.appendChild(el('span', { className: 'pagamento-metodo-nome', text: forma.rotulo }));
      textos.appendChild(el('span', { className: 'form-help', text: DICA_FORMA[forma.id] || '' }));
      label.appendChild(textos);
      input.addEventListener('change', () => {
        container.dataset.metodo = forma.id;
        for (const o of opcoes) o.label.classList.toggle('is-selected', o.id === forma.id);
        limpar(erroSlot);
      });
      opcoes.push({ id: forma.id, label });
      grupo.appendChild(label);
    }
    bloco.appendChild(grupo);
    container.appendChild(bloco);
  }

  // Erro slot para o snapshot
  const erroSlot = el('div', { className: 'carrinho-erro-slot' });
  container.appendChild(erroSlot);

  // Ações principais
  const acoes = el('div', { className: 'carrinho-acoes' });

  acoes.appendChild(el('a', {
    className: 'btn btn-secondary',
    text: 'Continuar comprando',
    attrs: { href: `#/agricultores/${agricultorId}` },
  }));

  const btnSnapshot = el('button', {
    className: 'btn btn-primary',
    text: 'Enviar para o agricultor',
    attrs: { type: 'button' },
  });
  btnSnapshot.addEventListener('click', async () => {
    limpar(erroSlot);
    const metodo = container.dataset.metodo || undefined;
    if (formas.length > 0 && !metodo) {
      erroSlot.appendChild(bannerErro('Escolha como você quer pagar antes de enviar o carrinho.'));
      return;
    }
    btnSnapshot.disabled = true;
    btnSnapshot.textContent = 'Enviando...';
    try {
      const resp = await enviarSnapshot(agricultorId, { metodo_pagamento: metodo });
      toast('Carrinho enviado para o agricultor', { tipo: 'success' });
      const conversaId = resp?.conversa_id;
      if (conversaId) {
        navigate(`#/conversas/${conversaId}`);
      } else {
        // Sem id retornado: vai pra lista de conversas (fallback defensivo)
        navigate('#/conversas');
      }
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
      btnSnapshot.disabled = false;
      btnSnapshot.textContent = 'Enviar para o agricultor';
    }
  });
  acoes.appendChild(btnSnapshot);

  container.appendChild(acoes);

  // "Limpar carrinho" em rodapé discreto
  const rodape = el('div', { className: 'carrinho-rodape' });
  const btnLimpar = el('button', {
    className: 'btn btn-ghost',
    text: 'Limpar carrinho',
    attrs: { type: 'button' },
  });
  btnLimpar.addEventListener('click', async () => {
    // confirm() do browser, conforme prompt
    if (!confirm('Remover todos os itens do carrinho?')) return;
    btnLimpar.disabled = true;
    try {
      await limparCarrinho(agricultorId);
      // Re-busca pra atualizar o estado completo
      const novo = await getCarrinho(agricultorId);
      renderConteudo(container, agricultorId, agricultor, novo);
      toast('Carrinho limpo', { tipo: 'info' });
    } catch (err) {
      btnLimpar.disabled = false;
      erroSlot.appendChild(bannerErro(err));
    }
  });
  rodape.appendChild(btnLimpar);
  container.appendChild(rodape);
}

function linhaItem(item, agricultorId, agricultor, container) {
  const wrap = el('div', { className: 'carrinho-item' });

  // Foto
  const fotoWrap = el('div', { className: 'carrinho-item-foto' });
  if (item.foto_id) {
    const img = el('img', { attrs: { src: imagemUrl(item.foto_id), alt: item.nome || '' } });
    img.addEventListener('error', () => {
      limpar(fotoWrap);
      fotoWrap.textContent = 'Sem foto';
    });
    fotoWrap.appendChild(img);
  } else {
    fotoWrap.textContent = 'Sem foto';
  }
  wrap.appendChild(fotoWrap);

  // Nome + unitário
  const corpo = el('div', { className: 'carrinho-item-corpo' });
  corpo.appendChild(el('p', { className: 'carrinho-item-nome', text: item.nome || 'Produto' }));
  corpo.appendChild(el('p', {
    className: 'carrinho-item-unit',
    text: `${formatarMoeda(item.preco_unit)} cada`,
  }));
  wrap.appendChild(corpo);

  // Quantidade editável (debounced)
  const qtdWrap = el('div', { className: 'carrinho-item-qtd' });
  qtdWrap.appendChild(el('label', {
    text: 'Qtd',
    attrs: { for: `qtd-${item.id}` },
  }));
  const inputQtd = el('input', {
    attrs: {
      id: `qtd-${item.id}`,
      type: 'number',
      min: '0.01',
      step: '0.01',
      value: String(item.quantidade),
    },
  });
  qtdWrap.appendChild(inputQtd);
  wrap.appendChild(qtdWrap);

  // Subtotal
  const subtotalEl = el('div', {
    className: 'carrinho-item-subtotal',
    text: formatarMoeda(item.subtotal),
  });
  wrap.appendChild(subtotalEl);

  // Remover
  const btnRemover = el('button', {
    className: 'btn btn-ghost carrinho-item-remover',
    text: '🗑️',
    attrs: { type: 'button', 'aria-label': 'Remover item' },
  });
  btnRemover.addEventListener('click', async () => {
    btnRemover.disabled = true;
    try {
      const novo = await removerItemCarrinho(agricultorId, item.id);
      renderConteudo(container, agricultorId, agricultor, novo);
    } catch (err) {
      btnRemover.disabled = false;
      // banner curto no rodapé
      const erroSlot = container.querySelector('.carrinho-erro-slot');
      if (erroSlot) {
        limpar(erroSlot);
        erroSlot.appendChild(bannerErro(err));
      }
    }
  });
  wrap.appendChild(btnRemover);

  // Debounce do update de quantidade
  let timer = null;
  inputQtd.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const novaQtd = Number(inputQtd.value);
      if (!Number.isFinite(novaQtd) || novaQtd <= 0) {
        // valida inline: reverte input para o último valor conhecido válido
        inputQtd.value = String(item.quantidade);
        return;
      }
      // se igual à atual, nada a fazer
      if (Number(novaQtd) === Number(item.quantidade)) return;

      inputQtd.disabled = true;
      try {
        const novo = await atualizarItemCarrinho(agricultorId, item.id, {
          quantidade: novaQtd,
        });
        renderConteudo(container, agricultorId, agricultor, novo);
      } catch (err) {
        inputQtd.disabled = false;
        inputQtd.value = String(item.quantidade);
        const erroSlot = container.querySelector('.carrinho-erro-slot');
        if (erroSlot) {
          limpar(erroSlot);
          erroSlot.appendChild(bannerErro(err));
        }
      }
    }, DEBOUNCE_MS);
  });

  return wrap;
}
