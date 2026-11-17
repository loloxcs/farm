// pages/perfil-cliente.js — "Meu perfil" do CLIENTE.
//
// Abas (persistidas em ?aba=):
//   dados      nome, foto, telefone (email só leitura)      PATCH /auth/me
//   endereco   endereço usado no mapa                        PATCH /auth/me/endereco
//   compras    histórico de pedidos                          GET /pedidos
//   avaliacoes avaliações que o cliente fez                  GET /avaliacoes/minhas
//
// Privacidade: o agricultor só vê nome e foto do cliente (nas conversas e nas
// avaliações). Endereço, telefone, email e histórico aparecem só aqui.

import {
  el, limpar, bannerErro, loading, toast, criarAvatar, campoUploadFoto,
  estadoVazio, formatarMoeda, formatarData, renderEstrelas,
} from '../ui.js';
import {
  authMe, atualizarMeusDados, atualizarMeuEndereco, listarPedidos, listarMinhasAvaliacoes,
} from '../api.js';
import { getUser, setUser } from '../auth.js';
import { navigate } from '../router.js';
import { camposEndereco, textoLocalizacao, mascaraCep } from '../campos-endereco.js';

const ABAS = [
  { id: 'dados', rotulo: 'Meus dados' },
  { id: 'endereco', rotulo: 'Endereço' },
  { id: 'compras', rotulo: 'Histórico de compras' },
  { id: 'avaliacoes', rotulo: 'Minhas avaliações' },
];
const CAMPOS_END = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];
const STATUS_LABEL = { pendente: 'Pendente', confirmado: 'Confirmado', entregue: 'Entregue', cancelado: 'Cancelado' };

export async function renderPerfilCliente({ outlet, query = {} }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando perfil...'));

  let me;
  try {
    me = await authMe();
  } catch (err) {
    limpar(outlet);
    outlet.appendChild(bannerErro(err));
    return;
  }
  limpar(outlet);

  const voltarParaMapa = query.voltar === 'mapa';
  const abaAtual = ABAS.some((a) => a.id === query.aba) ? query.aba : (voltarParaMapa ? 'endereco' : 'dados');

  // Cabeçalho
  const header = el('div', { className: 'profile-header meu-perfil-header' });
  header.appendChild(criarAvatar(me.nome, me.foto_id, 96));
  const info = el('div', { className: 'profile-info' });
  info.appendChild(el('h1', { className: 'profile-nome', text: me.nome || 'Meu perfil' }));
  const local = [me.endereco?.cidade, me.endereco?.estado].filter(Boolean).join(' / ');
  info.appendChild(el('p', { className: 'page-subtitle', text: local || 'Cliente' }));
  header.appendChild(info);
  outlet.appendChild(header);

  // Abas
  const tabs = el('div', { className: 'perfil-abas', attrs: { role: 'tablist' } });
  for (const aba of ABAS) {
    tabs.appendChild(el('a', {
      className: `chip-filtro ${aba.id === abaAtual ? 'is-active' : ''}`,
      text: aba.rotulo,
      attrs: { href: `#/meu-perfil?aba=${aba.id}`, role: 'tab', 'aria-selected': aba.id === abaAtual ? 'true' : 'false' },
    }));
  }
  outlet.appendChild(tabs);

  outlet.appendChild(el('p', {
    className: 'form-help perfil-privacidade',
    text: '🔒 Os agricultores só veem seu nome e sua foto. Endereço, telefone e histórico de compras ficam visíveis apenas para você.',
  }));

  const conteudo = el('div', { className: 'perfil-conteudo' });
  outlet.appendChild(conteudo);

  if (abaAtual === 'dados') conteudo.appendChild(formDados(me));
  else if (abaAtual === 'endereco') conteudo.appendChild(formEndereco(me, voltarParaMapa));
  else if (abaAtual === 'compras') await renderCompras(conteudo);
  else await renderAvaliacoes(conteudo);
}

