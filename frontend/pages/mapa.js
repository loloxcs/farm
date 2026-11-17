// pages/mapa.js — aba "Mapa": agricultores mais próximos do cliente.
//
// Mapa: Leaflet + OpenStreetMap (gratuito, sem chave). O Leaflet é carregado
// sob demanda da CDN só quando esta página abre.
//
// Origem (de onde medimos a distância), nesta ordem:
//   1. localização do navegador, se a pessoa clicar em "Usar minha localização"
//   2. endereço salvo do usuário logado (o backend usa direto)
// Lista e marcadores vêm de GET /agricultores/proximos e GET /feiras, já
// ordenados por distância. Feiras têm marcador próprio (laranja) e mostram os
// agricultores que vendem lá com dias e horários.

import { el, limpar, bannerErro, criarAvatar, renderEstrelas, loading, estadoVazio } from '../ui.js';
import { listarAgricultoresProximos, listarFeiras } from '../api.js';
import { textoDias, enderecoFeira, listaParticipantes } from '../feira-ui.js';
import { getUser, isAuthenticated } from '../auth.js';

const LEAFLET_VERSAO = '1.9.4';
const RAIOS = [
  { valor: '', rotulo: 'Qualquer distância' },
  { valor: '5', rotulo: 'Até 5 km' },
  { valor: '10', rotulo: 'Até 10 km' },
  { valor: '25', rotulo: 'Até 25 km' },
  { valor: '50', rotulo: 'Até 50 km' },
  { valor: '100', rotulo: 'Até 100 km' },
];

let leafletPromise = null;
function carregarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://unpkg.com/leaflet@${LEAFLET_VERSAO}/dist/leaflet.css`;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = `https://unpkg.com/leaflet@${LEAFLET_VERSAO}/dist/leaflet.js`;
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletPromise = null; reject(new Error('Não foi possível carregar o mapa. Verifique sua conexão.')); };
    document.head.appendChild(js);
  });
  return leafletPromise;
}

