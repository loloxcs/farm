// pages/modal-gerar-pedido.js — Fase D — RF13
//
// Modal sobreposto, aberto pelo botão "Gerar pedido" da bolha de snapshot
// no chat (`pages/conversa.js`). Mesmo padrão do modal de produto da Fase C:
// overlay + card + header + form + footer; fecha por ×, Cancelar, click no
// overlay e Esc; foco automático no primeiro campo.
//
// A forma de pagamento NÃO é escolhida aqui: quem escolhe é o cliente, ao
// enviar o carrinho (vem em snapshotJson.pagamento). O agricultor define só
// entrega/retirada, data, local e observações.
//
// O caller passa:
//   - mensagemSnapshotId: id da mensagem `tipo='snapshot'` que dispara o pedido
//   - snapshotJson: objeto `{ itens:[...], total, pagamento }` da mensagem (já presente
//                   no DOM, evita refetch)
//   - onCriado(pedido): callback chamado em sucesso. Recebe o pedido cru
//                       devolvido por POST /pedidos. Decisão de navegação
//                       e toast fica com quem chamou.
//
// Edge cases conhecidos do backend (mensagens já vêm traduzidas pelo api.js,
// só repassamos via bannerErro):
//   - 400 SNAPSHOT_USADO       → "este snapshot já gerou um pedido"
//   - 400 ESTOQUE_INSUFICIENTE → "estoque insuficiente para X (disp: N, ped: M)"

import { el, limpar, bannerErro, formatarMoeda } from '../ui.js';
import { criarPedido } from '../api.js';

const OBS_MAX = 500;
const LOCAL_MAX = 200;
const SNAPSHOT_ITENS_VISIVEIS = 5; // mesmo limite da bolha do chat

/**
 * Abre o modal de criação de pedido.
 * @param {{
 *   mensagemSnapshotId: number,
 *   snapshotJson: { itens: Array<{nome?:string, quantidade:number, preco_unit:number, subtotal?:number}>, total:number },
 *   onCriado: (pedido:any) => void,
 * }} opts
 */
