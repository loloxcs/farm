// pages/pagamento.js — pagamento do pedido, lado do CLIENTE.
//
// Rota: #/pedidos/:id/pagamento
//
// O dinheiro vai direto do cliente para o agricultor. Esta tela:
//   1. mostra o resumo (total, entrega ou retirada, forma que o cliente escolheu no carrinho);
//   2. deixa o cliente escolher a forma (entre as que o agricultor aceita) e
//      INFORMAR o pagamento — PIX/transferência ficam aguardando o agricultor
//      confirmar; dinheiro fica "a pagar na entrega/retirada"; cartão é simulado;
//   3. acompanha a situação até a confirmação (atualiza sozinha a cada 5 s).
//
// Cada passo também vira uma mensagem automática no chat com o agricultor.
// O lado do agricultor (confirmar / contestar) fica em pages/pedido-detalhe.js
// e nos cartões do chat (pages/conversa.js).

import {
  el, limpar, bannerErro, formatarMoeda, loading, toast,
} from '../ui.js';
import { getPedido, getPagamentoPedido, informarPagamentoPedido } from '../api.js';
import { getUser } from '../auth.js';
import { navigate } from '../router.js';
import {
  termosEntrega, resumoEntrega, fraseProximoPasso, renderEtapas, renderDadosPagamento, rotuloMetodo,
} from '../pagamento-ui.js';

const POLL_MS = 5000;
const OBS_MAX = 200;

// Um único timer por vez: a tela se re-renderiza na mesma rota (sem hashchange).
let pollTimer = null;
function pararPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export async function renderPagamento({ outlet, params }) {
  pararPolling();
  limpar(outlet);
  outlet.appendChild(loading('Carregando pagamento...'));

  const user = getUser();
  if (!user?.id) return;

  let pedido;
  let info;
  try {
    [pedido, info] = await Promise.all([getPedido(params.id), getPagamentoPedido(params.id)]);
  } catch (error) {
    limpar(outlet);
    outlet.appendChild(bannerErro(error));
    return;
  }

  const pagamento = info?.pagamento || null;
  const opcoes = info?.opcoes || { metodos: [] };
  const pode = info?.pode || {};
  const agricultor = opcoes.agricultor_nome || pedido.agricultor_nome || 'o agricultor';

  limpar(outlet);
  const root = el('section', { className: 'pagamento-page' });
  outlet.appendChild(root);
  root.appendChild(el('a', {
    className: 'pagamento-voltar',
    text: '← Voltar ao pedido',
    attrs: { href: `#/pedidos/${pedido.id}` },
  }));
  root.appendChild(el('h1', { className: 'pagamento-titulo', text: `Pagamento do pedido #${pedido.id}` }));
  root.appendChild(renderResumo(pedido, agricultor, pagamento));

  const etapas = renderEtapas(pedido, pagamento);
  if (etapas) root.appendChild(etapas);

  if (pedido.status === 'pendente') {
    root.appendChild(el('div', {
      className: 'banner banner-info',
      text: `O pagamento fica disponível assim que ${agricultor} confirmar o pedido. Você será avisado pelo chat.`,
    }));
    return;
  }

  if (pedido.status === 'cancelado' && !pagamento) {
    root.appendChild(el('div', {
      className: 'banner banner-info',
      text: 'Este pedido foi cancelado — não há nada a pagar.',
    }));
    return;
  }

  const contexto = { pedido, pagamento, opcoes, agricultor };

  if (pagamento) root.appendChild(renderSituacao(contexto));

  if (pode.pagar && metodosDisponiveis(opcoes, pagamento).length > 0) {
    if (pagamento?.status === 'pagar_na_entrega') {
      // Já combinou dinheiro; o formulário só aparece se quiser trocar.
      const trocar = el('button', {
        className: 'btn btn-secondary pagamento-trocar',
        text: 'Pagar de outra forma',
        attrs: { type: 'button' },
      });
      trocar.addEventListener('click', () => {
        trocar.replaceWith(renderFormulario(contexto));
      });
      root.appendChild(trocar);
    } else {
      root.appendChild(renderFormulario(contexto));
    }
  }

  // Enquanto depende do agricultor, a tela se atualiza sozinha.
  if (['aguardando_confirmacao', 'pagar_na_entrega'].includes(pagamento?.status)) {
    iniciarPolling(outlet, pedido, pagamento);
  }
}

