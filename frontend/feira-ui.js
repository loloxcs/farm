// feira-ui.js — peças de tela das feiras, usadas em "Minhas feiras", no mapa
// e no perfil público do agricultor.

import { el } from './ui.js';

export const DIAS = [
  { id: 'dom', curto: 'Dom', longo: 'Domingo' },
  { id: 'seg', curto: 'Seg', longo: 'Segunda' },
  { id: 'ter', curto: 'Ter', longo: 'Terça' },
  { id: 'qua', curto: 'Qua', longo: 'Quarta' },
  { id: 'qui', curto: 'Qui', longo: 'Quinta' },
  { id: 'sex', curto: 'Sex', longo: 'Sexta' },
  { id: 'sab', curto: 'Sáb', longo: 'Sábado' },
];
const DIA = Object.fromEntries(DIAS.map((d) => [d.id, d]));

/** [{dia,inicio,fim}] → "Sáb 07:00–12:00 · Qua 14:00–18:00" */
export function textoHorarios(horarios = []) {
  return horarios.map((h) => `${DIA[h.dia]?.curto || h.dia} ${h.inicio}–${h.fim}`).join(' · ');
}

/** ['qua','sab'] → "Qua, Sáb" */
export function textoDias(dias = []) {
  return dias.map((d) => DIA[d]?.curto || d).join(', ');
}

export function enderecoFeira(f) {
  const rua = [f.logradouro, f.numero].filter(Boolean).join(', ');
  const cidade = [f.cidade, f.estado].filter(Boolean).join(' / ');
  return [rua, f.bairro, cidade].filter(Boolean).join(' — ');
}

/**
 * Editor de dias e horários.
 *   const ed = editorHorarios({ inicial: [{ dia:'sab', inicio:'07:00', fim:'12:00' }] });
 *   ed.node; ed.getValor() → [{...}]; ed.validar() → mensagem | null
 */
export function editorHorarios({ inicial = [] } = {}) {
  const node = el('div', { className: 'horarios-editor' });
  node.appendChild(el('label', { className: 'horarios-titulo', text: 'Dias e horários em que você está na feira' }));
  const linhas = el('div', { className: 'horarios-linhas' });
  node.appendChild(linhas);

  function addLinha(h = { dia: 'sab', inicio: '07:00', fim: '12:00' }) {
    const linha = el('div', { className: 'horarios-linha' });
    const dia = el('select', { attrs: { 'aria-label': 'Dia da semana' } });
    for (const d of DIAS) dia.appendChild(el('option', { text: d.longo, attrs: { value: d.id } }));
    dia.value = h.dia;
    const inicio = el('input', { attrs: { type: 'time', 'aria-label': 'Início', step: 300 } });
    inicio.value = h.inicio;
    const fim = el('input', { attrs: { type: 'time', 'aria-label': 'Fim', step: 300 } });
    fim.value = h.fim;
    const remover = el('button', {
      className: 'btn btn-ghost btn-sm', text: 'Remover', attrs: { type: 'button' },
      on: { click: () => { linha.remove(); } },
    });
    linha.append(dia, inicio, el('span', { text: 'até' }), fim, remover);
    linha._valor = () => ({ dia: dia.value, inicio: inicio.value, fim: fim.value });
    linhas.appendChild(linha);
  }

  (inicial.length ? inicial : [undefined]).forEach((h) => addLinha(h));
  node.appendChild(el('button', {
    className: 'btn btn-ghost btn-sm', text: '+ Adicionar outro dia', attrs: { type: 'button' },
    on: {
      click: () => {
        const ultimo = [...linhas.children].at(-1)?._valor();
        addLinha(ultimo ? { ...ultimo } : undefined);
      },
    },
  }));

  return {
    node,
    getValor: () => [...linhas.children].map((l) => l._valor()),
    validar() {
      const v = this.getValor();
      if (!v.length) return 'Adicione ao menos um dia e horário.';
      if (v.some((h) => !h.inicio || !h.fim)) return 'Preencha o horário de início e de fim.';
      if (v.some((h) => h.inicio >= h.fim)) return 'O horário de início deve ser antes do fim.';
      return null;
    },
  };
}

/** Lista "Agricultor — horários" de uma feira. `destacarId` marca o próprio agricultor. */
export function listaParticipantes(feira, { destacarId } = {}) {
  const ul = el('ul', { className: 'feira-participantes' });
  for (const p of feira.participantes || []) {
    const li = el('li', { className: p.agricultor.id === destacarId ? 'is-voce' : '' });
    li.appendChild(el('a', { text: p.agricultor.nome, attrs: { href: `#/agricultores/${p.agricultor.id}` } }));
    if (p.agricultor.id === destacarId) li.appendChild(el('span', { className: 'feira-voce', text: ' (você)' }));
    li.appendChild(el('span', { className: 'feira-horarios', text: textoHorarios(p.horarios) }));
    ul.appendChild(li);
  }
  return ul;
}