export function abrirModalGerarPedido({ mensagemSnapshotId, snapshotJson, onCriado }) {
  const titulo = 'Gerar pedido a partir do carrinho recebido';

  const overlay = el('div', { className: 'modal-overlay' });
  const card = el('div', {
    className: 'modal-card',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
  });

  // Header
  const header = el('div', { className: 'modal-header' });
  header.appendChild(el('h2', { className: 'modal-title', text: titulo }));
  const btnClose = el('button', {
    className: 'btn btn-ghost modal-close',
    text: '×',
    attrs: { type: 'button', 'aria-label': 'Fechar' },
  });
  header.appendChild(btnClose);
  card.appendChild(header);

  // Form
  const form = el('form', { className: 'modal-form', attrs: { novalidate: true } });

  const erroSlot = el('div');
  form.appendChild(erroSlot);

  // ---------- Resumo do snapshot (read-only) ----------
  form.appendChild(renderResumoSnapshot(snapshotJson));

  // ---------- Forma de pagamento (só leitura) ----------
  // Quem escolhe é o cliente, ao enviar o carrinho. O agricultor apenas vê.
  const escolhida = snapshotJson?.pagamento?.rotulo || null;
  const fpWrap = el('div', { className: 'form-field modal-forma-pagamento' });
  fpWrap.appendChild(el('span', { className: 'form-rotulo', text: 'Forma de pagamento (escolhida pelo cliente)' }));
  fpWrap.appendChild(el('strong', {
    className: 'modal-forma-pagamento-valor',
    text: escolhida || 'O cliente ainda não escolheu',
  }));
  fpWrap.appendChild(el('span', {
    className: 'form-help',
    text: escolhida
      ? 'O cliente pode trocar na hora de pagar, entre as formas que você aceita (veja “Meu perfil”).'
      : 'Este carrinho foi enviado sem forma de pagamento. O cliente escolhe na hora de pagar, entre as formas que você aceita.',
  }));
  form.appendChild(fpWrap);

  // ---------- Entrega ou retirada ----------
  // O que for escolhido aqui aparece para o cliente no pedido, na tela de
  // pagamento e nas confirmações automáticas do chat.
  let tipoEntrega = 'retirada';
  const tipoWrap = el('div', { className: 'form-field' });
  tipoWrap.appendChild(el('span', { className: 'form-rotulo', text: 'Como o cliente recebe o pedido?' }));
  const tipoGrupo = el('div', {
    className: 'radio-group',
    attrs: { role: 'radiogroup', 'aria-label': 'Como o cliente recebe o pedido' },
  });
  const tipoOpcoes = [];
  for (const [valor, rotulo] of [['retirada', 'Cliente retira'], ['entrega', 'Eu entrego']]) {
    const input = el('input', {
      attrs: { type: 'radio', name: 'mgp-tipo-entrega', value: valor, id: `mgp-tipo-${valor}` },
    });
    input.checked = valor === tipoEntrega;
    const label = el('label', {
      className: 'radio-option',
      attrs: { for: `mgp-tipo-${valor}` },
      children: [input, el('span', { text: rotulo })],
    });
    input.addEventListener('change', () => {
      tipoEntrega = valor;
      atualizarTipoEntrega();
    });
    tipoOpcoes.push({ valor, label });
    tipoGrupo.appendChild(label);
  }
  tipoWrap.appendChild(tipoGrupo);
  form.appendChild(tipoWrap);

  // ---------- Data combinada (opcional) ----------
  const dataWrap = el('div', { className: 'form-field' });
  const dataLabel = el('label', { attrs: { for: 'mgp-data-retirada' } });
  dataWrap.appendChild(dataLabel);
  const dataInput = el('input', {
    attrs: { id: 'mgp-data-retirada', type: 'datetime-local' },
  });
  dataWrap.appendChild(dataInput);
  dataWrap.appendChild(el('span', {
    className: 'form-help',
    text: 'Deixe em branco se ainda não foi combinada.',
  }));
  form.appendChild(dataWrap);

  // ---------- Endereço de entrega / local de retirada (opcional) ----------
  const localWrap = el('div', { className: 'form-field' });
  const localLabel = el('label', { attrs: { for: 'mgp-local' } });
  localWrap.appendChild(localLabel);
  const localInput = el('input', {
    attrs: { id: 'mgp-local', type: 'text', maxlength: LOCAL_MAX },
  });
  localWrap.appendChild(localInput);
  form.appendChild(localWrap);

  function atualizarTipoEntrega() {
    const entrega = tipoEntrega === 'entrega';
    for (const o of tipoOpcoes) o.label.classList.toggle('is-selected', o.valor === tipoEntrega);
    dataLabel.textContent = entrega ? 'Data da entrega (opcional)' : 'Data da retirada (opcional)';
    localLabel.textContent = entrega ? 'Endereço de entrega (opcional)' : 'Local de retirada (opcional)';
    localInput.placeholder = entrega
      ? 'Ex.: Rua das Flores, 120 — Centro'
      : 'Ex.: Sítio Boa Vista, km 4 — ou banca na feira de sábado';
  }
  atualizarTipoEntrega();

  // ---------- Observações ----------
  const obsWrap = el('div', { className: 'form-field' });
  obsWrap.appendChild(el('label', {
    text: 'Observações (opcional)',
    attrs: { for: 'mgp-observacoes' },
  }));
  const obsTextarea = el('textarea', {
    attrs: { id: 'mgp-observacoes', maxlength: OBS_MAX, rows: 3 },
  });
  obsWrap.appendChild(obsTextarea);
  const obsContador = el('span', { className: 'form-help form-contador' });
  obsWrap.appendChild(obsContador);
  function atualizarContadorObs() {
    obsContador.textContent = `${obsTextarea.value.length} / ${OBS_MAX}`;
  }
  atualizarContadorObs();
  obsTextarea.addEventListener('input', atualizarContadorObs);
  form.appendChild(obsWrap);

  // ---------- Footer ----------
  const footer = el('div', { className: 'modal-footer' });
  const btnCancelar = el('button', {
    className: 'btn btn-ghost',
    text: 'Cancelar',
    attrs: { type: 'button' },
  });
  const btnConfirmar = el('button', {
    className: 'btn btn-primary',
    text: 'Confirmar pedido',
    attrs: { type: 'submit' },
  });
  footer.appendChild(btnCancelar);
  footer.appendChild(btnConfirmar);
  form.appendChild(footer);

  card.appendChild(form);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ---------- Fechar (× / Cancelar / overlay / Esc) ----------
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

  // Foco no primeiro campo interativo.
  setTimeout(() => tipoOpcoes[0]?.label.querySelector('input')?.focus(), 0);

  // ---------- Submit ----------
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erroSlot);

    // Data: datetime-local devolve "2026-05-08T09:00" (sem timezone). Converter
    // pra ISO via Date (interpretado no fuso local) — o backend só guarda a string.
    // O campo continua se chamando `data_retirada`, mas vale para entrega também.
    let data_retirada = null;
    if (dataInput.value) {
      const d = new Date(dataInput.value);
      if (Number.isNaN(d.getTime())) {
        erroSlot.appendChild(bannerErro(
          tipoEntrega === 'entrega' ? 'Data da entrega inválida.' : 'Data da retirada inválida.'
        ));
        return;
      }
      data_retirada = d.toISOString();
    }
    const local_entrega = localInput.value.trim() || null;

    const observacoes = obsTextarea.value.trim() || null;
    if (observacoes && observacoes.length > OBS_MAX) {
      erroSlot.appendChild(bannerErro(`Observações não podem passar de ${OBS_MAX} caracteres.`));
      return;
    }

    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Criando pedido...';

    try {
      const pedido = await criarPedido({
        mensagem_snapshot_id: mensagemSnapshotId,
        tipo_entrega: tipoEntrega,
        data_retirada,
        local_entrega,
        observacoes,
      });
      fechar();
      if (typeof onCriado === 'function') onCriado(pedido);
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar pedido';
    }
  });
}