// =============================================================
// Resumo do combinado
// =============================================================
function renderResumo(pedido, agricultor, pagamento) {
  const t = termosEntrega(pedido);
  const resumo = el('section', {
    className: 'pagamento-resumo',
    attrs: { 'aria-label': 'Resumo do pedido' },
  });
  resumo.appendChild(el('span', {
    className: 'pagamento-resumo-label',
    text: pagamento?.status === 'aprovado' ? `Total pago para ${agricultor}` : `Total a pagar para ${agricultor}`,
  }));
  resumo.appendChild(el('strong', {
    className: 'pagamento-resumo-total',
    text: formatarMoeda(pedido.total),
  }));
  const linhas = el('div', { className: 'pagamento-resumo-linhas' });
  linhas.appendChild(el('span', { text: resumoEntrega(pedido) }));
  if (pedido.local_entrega) {
    linhas.appendChild(el('span', { text: `${t.rotuloLocal}: ${pedido.local_entrega}` }));
  }
  if (pedido.forma_pagamento?.nome) {
    linhas.appendChild(el('span', { text: `Forma que você escolheu no carrinho: ${pedido.forma_pagamento.nome}` }));
  }
  resumo.appendChild(linhas);
  return resumo;
}

// =============================================================
// Situação atual do pagamento
// =============================================================
function renderSituacao({ pedido, pagamento, agricultor }) {
  const t = termosEntrega(pedido);
  const visual = {
    aguardando_confirmacao: {
      classe: 'is-espera', icone: '…', titulo: 'Pagamento informado',
      texto: `Avisamos ${agricultor} pelo chat. Assim que o recebimento for confirmado, você é avisado por lá e esta tela se atualiza.`,
    },
    pagar_na_entrega: {
      classe: 'is-espera', icone: 'R$', titulo: `Pagamento em dinheiro ${t.naHora}`,
      texto: `Leve ${formatarMoeda(pagamento.valor)} em dinheiro. ${agricultor} confirma o recebimento na hora. ${fraseProximoPasso(pedido)}`,
    },
    aprovado: {
      classe: 'is-ok', icone: '✓', titulo: 'Pagamento confirmado',
      texto: fraseProximoPasso(pedido),
    },
    recusado: {
      classe: 'is-alerta', icone: '!', titulo: `${agricultor} não localizou o pagamento`,
      texto: (pagamento.motivo_recusa ? `Motivo: ${pagamento.motivo_recusa}. ` : '')
        + 'Confira no app do seu banco e informe o pagamento novamente abaixo — ou fale com o agricultor pelo chat.',
    },
    cancelado: {
      classe: 'is-neutro', icone: '×', titulo: 'Pagamento cancelado',
      texto: pagamento.devolucao_pendente
        ? `O pedido foi cancelado depois do pagamento. Combine a devolução de ${formatarMoeda(pagamento.valor)} com ${agricultor} pelo chat.`
        : 'O pedido foi cancelado; nada a pagar.',
    },
  }[pagamento.status] || { classe: 'is-neutro', icone: '?', titulo: 'Pagamento', texto: '' };

  const bloco = el('section', {
    className: `pagamento-situacao ${visual.classe}`,
    attrs: { role: 'status' },
  });
  const cabecalho = el('div', { className: 'pagamento-situacao-cab' });
  cabecalho.appendChild(el('span', {
    className: 'pagamento-situacao-icone', text: visual.icone, attrs: { 'aria-hidden': 'true' },
  }));
  const textos = el('div');
  textos.appendChild(el('h2', { className: 'pagamento-situacao-titulo', text: visual.titulo }));
  textos.appendChild(el('p', { className: 'pagamento-situacao-texto', text: visual.texto }));
  cabecalho.appendChild(textos);
  bloco.appendChild(cabecalho);

  bloco.appendChild(renderDadosPagamento(pagamento, pedido));
  if (pagamento.transacao_id) {
    bloco.appendChild(el('p', {
      className: 'pagamento-transacao',
      text: `Transação simulada: ${pagamento.transacao_id}`,
    }));
  }

  const acoes = el('div', { className: 'pagamento-situacao-acoes' });
  acoes.appendChild(el('a', {
    className: 'btn btn-secondary',
    text: 'Abrir conversa com o agricultor',
    attrs: { href: `#/conversas/com/${pedido.agricultor_id}` },
  }));
  bloco.appendChild(acoes);
  return bloco;
}