function formatarDistancia(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

// Leaflet guarda estado no elemento; ao sair da página, destruímos o mapa.
let mapaAtual = null;
window.addEventListener('hashchange', () => {
  if (mapaAtual && !location.hash.startsWith('#/mapa')) { mapaAtual.remove(); mapaAtual = null; }
});

export async function renderMapa({ outlet }) {
  limpar(outlet);
  const user = isAuthenticated() ? getUser() : null;

  outlet.appendChild(el('div', {
    className: 'page-header',
    children: [
      el('h1', { className: 'page-title', text: 'Agricultores e feiras perto de você' }),
      el('p', { className: 'page-subtitle', text: 'Agricultores e feiras do mais perto ao mais longe, a partir do seu endereço.' }),
    ],
  }));

  // ---- controles ----
  const controles = el('div', { className: 'mapa-controles' });
  const origemTexto = el('span', { className: 'mapa-origem' });
  const raioSelect = el('select', { attrs: { id: 'mapa-raio', 'aria-label': 'Distância máxima' } });
  for (const r of RAIOS) raioSelect.appendChild(el('option', { text: r.rotulo, attrs: { value: r.valor } }));
  const btnLocalizacao = el('button', {
    className: 'btn btn-secondary',
    text: '📍 Usar minha localização',
    attrs: { type: 'button' },
  });
  controles.appendChild(origemTexto);
  controles.appendChild(raioSelect);
  controles.appendChild(btnLocalizacao);
  if (user) {
    controles.appendChild(el('a', {
      className: 'btn btn-ghost',
      text: 'Alterar meu endereço',
      attrs: { href: '#/meu-perfil?voltar=mapa' },
    }));
  }
  outlet.appendChild(controles);

  const avisoSlot = el('div');
  outlet.appendChild(avisoSlot);

  const layout = el('div', { className: 'mapa-layout' });
  const mapaEl = el('div', { className: 'mapa-canvas', attrs: { id: 'mapa-canvas', role: 'region', 'aria-label': 'Mapa dos agricultores' } });
  const listaCol = el('div', { className: 'mapa-coluna' });
  const abas = el('div', { className: 'mapa-abas', attrs: { role: 'tablist' } });
  const abaAgr = el('button', { className: 'chip-filtro is-active', text: 'Agricultores', attrs: { type: 'button', role: 'tab' } });
  const abaFeiras = el('button', { className: 'chip-filtro', text: 'Feiras', attrs: { type: 'button', role: 'tab' } });
  abas.append(abaAgr, abaFeiras);
  const listaEl = el('ol', { className: 'mapa-lista' });
  const listaFeirasEl = el('ol', { className: 'mapa-lista' });
  listaFeirasEl.hidden = true;
  listaCol.append(abas, listaEl, listaFeirasEl);
  function mostrarAba(feiras) {
    abaAgr.classList.toggle('is-active', !feiras);
    abaFeiras.classList.toggle('is-active', feiras);
    listaEl.hidden = feiras;
    listaFeirasEl.hidden = !feiras;
  }
  abaAgr.addEventListener('click', () => mostrarAba(false));
  abaFeiras.addEventListener('click', () => mostrarAba(true));
  layout.appendChild(mapaEl);
  layout.appendChild(listaCol);
  outlet.appendChild(layout);

  // ---- estado ----
  let coordsNavegador = null; // { lat, lng } quando a pessoa usa a localização do navegador
  let L;
  try {
    L = await carregarLeaflet();
  } catch (err) {
    avisoSlot.appendChild(bannerErro(err));
    return;
  }

  if (mapaAtual) { mapaAtual.remove(); mapaAtual = null; }
  const mapa = L.map(mapaEl).setView([-15.78, -47.93], 4); // Brasil inteiro até achar a origem
  mapaAtual = mapa;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  const camada = L.layerGroup().addTo(mapa);
  const marcadores = new Map(); // id → marker

  async function carregar() {
    limpar(avisoSlot);
    limpar(listaEl);
    limpar(listaFeirasEl);
    listaEl.appendChild(loading('Buscando agricultores...'));
    camada.clearLayers();
    marcadores.clear();

    const filtro = {
      lat: coordsNavegador?.lat,
      lng: coordsNavegador?.lng,
      raio_km: raioSelect.value || undefined,
    };
    let data;
    let feirasResp = { items: [] };
    try {
      [data, feirasResp] = await Promise.all([
        listarAgricultoresProximos(filtro),
        listarFeiras(filtro).catch(() => ({ items: [] })),
      ]);
    } catch (err) {
      limpar(listaEl);
      if (err?.code === 'SEM_LOCALIZACAO') {
        avisoSlot.appendChild(avisoSemLocalizacao(user));
        origemTexto.textContent = '';
      } else {
        avisoSlot.appendChild(bannerErro(err));
      }
      return;
    }

    limpar(listaEl);
    const { origem, items = [], sem_localizacao: semLocal = 0 } = data;
    origemTexto.textContent = origem.fonte === 'parametro'
      ? 'Distâncias a partir da sua localização atual'
      : 'Distâncias a partir do seu endereço';

    // Marcador "você está aqui"
    L.circleMarker([origem.latitude, origem.longitude], {
      radius: 9, color: '#ffffff', weight: 3, fillColor: '#2f6fdf', fillOpacity: 1,
    }).bindTooltip('Você', { permanent: false }).addTo(camada);

    // ---- feiras ----
    const feiras = (feirasResp.items || []).filter((f) => Number.isFinite(f.latitude) && Number.isFinite(f.longitude));
    abaFeiras.textContent = `Feiras (${feiras.length})`;
    abaAgr.textContent = `Agricultores (${items.length})`;
    if (!feiras.length) {
      listaFeirasEl.appendChild(estadoVazio(raioSelect.value
        ? 'Nenhuma feira nessa distância.'
        : 'Nenhuma feira cadastrada ainda.'));
    }
    feiras.forEach((f) => {
      const marker = L.marker([f.latitude, f.longitude], { title: f.nome, icon: iconeFeira(L), zIndexOffset: -100 })
        .bindPopup(popupFeira(f), { maxWidth: 320 })
        .addTo(camada);
      listaFeirasEl.appendChild(itemFeira(f, () => {
        mapa.setView([f.latitude, f.longitude], Math.max(mapa.getZoom(), 14));
        marker.openPopup();
      }));
    });

    if (!items.length) {
      listaEl.appendChild(estadoVazio(raioSelect.value
        ? 'Nenhum agricultor nessa distância. Tente aumentar o raio.'
        : 'Nenhum agricultor com localização cadastrada ainda.'));
      const pts = [[origem.latitude, origem.longitude], ...feiras.slice(0, 5).map((f) => [f.latitude, f.longitude])];
      if (pts.length > 1) mapa.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
      else mapa.setView([origem.latitude, origem.longitude], 12);
      return;
    }

    items.forEach((a, i) => {
      const marker = L.marker([a.latitude, a.longitude], { title: a.nome })
        .bindPopup(popupAgricultor(a, i + 1))
        .addTo(camada);
      marcadores.set(a.id, marker);
      listaEl.appendChild(itemLista(a, i + 1, () => {
        mapa.setView([a.latitude, a.longitude], Math.max(mapa.getZoom(), 13));
        marker.openPopup();
      }));
    });

    // Enquadra a origem + os 5 mais próximos (não o país inteiro)
    const pontos = [
      [origem.latitude, origem.longitude],
      ...items.slice(0, 5).map((a) => [a.latitude, a.longitude]),
      ...feiras.slice(0, 3).map((f) => [f.latitude, f.longitude]),
    ];
    mapa.fitBounds(L.latLngBounds(pontos), { padding: [40, 40], maxZoom: 14 });

    if (semLocal > 0) {
      avisoSlot.appendChild(el('div', {
        className: 'banner banner-info',
        text: `${semLocal} agricultor(es) ainda não cadastraram endereço e não aparecem no mapa.`,
      }));
    }
  }

  raioSelect.addEventListener('change', carregar);
  btnLocalizacao.addEventListener('click', () => {
    if (!navigator.geolocation) {
      limpar(avisoSlot);
      avisoSlot.appendChild(bannerErro('Seu navegador não permite pegar a localização.'));
      return;
    }
    btnLocalizacao.disabled = true;
    btnLocalizacao.textContent = 'Localizando...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coordsNavegador = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        btnLocalizacao.disabled = false;
        btnLocalizacao.textContent = '📍 Usar minha localização';
        carregar();
      },
      () => {
        btnLocalizacao.disabled = false;
        btnLocalizacao.textContent = '📍 Usar minha localização';
        limpar(avisoSlot);
        avisoSlot.appendChild(bannerErro('Não foi possível pegar sua localização. Verifique a permissão do navegador.'));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });

  // Visitante sem login: não há endereço salvo, então já pede a localização.
  if (!user) {
    avisoSlot.appendChild(avisoSemLocalizacao(null));
    return;
  }
  await carregar();
}

function avisoSemLocalizacao(user) {
  const box = el('div', { className: 'banner banner-info mapa-aviso' });
  if (!user) {
    box.appendChild(el('p', { text: 'Clique em "Usar minha localização" para ver os agricultores mais perto de você, ou entre na sua conta para usar seu endereço.' }));
    box.appendChild(el('a', { className: 'btn btn-primary', text: 'Entrar', attrs: { href: '#/login' } }));
    return box;
  }
  box.appendChild(el('p', { text: 'Cadastre seu endereço para ver os agricultores mais perto de você (ou use sua localização atual).' }));
  box.appendChild(el('a', {
    className: 'btn btn-primary',
    text: 'Cadastrar meu endereço',
    attrs: { href: '#/meu-perfil?voltar=mapa' },
  }));
  return box;
}

function itemLista(a, posicao, aoClicar) {
  const li = el('li', { className: 'mapa-item' });
  const botao = el('button', { className: 'mapa-item-btn', attrs: { type: 'button' }, on: { click: aoClicar } });
  botao.appendChild(el('span', { className: 'mapa-item-pos', text: String(posicao) }));
  botao.appendChild(criarAvatar(a.nome, a.foto_id, 44));
  const info = el('span', { className: 'mapa-item-info' });
  info.appendChild(el('span', { className: 'mapa-item-nome', text: a.nome }));
  info.appendChild(el('span', {
    className: 'mapa-item-local',
    text: [a.bairro, [a.cidade, a.estado].filter(Boolean).join(' / ')].filter(Boolean).join(' — ') || 'Local não informado',
  }));
  info.appendChild(renderEstrelas(a.media_avaliacoes, a.total_avaliacoes));
  botao.appendChild(info);
  botao.appendChild(el('span', { className: 'mapa-item-dist', text: formatarDistancia(a.distancia_km) }));
  li.appendChild(botao);
  li.appendChild(el('a', { className: 'mapa-item-link', text: 'Ver produtos →', attrs: { href: `#/agricultores/${a.id}` } }));
  return li;
}

function popupAgricultor(a, posicao) {
  const box = el('div', { className: 'mapa-popup' });
  box.appendChild(el('strong', { text: `${posicao}. ${a.nome}` }));
  box.appendChild(el('div', { text: `${formatarDistancia(a.distancia_km)} de você` }));
  const local = [a.cidade, a.estado].filter(Boolean).join(' / ');
  if (local) box.appendChild(el('div', { className: 'mapa-popup-local', text: local }));
  box.appendChild(el('a', { text: 'Ver produtos', attrs: { href: `#/agricultores/${a.id}` } }));
  return box;
}

// ---------------------------------------------------------------
// Feiras
// ---------------------------------------------------------------
let iconeFeiraCache = null;
function iconeFeira(L) {
  if (!iconeFeiraCache) {
    iconeFeiraCache = L.divIcon({
      className: 'mapa-icone-feira',
      html: '<span aria-hidden="true">🧺</span>',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -16],
    });
  }
  return iconeFeiraCache;
}

