// pages/minhas-feiras.js — o agricultor informa em quais feiras vende, com
// endereço, dias e horários. As feiras aparecem no mapa dos clientes.
//
// Se a feira já foi cadastrada por outro agricultor, ele só "entra" nela
// (mesmo ponto no mapa) informando os próprios horários.

import { el, limpar, bannerErro, loading, toast, estadoVazio } from '../ui.js';
import {
  listarMinhasFeiras, listarFeiras, criarFeira, salvarHorariosFeira, sairDaFeira,
} from '../api.js';
import { getUser } from '../auth.js';
import { navigate } from '../router.js';
import { camposEndereco } from '../campos-endereco.js';
import {
  editorHorarios, textoHorarios, enderecoFeira,
} from '../feira-ui.js';

export async function renderMinhasFeiras({ outlet }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando feiras...'));
  const user = getUser();

  let minhas;
  try {
    minhas = (await listarMinhasFeiras())?.items || [];
  } catch (err) {
    limpar(outlet);
    outlet.appendChild(bannerErro(err));
    return;
  }
  limpar(outlet);

  outlet.appendChild(el('div', {
    className: 'page-header',
    children: [
      el('h1', { className: 'page-title', text: 'Minhas feiras' }),
      el('p', {
        className: 'page-subtitle',
        text: 'Conte em quais feiras você vende e quando. Elas aparecem no mapa para os clientes, com seu nome e seus horários.',
      }),
    ],
  }));

  // ---- feiras atuais ----
  const sec = el('section', { className: 'section' });
  sec.appendChild(el('h2', { className: 'section-title', text: 'Onde estou' }));
  if (!minhas.length) {
    sec.appendChild(estadoVazio('Você ainda não informou nenhuma feira.'));
  } else {
    const lista = el('div', { className: 'feiras-lista' });
    for (const f of minhas) lista.appendChild(cardMinhaFeira(f, user.id));
    sec.appendChild(lista);
  }
  outlet.appendChild(sec);

  // ---- adicionar ----
  const add = el('section', { className: 'section' });
  add.appendChild(el('h2', { className: 'section-title', text: 'Adicionar feira' }));
  add.appendChild(buscaFeiraExistente(new Set(minhas.map((f) => f.id))));
  add.appendChild(formNovaFeira());
  outlet.appendChild(add);
}

function recarregar() { navigate('#/minhas-feiras'); }

// ---------------------------------------------------------------
function cardMinhaFeira(f, meuId) {
  const card = el('div', { className: 'card feira-card' });
  card.appendChild(el('h3', { text: f.nome }));
  card.appendChild(el('p', { className: 'feira-endereco', text: enderecoFeira(f) || 'Endereço não informado' }));
  if (f.latitude == null) {
    card.appendChild(el('p', {
      className: 'form-help form-aviso',
      text: 'Não achamos esse endereço no mapa, então a feira ainda não aparece para os clientes.',
    }));
  }
  card.appendChild(el('p', { className: 'feira-meus-horarios', children: [el('strong', { text: 'Seus horários: ' }), textoHorarios(f.meus_horarios)] }));

  const outros = (f.participantes || []).filter((p) => p.agricultor.id !== meuId);
  if (outros.length) {
    card.appendChild(el('p', { className: 'form-help', text: `Também vendem aqui: ${outros.map((p) => p.agricultor.nome).join(', ')}` }));
  }

  const acoes = el('div', { className: 'feira-acoes' });
  const editorSlot = el('div');
  const btnEditar = el('button', { className: 'btn btn-secondary btn-sm', text: 'Editar horários', attrs: { type: 'button' } });
  btnEditar.addEventListener('click', () => {
    if (editorSlot.firstChild) { limpar(editorSlot); return; }
    editorSlot.appendChild(formHorarios(f.meus_horarios, async (horarios) => {
      await salvarHorariosFeira(f.id, horarios);
      toast('Horários atualizados', { tipo: 'success' });
      recarregar();
    }));
  });
  const btnSair = el('button', { className: 'btn btn-ghost btn-sm', text: 'Não vendo mais aqui', attrs: { type: 'button' } });
  let confirmando = false;
  btnSair.addEventListener('click', async () => {
    if (!confirmando) {
      confirmando = true;
      btnSair.textContent = 'Clique de novo para confirmar';
      setTimeout(() => { confirmando = false; btnSair.textContent = 'Não vendo mais aqui'; }, 4000);
      return;
    }
    btnSair.disabled = true;
    try {
      await sairDaFeira(f.id);
      toast('Você saiu da feira', { tipo: 'success' });
      recarregar();
    } catch (err) {
      toast(err?.message || 'Erro ao sair da feira', { tipo: 'error' });
      btnSair.disabled = false;
    }
  });
  acoes.append(btnEditar, btnSair);
  card.appendChild(acoes);
  card.appendChild(editorSlot);
  return card;
}