// =============================================================
// Formulário: escolher a forma e informar o pagamento
// =============================================================
/** Formas que o cliente pode escolher agora (dinheiro some se já é o combinado atual). */
function metodosDisponiveis(opcoes, pagamento) {
  return (opcoes.metodos || [])
    .filter((metodo) => !(pagamento?.status === 'pagar_na_entrega' && metodo.id === 'cash'));
}

function renderFormulario({ pedido, pagamento, opcoes, agricultor }) {
  const t = termosEntrega(pedido);
  const jaEntregue = pedido.status === 'entregue';
  const metodos = metodosDisponiveis(opcoes, pagamento);

  const form = el('form', {
    className: 'pagamento-form pagamento-bloco',
    attrs: { novalidate: true },
  });
  form.appendChild(el('h2', {
    className: 'pagamento-bloco-titulo',
    text: pagamento?.status === 'recusado' ? 'Informar o pagamento novamente' : 'Como você vai pagar?',
  }));

  const erro = el('div');
  form.appendChild(erro);

  if (metodos.length === 0) {
    form.appendChild(bannerErro('Nenhuma forma de pagamento disponível. Fale com o agricultor pelo chat.'));
    return form;
  }

  // ---------- Formas (cartões de rádio) ----------
  const preferido = [pagamento?.metodo, opcoes.metodo_combinado]
    .find((id) => id && metodos.some((m) => m.id === id));
  let selecionado = preferido || metodos[0].id;

  const grupo = el('div', {
    className: 'pagamento-metodos',
    attrs: { role: 'radiogroup', 'aria-label': 'Forma de pagamento' },
  });
  const opcoesDom = [];
  for (const metodo of metodos) {
    const input = el('input', {
      attrs: { type: 'radio', name: 'pagamento-metodo', value: metodo.id, id: `pagamento-metodo-${metodo.id}` },
    });
    input.checked = metodo.id === selecionado;
    const label = el('label', {
      className: 'radio-option pagamento-metodo',
      attrs: { for: `pagamento-metodo-${metodo.id}` },
    });
    label.appendChild(input);
    const textos = el('span', { className: 'pagamento-metodo-textos' });
    textos.appendChild(el('span', { className: 'pagamento-metodo-nome', text: nomeMetodoNoContexto(metodo.id, t) }));
    textos.appendChild(el('span', { className: 'form-help', text: dicaMetodo(metodo.id) }));
    label.appendChild(textos);
    if (metodo.combinado) {
      label.appendChild(el('span', { className: 'pagamento-metodo-tag', text: 'Sua escolha' }));
    }
    input.addEventListener('change', () => {
      selecionado = metodo.id;
      atualizar();
    });
    opcoesDom.push({ id: metodo.id, label });
    grupo.appendChild(label);
  }
  form.appendChild(grupo);

  // ---------- Painel da forma escolhida ----------
  const painel = el('div', { className: 'pagamento-painel' });
  form.appendChild(painel);

  const confirmar = el('button', { className: 'btn btn-primary', attrs: { type: 'submit' } });
  form.appendChild(confirmar);

  let campoObs = null;

  function rotuloBotao() {
    if (selecionado === 'pix') return 'Já fiz o PIX';
    if (selecionado === 'transfer') return 'Já fiz a transferência';
    if (selecionado === 'cash') return jaEntregue ? 'Já paguei em dinheiro' : `Vou pagar ${t.naHora}`;
    return 'Pagar com cartão (simulação)';
  }

  function atualizar() {
    for (const o of opcoesDom) o.label.classList.toggle('is-selected', o.id === selecionado);
    limpar(painel);
    limpar(erro);
    campoObs = null;
    confirmar.textContent = rotuloBotao();

    if (selecionado === 'pix') {
      painel.appendChild(renderPainelPix({ pedido, opcoes, agricultor }));
      campoObs = adicionarCampoObservacao(painel);
    } else if (selecionado === 'transfer') {
      painel.appendChild(el('p', {
        className: 'pagamento-metodo-ajuda',
        text: `Combine os dados bancários com ${agricultor} pelo chat, faça a transferência de ${formatarMoeda(pedido.total)} `
          + 'no seu banco e depois avise aqui. O agricultor confirma quando o valor cair na conta.',
      }));
      painel.appendChild(linkChat(pedido, 'Pedir os dados bancários pelo chat'));
      campoObs = adicionarCampoObservacao(painel);
    } else if (selecionado === 'cash') {
      painel.appendChild(el('p', {
        className: 'pagamento-metodo-ajuda',
        text: jaEntregue
          ? `Avise ${agricultor} de que você pagou ${formatarMoeda(pedido.total)} em dinheiro. Ele confirma o recebimento.`
          : `Você paga ${formatarMoeda(pedido.total)} em dinheiro ${t.naHora}. ${agricultor} confirma o recebimento quando receber. `
            + 'Se puder, leve o valor trocado.',
      }));
    } else {
      painel.appendChild(renderCamposCartao());
    }
  }
  atualizar();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    limpar(erro);

    const payload = { metodo: selecionado };
    if (selecionado === 'credit_card' || selecionado === 'debit_card') {
      const numero = form.querySelector('#pagamento-numero').value.replace(/\D/g, '');
      const validade = form.querySelector('#pagamento-validade').value.trim();
      const cvv = form.querySelector('#pagamento-cvv').value.trim();
      const nome = form.querySelector('#pagamento-nome').value.trim();
      if (!nome || numero.length < 12 || numero.length > 19 || !/^\d{2}\/\d{2}$/.test(validade) || !/^\d{3,4}$/.test(cvv)) {
        erro.appendChild(bannerErro('Preencha os dados fictícios do cartão no formato solicitado.'));
        return;
      }
      // Só os 4 últimos dígitos saem do navegador.
      payload.cartao_ultimos4 = numero.slice(-4);
    }
    if (campoObs?.value.trim()) payload.observacao = campoObs.value.trim().slice(0, OBS_MAX);

    confirmar.disabled = true;
    confirmar.textContent = 'Registrando...';
    try {
      const resposta = await informarPagamentoPedido(pedido.id, payload);
      const status = resposta?.pagamento?.status;
      toast(
        status === 'aprovado' ? 'Pagamento aprovado'
          : status === 'pagar_na_entrega' ? `Combinado: pagamento ${t.naHora}`
            : 'Pagamento informado — o agricultor foi avisado pelo chat',
        { tipo: 'success' }
      );
      navigate(`#/pedidos/${pedido.id}/pagamento`);
    } catch (error) {
      erro.appendChild(bannerErro(error));
      confirmar.disabled = false;
      confirmar.textContent = rotuloBotao();
    }
  });

  return form;
}