function popupFeira(f) {
  const box = el('div', { className: 'mapa-popup mapa-popup-feira' });
  box.appendChild(el('strong', { text: `🧺 ${f.nome}` }));
  if (f.distancia_km != null) box.appendChild(el('div', { text: `${formatarDistancia(f.distancia_km)} de você` }));
  const end = enderecoFeira(f);
  if (end) box.appendChild(el('div', { className: 'mapa-popup-local', text: end }));
  box.appendChild(el('div', { className: 'mapa-popup-sub', text: 'Quem vende aqui:' }));
  box.appendChild(listaParticipantes(f));
  return box;
}

function itemFeira(f, aoClicar) {
  const li = el('li', { className: 'mapa-item mapa-item-feira' });
  const botao = el('button', { className: 'mapa-item-btn', attrs: { type: 'button' }, on: { click: aoClicar } });
  botao.appendChild(el('span', { className: 'mapa-item-feira-icone', text: '🧺' }));
  const info = el('span', { className: 'mapa-item-info' });
  info.appendChild(el('span', { className: 'mapa-item-nome', text: f.nome }));
  info.appendChild(el('span', { className: 'mapa-item-local', text: enderecoFeira(f) || 'Endereço não informado' }));
  info.appendChild(el('span', {
    className: 'mapa-item-local',
    text: `${textoDias(f.dias)} · ${f.participantes.length} agricultor(es)`,
  }));
  botao.appendChild(info);
  if (f.distancia_km != null) botao.appendChild(el('span', { className: 'mapa-item-dist', text: formatarDistancia(f.distancia_km) }));
  li.appendChild(botao);
  li.appendChild(listaParticipantes(f));
  return li;
}
