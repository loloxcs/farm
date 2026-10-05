// ui.js — helpers DOM puros e formatadores.
//
// Estratégia: nunca usar innerHTML com dados do servidor. Todos os helpers
// abaixo usam textContent + createElement, então XSS via campos do usuário
// fica neutralizado.

import { imagemUrl } from './api.js';

/**
 * Cria um elemento HTML configurado de uma vez.
 * @param {string} tag
 * @param {{className?:string, text?:string, attrs?:object, on?:object,
 *          children?:(Node|null|undefined|false|string)[]}} [opts]
 */
export function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === false || v == null) continue;
      if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  if (opts.on) {
    for (const [evt, fn] of Object.entries(opts.on)) {
      node.addEventListener(evt, fn);
    }
  }
  if (opts.children) {
    for (const child of opts.children) {
      if (child == null || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

/** Esvazia um elemento (mais barato que innerHTML = ''). */
export function limpar(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Cria um avatar circular. Se `fotoId` existir, usa <img>; senão renderiza
 * um círculo colorido com a inicial do nome.
 * @param {string} nome
 * @param {number|null|undefined} fotoId
 * @param {number} [tamanho=48] em px
 */
export function criarAvatar(nome, fotoId, tamanho = 48) {
  const wrap = el('div', {
    className: 'avatar',
    attrs: { 'aria-label': `Avatar de ${nome || 'usuário'}` },
  });
  // Único uso permitido de inline style — tamanho dinâmico
  wrap.style.width = `${tamanho}px`;
  wrap.style.height = `${tamanho}px`;
  wrap.style.fontSize = `${Math.round(tamanho * 0.4)}px`;

  if (fotoId) {
    const img = el('img', {
      attrs: { src: imagemUrl(fotoId), alt: nome || '' },
    });
    // se a imagem falhar, faz fallback pra inicial
    img.addEventListener('error', () => {
      limpar(wrap);
      wrap.textContent = inicialDe(nome);
    });
    wrap.appendChild(img);
  } else {
    wrap.textContent = inicialDe(nome);
  }
  return wrap;
}

function inicialDe(nome) {
  if (!nome) return '?';
  const limpo = String(nome).trim();
  if (!limpo) return '?';
  return limpo.charAt(0).toUpperCase();
}

/** Formata número como moeda BRL. */
export function formatarMoeda(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'R$ —';
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

/** Formata data ISO como dd/mm/yyyy. */
export function formatarData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR');
}

/** Formata data ISO como "dd/mm/yyyy às HH:mm" (datas combinadas de entrega/retirada). */
export function formatarDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${d.toLocaleDateString('pt-BR')} às ${hora}`;
}

/** Formata data ISO como HH:mm (usado nas bolhas de mensagem). */
export function formatarHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Toast efêmero, posicionado bottom-right. Some sozinho em ~ms.
 * children opcional: array de Nodes/strings pra empurrar dentro do toast
 * (ex.: um link "Ver carrinho"). Não bloqueia interface.
 */
export function toast(texto, { tipo = 'info', ms = 3500, children } = {}) {
  const t = el('div', {
    className: `toast toast-${tipo}`,
    text: texto,
  });
  if (children) {
    for (const c of children) {
      if (c == null) continue;
      t.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  document.body.appendChild(t);
  // permite animação de entrada via CSS
  requestAnimationFrame(() => t.classList.add('toast-in'));
  setTimeout(() => {
    t.classList.remove('toast-in');
    t.classList.add('toast-out');
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
  }, ms);
  return t;
}

/**
 * Renderiza um bloco de estrelas (0 a 5) com nota numérica e total entre parênteses.
 * @param {number} media
 * @param {number} total
 */
export function renderEstrelas(media, total) {
  const wrap = el('span', { className: 'card-rating' });
  const mediaNum = Number(media) || 0;
  const cheias = Math.round(mediaNum); // arredondamento simples

  const stars = el('span', { className: 'stars' });
  // Estrelas preenchidas
  stars.appendChild(document.createTextNode('★'.repeat(cheias)));
  // Estrelas vazias num span separado pra ter cor diferente
  if (cheias < 5) {
    const vazias = el('span', {
      className: 'stars-empty',
      text: '★'.repeat(5 - cheias),
    });
    stars.appendChild(vazias);
  }
  wrap.appendChild(stars);

  if (mediaNum > 0) {
    wrap.appendChild(el('span', { text: ` ${mediaNum.toFixed(1)}` }));
  } else {
    wrap.appendChild(el('span', {
      className: 'rating-count',
      text: ' sem avaliações',
    }));
  }
  if (total > 0) {
    wrap.appendChild(el('span', {
      className: 'rating-count',
      text: ` (${total})`,
    }));
  }
  return wrap;
}

/** Banner de erro padronizado. Aceita um Error-like {code,message} ou string. */
export function bannerErro(err) {
  const msg = typeof err === 'string'
    ? err
    : (err?.message || 'Ocorreu um erro inesperado.');
  return el('div', { className: 'banner banner-error', text: msg });
}

/** Estado de loading reutilizável. */
export function loading(texto = 'Carregando...') {
  return el('div', { className: 'loading', text: texto });
}

/** Estado vazio reutilizável. */
export function estadoVazio(texto) {
  return el('div', { className: 'empty-state', text: texto });
}

/**
 * Atalho para construir um <a> que muda o hash via location.hash =
 * (mantém o histórico do browser e dispara o roteador).
 */
export function link(text, href, className) {
  return el('a', {
    text,
    className,
    attrs: { href },
  });
}

/**
 * Renderiza um seletor de estrelas interativas (1 a 5). Clique seleciona,
 * hover destaca temporariamente. Adicionado na Fase D para o form de avaliação.
 *
 * @param {{ inicial?:number, onChange?: (nota:number) => void }} [opts]
 * @returns {{ node: HTMLElement, getValor: () => number }}
 */
export function renderEstrelasInterativas({ inicial = 0, onChange } = {}) {
  let valor = Number(inicial) || 0;
  if (valor < 0) valor = 0;
  if (valor > 5) valor = 5;

  const wrap = el('div', {
    className: 'stars-input',
    attrs: { role: 'radiogroup', 'aria-label': 'Nota de 1 a 5 estrelas' },
  });

  // Criamos 5 botões, cada um representando uma nota. Usamos botões (e não
  // inputs radio) porque queremos o hover-preview controlado por JS.
  const botoes = [];
  for (let i = 1; i <= 5; i++) {
    const btn = el('button', {
      className: 'stars-input-star',
      attrs: {
        type: 'button',
        role: 'radio',
        'aria-label': `${i} ${i === 1 ? 'estrela' : 'estrelas'}`,
        'aria-checked': 'false',
        'data-valor': String(i),
      },
      text: '★',
    });
    botoes.push(btn);
    wrap.appendChild(btn);
  }

  /** Aplica visualmente um destaque até a nota dada (sem mudar `valor`). */
  function pintar(ate) {
    for (let i = 0; i < botoes.length; i++) {
      const ativo = (i + 1) <= ate;
      botoes[i].classList.toggle('is-active', ativo);
    }
  }

  /** Atualiza ARIA das estrelas após mudança real do valor. */
  function atualizarAria() {
    for (let i = 0; i < botoes.length; i++) {
      botoes[i].setAttribute('aria-checked', (i + 1) === valor ? 'true' : 'false');
    }
  }

  // Estado inicial
  pintar(valor);
  atualizarAria();

  // Hover: realça até a estrela apontada; mouseleave volta pro valor real.
  for (let i = 0; i < botoes.length; i++) {
    const btn = botoes[i];
    const nota = i + 1;
    btn.addEventListener('mouseenter', () => pintar(nota));
    btn.addEventListener('focus', () => pintar(nota));
    btn.addEventListener('click', () => {
      valor = nota;
      pintar(valor);
      atualizarAria();
      if (typeof onChange === 'function') onChange(valor);
    });
  }
  wrap.addEventListener('mouseleave', () => pintar(valor));
  wrap.addEventListener('blur', () => pintar(valor), true);

  return {
    node: wrap,
    getValor: () => valor,
  };
}

// =============================================================
// Upload de foto (base64) — Fase C
// =============================================================

/** Lista de MIME types aceitos no upload de foto. Espelha o que o backend valida. */
export const MIMES_IMAGEM_ACEITOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Tamanho máximo permitido (em bytes) — 5 MB. */
export const TAMANHO_MAX_FOTO = 5 * 1024 * 1024;

/**
 * Lê um File como base64 puro (sem o prefixo `data:...;base64,`).
 * Útil para enviar ao backend dentro de um JSON.
 * @param {File} file
 * @returns {Promise<{ base64:string, mime:string, tamanho:number }>}
 */
export function lerArquivoComoBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Nenhum arquivo informado.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      // result vem como "data:image/jpeg;base64,/9j/4AA..."
      const idx = result.indexOf(',');
      const base64 = idx === -1 ? result : result.slice(idx + 1);
      resolve({ base64, mime: file.type || 'image/jpeg', tamanho: file.size });
    };
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Renderiza um campo de upload de imagem com preview e validação inline.
 *
 * @param {{ fotoIdInicial?:number, label?:string }} [opts]
 * @returns {{ node: HTMLElement, getValue: () => ({foto_base64:string, foto_mime:string} | null) }}
 */
export function campoUploadFoto({ fotoIdInicial, label = 'Foto' } = {}) {
  // Estado interno do componente — fechado por closure.
  // arquivoSelecionado: File ou null. Quando null e fotoIdInicial existe,
  // o getValue() devolve null (manter a foto atual).
  let arquivoSelecionado = null;
  let base64Cache = null; // promessa em cache pro próximo getValue
  let objectUrl = null;   // criado por createObjectURL; revogar ao trocar/limpar

  const wrap = el('div', { className: 'form-field upload-foto' });
  wrap.appendChild(el('label', { text: label }));

  // Container do preview + ações
  const linha = el('div', { className: 'upload-foto-linha' });

  // Preview (96x96)
  const previewBox = el('div', { className: 'upload-foto-preview' });
  const previewImg = el('img', { attrs: { alt: 'Pré-visualização' } });
  previewImg.style.display = 'none';
  const previewPlaceholder = el('span', {
    className: 'upload-foto-placeholder',
    text: 'Sem foto',
  });
  previewBox.appendChild(previewImg);
  previewBox.appendChild(previewPlaceholder);

  // Se já há foto persistida, mostra ela
  if (fotoIdInicial) {
    previewImg.src = imagemUrl(fotoIdInicial);
    previewImg.style.display = 'block';
    previewPlaceholder.style.display = 'none';
    // se a foto antiga falhar, volta ao placeholder
    previewImg.addEventListener('error', () => {
      previewImg.style.display = 'none';
      previewPlaceholder.style.display = 'inline';
    });
  }

  linha.appendChild(previewBox);

  // Botões à direita
  const acoes = el('div', { className: 'upload-foto-acoes' });

  // Input file real, escondido — disparado pelo botão visível
  const inputFile = el('input', {
    attrs: { type: 'file', accept: MIMES_IMAGEM_ACEITOS.join(',') },
  });
  inputFile.style.display = 'none';
  acoes.appendChild(inputFile);

  const btnEscolher = el('button', {
    className: 'btn btn-secondary',
    text: fotoIdInicial ? 'Trocar foto' : 'Escolher arquivo',
    attrs: { type: 'button' },
    on: { click: () => inputFile.click() },
  });
  acoes.appendChild(btnEscolher);

  // Botão "Remover" — só aparece quando há arquivo novo selecionado.
  // Removê-lo volta ao estado "manter foto atual" (ou "sem foto").
  const btnRemover = el('button', {
    className: 'btn btn-ghost',
    text: 'Remover',
    attrs: { type: 'button' },
  });
  btnRemover.style.display = 'none';
  acoes.appendChild(btnRemover);

  linha.appendChild(acoes);
  wrap.appendChild(linha);

  // Mensagem de erro inline (validação local)
  const erroSlot = el('div', { className: 'upload-foto-erro' });
  wrap.appendChild(erroSlot);

  // Help text
  wrap.appendChild(el('span', {
    className: 'form-help',
    text: 'JPG, PNG, WebP ou GIF. Máx. 5 MB.',
  }));

  function limparPreviewNovo() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    arquivoSelecionado = null;
    base64Cache = null;
    btnRemover.style.display = 'none';
    btnEscolher.textContent = fotoIdInicial ? 'Trocar foto' : 'Escolher arquivo';

    // volta o preview pra foto inicial (ou placeholder)
    if (fotoIdInicial) {
      previewImg.src = imagemUrl(fotoIdInicial);
      previewImg.style.display = 'block';
      previewPlaceholder.style.display = 'none';
    } else {
      previewImg.removeAttribute('src');
      previewImg.style.display = 'none';
      previewPlaceholder.style.display = 'inline';
    }
  }

  inputFile.addEventListener('change', () => {
    limpar(erroSlot);
    const file = inputFile.files && inputFile.files[0];
    if (!file) return;

    // Validação client-side
    if (!MIMES_IMAGEM_ACEITOS.includes(file.type)) {
      erroSlot.textContent = 'Tipo de arquivo não suportado. Use JPG, PNG, WebP ou GIF.';
      inputFile.value = ''; // permite re-selecionar o mesmo arquivo se o usuário quiser
      return;
    }
    if (file.size > TAMANHO_MAX_FOTO) {
      const mb = (file.size / (1024 * 1024)).toFixed(2);
      erroSlot.textContent = `Arquivo muito grande (${mb} MB). Máximo permitido: 5 MB.`;
      inputFile.value = '';
      return;
    }

    // Substitui o objectURL anterior, se existia
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    previewImg.src = objectUrl;
    previewImg.style.display = 'block';
    previewPlaceholder.style.display = 'none';

    arquivoSelecionado = file;
    base64Cache = null; // só serializa quando getValue() for chamado
    btnRemover.style.display = 'inline-flex';
    btnEscolher.textContent = 'Trocar foto';
  });

  btnRemover.addEventListener('click', () => {
    limpar(erroSlot);
    inputFile.value = '';
    limparPreviewNovo();
  });

  /**
   * Devolve o payload pronto pra enviar ao backend.
   * Retorna null quando o usuário NÃO escolheu arquivo novo
   * (significa: backend mantém a foto atual, se houver).
   */
  async function getValue() {
    if (!arquivoSelecionado) return null;
    if (!base64Cache) {
      base64Cache = lerArquivoComoBase64(arquivoSelecionado);
    }
    const { base64, mime } = await base64Cache;
    return { foto_base64: base64, foto_mime: mime };
  }

  return { node: wrap, getValue };
}