function nomeMetodoNoContexto(id, t) {
  if (id === 'cash') return `Dinheiro ${t.naHora}`;
  return rotuloMetodo(id);
}

function dicaMetodo(id) {
  return ({
    pix: 'Você paga no app do seu banco; o agricultor confirma.',
    transfer: 'Você transfere; o agricultor confirma.',
    cash: 'Você paga em mãos; o agricultor confirma ao receber.',
    credit_card: 'Simulação acadêmica — nada é cobrado.',
    debit_card: 'Simulação acadêmica — nada é cobrado.',
  })[id] || '';
}

function linkChat(pedido, texto) {
  return el('a', {
    className: 'btn btn-secondary pagamento-link-chat',
    text: texto,
    attrs: { href: `#/conversas/com/${pedido.agricultor_id}` },
  });
}

function adicionarCampoObservacao(painel) {
  const campo = el('div', { className: 'form-field' });
  campo.appendChild(el('label', {
    text: 'Recado para o agricultor (opcional)',
    attrs: { for: 'pagamento-observacao' },
  }));
  const input = el('input', {
    attrs: {
      id: 'pagamento-observacao', type: 'text', maxlength: OBS_MAX,
      placeholder: 'Ex.: paguei pela conta da minha mãe, Ana Souza',
    },
  });
  campo.appendChild(input);
  painel.appendChild(campo);
  return input;
}

