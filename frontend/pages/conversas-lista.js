// pages/conversas-lista.js — RF08, RF12 (GET /conversas) — Fase B
//
// Tela acessível por cliente e agricultor. Mostra cada conversa do usuário
// logado como um card clicável que leva pra #/conversas/:id.

import {
  el, limpar, bannerErro, criarAvatar, loading, estadoVazio, formatarData,
} from '../ui.js';
import { listarConversas } from '../api.js';

const PREVIEW_MAX = 60;

export async function renderConversasLista({ outlet }) {
  limpar(outlet);

  outlet.appendChild(el('div', {
    className: 'page-header',
    children: [
      el('h1', { className: 'page-title', text: 'Conversas' }),
      el('p', {
        className: 'page-subtitle',
        text: 'Suas mensagens com agricultores e clientes.',
      }),
    ],
  }));

  const area = el('div');
  outlet.appendChild(area);
  area.appendChild(loading());

  let conversas;
  try {
    conversas = await listarConversas();
  } catch (err) {
    limpar(area);
    area.appendChild(bannerErro(err));
    return;
  }

  limpar(area);

  if (!Array.isArray(conversas) || conversas.length === 0) {
    area.appendChild(estadoVazio(
      "Você ainda não iniciou conversas. Abra o perfil de um agricultor e clique em 'Abrir conversa'."
    ));
    return;
  }

  const lista = el('div', { className: 'conversas-lista' });
  for (const c of conversas) {
    lista.appendChild(cardConversa(c));
  }
  area.appendChild(lista);
}

function cardConversa(c) {
  const outro = c.outro || {};
  const ult = c.ultima_mensagem || null;

  const card = el('a', {
    className: 'card card-link card-conversa',
    attrs: { href: `#/conversas/${c.id}` },
  });

  card.appendChild(criarAvatar(outro.nome, outro.foto_id, 48));

  const corpo = el('div', { className: 'conversa-corpo' });

  // Linha 1: nome
  corpo.appendChild(el('p', {
    className: 'conversa-nome',
    text: outro.nome || (outro.role === 'agricultor' ? 'Agricultor' : 'Cliente'),
  }));

  // Linha 2: preview
  let previewTxt;
  if (!ult) {
    previewTxt = 'Sem mensagens ainda';
  } else if (ult.tipo === 'snapshot') {
    previewTxt = '📦 Snapshot do carrinho';
  } else {
    const t = ult.preview || '';
    previewTxt = t.length > PREVIEW_MAX ? t.slice(0, PREVIEW_MAX - 1) + '…' : t;
  }
  corpo.appendChild(el('p', { className: 'conversa-preview', text: previewTxt }));

  // Linha 3: data
  corpo.appendChild(el('p', {
    className: 'conversa-data',
    text: ult?.created_at ? formatarData(ult.created_at) : '—',
  }));

  card.appendChild(corpo);
  return card;
}