// ---------------------------------------------------------------
// Meus dados
// ---------------------------------------------------------------
function formDados(me) {
  let estado = { nome: me.nome || '', telefone: me.telefone || '' };
  const form = el('form', { className: 'form form-perfil', attrs: { novalidate: true } });
  form.appendChild(el('h2', { text: 'Meus dados' }));
  const erroSlot = el('div');
  form.appendChild(erroSlot);

  const upload = campoUploadFoto({ fotoIdInicial: me.foto_id, label: 'Foto de perfil' });
  form.appendChild(upload.node);

  const nome = campo('pc-nome', 'Nome', estado.nome, { required: true, autocomplete: 'name' });
  const tel = campo('pc-telefone', 'Telefone', estado.telefone, { type: 'tel', autocomplete: 'tel' });
  const email = campo('pc-email', 'Email', me.email || '', { type: 'email', readonly: true });
  email.node.appendChild(el('span', { className: 'form-help', text: 'O email é usado para entrar e não pode ser alterado aqui.' }));
  form.appendChild(nome.node);
  form.appendChild(tel.node);
  form.appendChild(email.node);

  const btn = el('button', { className: 'btn btn-primary', text: 'Salvar alterações', attrs: { type: 'submit' } });
  form.appendChild(el('div', { className: 'form-acoes', children: [btn] }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erroSlot);
    const novoNome = nome.input.value.trim();
    const novoTel = tel.input.value.trim();
    if (!novoNome) { erroSlot.appendChild(bannerErro('Informe seu nome.')); return; }

    btn.disabled = true;
    btn.textContent = 'Salvando...';
    try {
      const patch = {};
      if (novoNome !== estado.nome) patch.nome = novoNome;
      if (novoTel !== estado.telefone) patch.telefone = novoTel || null;
      const foto = await upload.getValue();
      if (foto) Object.assign(patch, foto);
      if (!Object.keys(patch).length) { toast('Nada a salvar', { tipo: 'info' }); return; }

      const atualizado = await atualizarMeusDados(patch);
      estado = { nome: atualizado.nome || '', telefone: atualizado.telefone || '' };
      const u = getUser();
      if (u) setUser({ ...u, nome: atualizado.nome, foto_id: atualizado.foto_id });
      window.dispatchEvent(new Event('auth:changed'));
      toast('Perfil atualizado', { tipo: 'success' });
      if (foto || patch.nome) navigate('#/meu-perfil?aba=dados'); // atualiza avatar/nome do topo
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    }
  });
  return form;
}

// ---------------------------------------------------------------
// Endereço
// ---------------------------------------------------------------
function formEndereco(me, voltarParaMapa) {
  let estado = normalizarEndereco(me.endereco);
  const form = el('form', { className: 'form form-perfil', attrs: { novalidate: true } });
  form.appendChild(el('h2', { text: 'Endereço' }));
  form.appendChild(el('p', {
    className: 'form-help',
    text: 'Usamos seu endereço para mostrar no mapa os agricultores mais próximos de você.',
  }));
  const erroSlot = el('div');
  form.appendChild(erroSlot);

  const campos = camposEndereco({ inicial: estado, prefixo: 'pc-end' });
  form.appendChild(campos.node);

  const btn = el('button', { className: 'btn btn-primary', text: 'Salvar endereço', attrs: { type: 'submit' } });
  form.appendChild(el('div', {
    className: 'form-acoes',
    children: [btn, el('a', { className: 'btn btn-ghost', text: 'Ver mapa', attrs: { href: '#/mapa' } })],
  }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erroSlot);
    const erro = campos.validar();
    if (erro) { erroSlot.appendChild(bannerErro(erro)); return; }

    const novo = campos.getValores();
    const patch = {};
    for (const c of CAMPOS_END) if (novo[c] !== estado[c]) patch[c] = novo[c] || null;
    const coords = campos.getCoordsManuais();
    if (coords) Object.assign(patch, coords);
    if (!Object.keys(patch).length) { toast('Nada a salvar', { tipo: 'info' }); return; }

    btn.disabled = true;
    btn.textContent = 'Salvando...';
    try {
      const r = await atualizarMeuEndereco(patch);
      estado = normalizarEndereco(r.endereco);
      campos.limparCoordsManuais();
      campos.setStatusLocalizacao(textoLocalizacao(r.endereco, r.geocodificado));
      const achou = Number.isFinite(r.endereco?.latitude);
      toast(achou ? 'Endereço salvo' : 'Endereço salvo, mas sem localização no mapa', { tipo: achou ? 'success' : 'info' });
      if (achou && voltarParaMapa) navigate('#/mapa');
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar endereço';
    }
  });
  return form;
}