// ---------- PIX ----------
function renderPainelPix({ pedido, opcoes, agricultor }) {
  const wrap = el('div', { className: 'pagamento-pix' });

  if (!opcoes.chave_pix) {
    wrap.appendChild(el('div', {
      className: 'banner banner-info',
      text: `${agricultor} ainda não cadastrou a chave PIX no perfil. Peça a chave pelo chat, faça o PIX e depois avise aqui.`,
    }));
    wrap.appendChild(linkChat(pedido, 'Pedir a chave PIX pelo chat'));
    return wrap;
  }

  const caixa = el('div', { className: 'pagamento-pix-caixa' });
  const dados = el('div', { className: 'pagamento-pix-dados' });
  dados.appendChild(el('span', { className: 'pedido-parte-label', text: `Chave PIX de ${agricultor}` }));
  dados.appendChild(el('code', { className: 'pagamento-pix-chave', text: opcoes.chave_pix }));
  dados.appendChild(el('span', { className: 'form-help', text: `Valor: ${formatarMoeda(pedido.total)}` }));
  caixa.appendChild(dados);

  const copiar = el('button', {
    className: 'btn btn-secondary',
    text: 'Copiar chave',
    attrs: { type: 'button' },
  });
  copiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(opcoes.chave_pix);
      toast('Chave PIX copiada', { tipo: 'success' });
    } catch {
      // Sem permissão de área de transferência: seleciona o texto pra copiar na mão.
      const range = document.createRange();
      range.selectNodeContents(dados.querySelector('.pagamento-pix-chave'));
      const selecao = window.getSelection();
      selecao.removeAllRanges();
      selecao.addRange(range);
      toast('Selecionei a chave — copie com Ctrl+C', { tipo: 'info' });
    }
  });
  caixa.appendChild(copiar);
  wrap.appendChild(caixa);

  const passos = el('ol', { className: 'pagamento-passos' });
  passos.appendChild(el('li', { text: 'Abra o app do seu banco e faça um PIX para a chave acima.' }));
  passos.appendChild(el('li', { text: `Confira o nome do favorecido e o valor de ${formatarMoeda(pedido.total)}.` }));
  passos.appendChild(el('li', { text: 'Volte aqui e clique em “Já fiz o PIX”. O agricultor confirma o recebimento.' }));
  wrap.appendChild(passos);
  return wrap;
}

// ---------- Cartão (simulado) ----------
function renderCamposCartao() {
  const campos = el('div', { className: 'pagamento-campos' });
  campos.appendChild(criarCampo('Nome no cartão', 'pagamento-nome', {
    type: 'text', autocomplete: 'cc-name', maxlength: 80,
  }));
  campos.appendChild(criarCampo('Número fictício do cartão', 'pagamento-numero', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 19,
    placeholder: '1234 5678 9012 3456',
  }));
  const linha = el('div', { className: 'pagamento-cartao-linha' });
  linha.appendChild(criarCampo('Validade', 'pagamento-validade', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 5, placeholder: 'MM/AA',
  }));
  linha.appendChild(criarCampo('CVV fictício', 'pagamento-cvv', {
    type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 4,
  }));
  campos.appendChild(linha);
  campos.appendChild(el('p', {
    className: 'pagamento-seguranca',
    text: 'Simulação acadêmica: use somente dados fictícios. Número completo, validade e CVV ficam apenas no navegador — não são enviados nem salvos — e nenhuma cobrança é feita.',
  }));
  return campos;
}

function criarCampo(labelText, id, attrs) {
  const field = el('div', { className: 'form-field' });
  field.appendChild(el('label', { text: labelText, attrs: { for: id } }));
  field.appendChild(el('input', { attrs: { id, ...attrs } }));
  return field;
}

// =============================================================
// Atualização automática enquanto depende do agricultor
// =============================================================
function iniciarPolling(outlet, pedido, pagamento) {
  window.addEventListener('hashchange', pararPolling, { once: true });
  pollTimer = setInterval(async () => {
    // Saiu da tela por outro caminho, ou está no meio de "pagar de outra forma": não mexe.
    if (!outlet.querySelector('.pagamento-page')) { pararPolling(); return; }
    if (outlet.querySelector('.pagamento-form')) return;
    try {
      const [novoPedido, info] = await Promise.all([getPedido(pedido.id), getPagamentoPedido(pedido.id)]);
      const mudou = info?.pagamento?.status !== pagamento.status || novoPedido.status !== pedido.status;
      if (mudou && outlet.querySelector('.pagamento-page') && !outlet.querySelector('.pagamento-form')) {
        if (info?.pagamento?.status === 'aprovado') toast('Pagamento confirmado pelo agricultor', { tipo: 'success' });
        navigate(`#/pedidos/${pedido.id}/pagamento`);
      }
    } catch (error) {
      console.warn('[pagamento] falha ao atualizar a situação:', error);
    }
  }, POLL_MS);
}