// =============================================================
// Helpers
// =============================================================

/**
 * Render do resumo do snapshot dentro do modal. Mesma estrutura visual da
 * bolha de chat, mas em tom mais discreto (read-only, dentro de form).
 */
function renderResumoSnapshot(snap) {
  const wrap = el('div', { className: 'modal-snap-resumo' });

  wrap.appendChild(el('p', {
    className: 'modal-snap-titulo',
    text: 'Itens do carrinho',
  }));

  const itens = Array.isArray(snap?.itens) ? snap.itens : [];
  if (itens.length === 0) {
    wrap.appendChild(el('p', {
      className: 'form-help',
      text: 'Este snapshot não tem itens — possivelmente inválido.',
    }));
    return wrap;
  }

  const lista = el('ul', { className: 'modal-snap-itens' });
  const visiveis = itens.slice(0, SNAPSHOT_ITENS_VISIVEIS);
  for (const it of visiveis) {
    const subtotal = (it.subtotal != null)
      ? Number(it.subtotal)
      : (Number(it.preco_unit || 0) * Number(it.quantidade || 0));
    const li = el('li', { className: 'modal-snap-item' });
    li.appendChild(el('span', {
      className: 'modal-snap-item-nome',
      text: `${formatarQtd(it.quantidade)} × ${it.nome || 'Produto'}`,
    }));
    li.appendChild(el('span', {
      className: 'modal-snap-item-valor',
      text: formatarMoeda(subtotal),
    }));
    lista.appendChild(li);
  }
  if (itens.length > SNAPSHOT_ITENS_VISIVEIS) {
    const restante = itens.length - SNAPSHOT_ITENS_VISIVEIS;
    lista.appendChild(el('li', {
      className: 'modal-snap-item modal-snap-item-extra',
      text: `+ ${restante} ite${restante === 1 ? 'm' : 'ns'}`,
    }));
  }
  wrap.appendChild(lista);

  const totalBox = el('div', { className: 'modal-snap-total' });
  totalBox.appendChild(el('span', { text: 'Total' }));
  totalBox.appendChild(el('strong', { text: formatarMoeda(snap?.total || 0) }));
  wrap.appendChild(totalBox);

  return wrap;
}

function formatarQtd(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return '?';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace('.', ',');
}