// ---------------------------------------------------------------
// Histórico de compras
// ---------------------------------------------------------------
async function renderCompras(area) {
  area.appendChild(loading('Carregando compras...'));
  let resp;
  try {
    resp = await listarPedidos({ limit: 50 });
  } catch (err) {
    limpar(area);
    area.appendChild(bannerErro(err));
    return;
  }
  limpar(area);
  const pedidos = resp?.items || [];
  if (!pedidos.length) {
    area.appendChild(estadoVazio('Você ainda não fez nenhuma compra.'));
    area.appendChild(el('a', { className: 'btn btn-primary', text: 'Encontrar agricultores', attrs: { href: '#/mapa' } }));
    return;
  }

  const entregues = pedidos.filter((p) => p.status === 'entregue');
  const gasto = entregues.reduce((s, p) => s + (Number(p.total) || 0), 0);
  area.appendChild(el('div', {
    className: 'perfil-resumo',
    children: [
      resumo(String(resp.total ?? pedidos.length), 'pedidos'),
      resumo(String(entregues.length), 'entregues'),
      resumo(formatarMoeda(gasto), 'gasto em pedidos entregues'),
    ],
  }));

  const lista = el('div', { className: 'perfil-lista' });
  for (const p of pedidos) {
    const card = el('a', { className: 'card card-link perfil-compra', attrs: { href: `#/pedidos/${p.id}` } });
    const topo = el('div', { className: 'perfil-compra-topo' });
    topo.appendChild(el('strong', { text: `Pedido #${p.id} · ${p.agricultor_nome || 'Agricultor'}` }));
    topo.appendChild(el('span', {
      className: `status-badge status-${p.status || 'desconhecido'}`,
      text: STATUS_LABEL[p.status] || p.status || '—',
    }));
    card.appendChild(topo);
    const itens = (p.itens || []).map((i) => i.nome_produto || i.nome).filter(Boolean);
    if (itens.length) {
      card.appendChild(el('p', {
        className: 'perfil-compra-itens',
        text: itens.slice(0, 4).join(', ') + (itens.length > 4 ? ` e mais ${itens.length - 4}` : ''),
      }));
    }
    card.appendChild(el('div', {
      className: 'perfil-compra-rodape',
      children: [
        el('span', { text: formatarData(p.created_at) }),
        el('strong', { text: formatarMoeda(p.total) }),
      ],
    }));
    lista.appendChild(card);
  }
  area.appendChild(lista);
  if ((resp.total || 0) > pedidos.length) {
    area.appendChild(el('a', { className: 'btn btn-ghost', text: 'Ver todos os pedidos', attrs: { href: '#/pedidos' } }));
  }
}

// ---------------------------------------------------------------
// Minhas avaliações
// ---------------------------------------------------------------
async function renderAvaliacoes(area) {
  area.appendChild(loading('Carregando avaliações...'));
  let resp;
  try {
    resp = await listarMinhasAvaliacoes();
  } catch (err) {
    limpar(area);
    area.appendChild(bannerErro(err));
    return;
  }
  limpar(area);
  const items = resp?.items || [];
  if (!items.length) {
    area.appendChild(estadoVazio('Você ainda não avaliou nenhum agricultor. Depois que um pedido é entregue, dá para avaliar pela página do pedido.'));
    return;
  }
  const lista = el('div', { className: 'perfil-lista' });
  for (const av of items) {
    const item = el('div', { className: 'review-item' });
    const header = el('div', { className: 'review-header' });
    const autor = el('a', { className: 'review-author', attrs: { href: `#/agricultores/${av.agricultor.id}` } });
    autor.appendChild(criarAvatar(av.agricultor.nome, av.agricultor.foto_id, 32));
    autor.appendChild(el('span', { text: av.agricultor.nome }));
    header.appendChild(autor);
    const dir = el('div', { className: 'review-header-right' });
    dir.appendChild(renderEstrelas(av.nota, 0));
    dir.appendChild(el('div', { className: 'review-date', text: formatarData(av.updated_at || av.created_at) }));
    header.appendChild(dir);
    item.appendChild(header);
    if (av.comentario) item.appendChild(el('p', { className: 'review-comentario', text: av.comentario }));
    if (av.pedido_id) {
      item.appendChild(el('a', { className: 'form-help', text: `Pedido #${av.pedido_id}`, attrs: { href: `#/pedidos/${av.pedido_id}` } }));
    }
    lista.appendChild(item);
  }
  area.appendChild(lista);
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function campo(id, label, value, { type = 'text', required, autocomplete, readonly } = {}) {
  const node = el('div', { className: 'form-field' });
  node.appendChild(el('label', { text: label, attrs: { for: id } }));
  const input = el('input', { attrs: { id, name: id, type, required, autocomplete, readonly } });
  input.value = value;
  node.appendChild(input);
  return { node, input };
}

function resumo(valor, rotulo) {
  return el('div', {
    className: 'perfil-resumo-item',
    children: [el('strong', { text: valor }), el('span', { text: rotulo })],
  });
}

function normalizarEndereco(e = {}) {
  const out = {};
  for (const c of CAMPOS_END) out[c] = e?.[c] ? String(e[c]) : '';
  out.cep = mascaraCep(out.cep);
  out.latitude = e?.latitude ?? null;
  out.longitude = e?.longitude ?? null;
  return out;
}