/** Mini formulário só de horários (editar ou entrar numa feira existente). */
function formHorarios(inicial, aoSalvar, textoBotao = 'Salvar horários') {
  const form = el('form', { className: 'feira-horarios-form', attrs: { novalidate: true } });
  const erro = el('div');
  const ed = editorHorarios({ inicial });
  const btn = el('button', { className: 'btn btn-primary btn-sm', text: textoBotao, attrs: { type: 'submit' } });
  form.append(erro, ed.node, btn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erro);
    const msg = ed.validar();
    if (msg) { erro.appendChild(bannerErro(msg)); return; }
    btn.disabled = true;
    try {
      await aoSalvar(ed.getValor());
    } catch (err) {
      erro.appendChild(bannerErro(err));
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

// ---------------------------------------------------------------
function buscaFeiraExistente(jaParticipo) {
  const box = el('div', { className: 'card feira-busca' });
  box.appendChild(el('h3', { text: 'A feira já está cadastrada?' }));
  box.appendChild(el('p', { className: 'form-help', text: 'Procure pelo nome ou cidade. Se outro agricultor já cadastrou, é só entrar nela e informar seus horários.' }));
  const form = el('form', { className: 'feira-busca-form', attrs: { role: 'search' } });
  const input = el('input', { attrs: { type: 'search', placeholder: 'Ex.: Feira do Produtor, Campinas', 'aria-label': 'Buscar feira' } });
  form.append(input, el('button', { className: 'btn btn-secondary', text: 'Buscar', attrs: { type: 'submit' } }));
  box.appendChild(form);
  const resultados = el('div', { className: 'feira-busca-resultados' });
  box.appendChild(resultados);

  async function buscar() {
    limpar(resultados);
    const termo = input.value.trim();
    resultados.appendChild(loading('Buscando...'));
    try {
      // Sem termo: as mais próximas do endereço do agricultor.
      const [porNome, porCidade] = await Promise.all([
        listarFeiras(termo ? { q: termo } : {}),
        termo ? listarFeiras({ cidade: termo }) : Promise.resolve({ items: [] }),
      ]);
      const vistos = new Set();
      const items = [...(porNome.items || []), ...(porCidade.items || [])]
        .filter((f) => !vistos.has(f.id) && vistos.add(f.id))
        .slice(0, 10);
      limpar(resultados);
      if (!items.length) {
        resultados.appendChild(el('p', { className: 'form-help', text: 'Nenhuma feira encontrada. Cadastre uma nova logo abaixo.' }));
        return;
      }
      for (const f of items) resultados.appendChild(itemResultado(f, jaParticipo.has(f.id)));
    } catch (err) {
      limpar(resultados);
      resultados.appendChild(bannerErro(err));
    }
  }
  form.addEventListener('submit', (ev) => { ev.preventDefault(); buscar(); });
  buscar();
  return box;
}

function itemResultado(f, jaParticipo) {
  const item = el('div', { className: 'feira-resultado' });
  const topo = el('div', { className: 'feira-resultado-topo' });
  const info = el('div');
  info.appendChild(el('strong', { text: f.nome }));
  info.appendChild(el('div', { className: 'form-help', text: enderecoFeira(f) }));
  info.appendChild(el('div', {
    className: 'form-help',
    text: `${f.participantes.length} agricultor(es)${f.distancia_km != null ? ` · ${f.distancia_km.toLocaleString('pt-BR')} km de você` : ''}`,
  }));
  topo.appendChild(info);
  const slot = el('div');
  if (jaParticipo) {
    topo.appendChild(el('span', { className: 'status-badge status-entregue', text: 'Você já vende aqui' }));
  } else {
    const btn = el('button', { className: 'btn btn-primary btn-sm', text: 'Vendo aqui', attrs: { type: 'button' } });
    btn.addEventListener('click', () => {
      if (slot.firstChild) { limpar(slot); return; }
      slot.appendChild(formHorarios([], async (horarios) => {
        await salvarHorariosFeira(f.id, horarios);
        toast(`Pronto! Você aparece na ${f.nome}`, { tipo: 'success' });
        recarregar();
      }, 'Entrar nesta feira'));
    });
    topo.appendChild(btn);
  }
  item.append(topo, slot);
  return item;
}

// ---------------------------------------------------------------
function formNovaFeira() {
  const form = el('form', { className: 'form form-perfil feira-nova', attrs: { novalidate: true } });
  form.appendChild(el('h3', { text: 'Cadastrar nova feira' }));
  const erro = el('div');
  form.appendChild(erro);

  const nomeWrap = el('div', { className: 'form-field' });
  nomeWrap.appendChild(el('label', { text: 'Nome da feira', attrs: { for: 'fn-nome' } }));
  const nome = el('input', { attrs: { id: 'fn-nome', type: 'text', maxlength: 120, placeholder: 'Ex.: Feira do Produtor de Barão Geraldo' } });
  nomeWrap.appendChild(nome);
  form.appendChild(nomeWrap);

  const endereco = camposEndereco({ prefixo: 'fn-end' });
  endereco.setStatusLocalizacao('A localização no mapa é calculada pelo endereço. Se estiver na feira agora, pode usar sua localização atual.');
  form.appendChild(endereco.node);

  const horarios = editorHorarios();
  form.appendChild(horarios.node);

  const btn = el('button', { className: 'btn btn-primary', text: 'Cadastrar feira', attrs: { type: 'submit' } });
  form.appendChild(el('div', { className: 'form-acoes', children: [btn] }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erro);
    const msg = !nome.value.trim() ? 'Informe o nome da feira.'
      : endereco.validar() || (!endereco.getValores().cidade ? 'Informe a cidade da feira.' : null) || horarios.validar();
    if (msg) { erro.appendChild(bannerErro(msg)); return; }

    btn.disabled = true;
    btn.textContent = 'Cadastrando...';
    try {
      const payload = { nome: nome.value.trim(), horarios: horarios.getValor() };
      for (const [k, v] of Object.entries(endereco.getValores())) if (v) payload[k] = v;
      const coords = endereco.getCoordsManuais();
      if (coords) Object.assign(payload, coords);
      const feira = await criarFeira(payload);
      if (feira.agrupada) toast(`Essa feira já existia: você entrou na ${feira.nome}`, { tipo: 'success' });
      else if (feira.latitude == null) toast('Feira cadastrada, mas não achamos o endereço no mapa', { tipo: 'info' });
      else toast('Feira cadastrada! Ela já aparece no mapa', { tipo: 'success' });
      recarregar();
    } catch (err) {
      erro.appendChild(bannerErro(err));
      btn.disabled = false;
      btn.textContent = 'Cadastrar feira';
    }
  });
  return form;
}

