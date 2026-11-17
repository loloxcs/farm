// pages/mapa.js — aba "Mapa": agricultores mais próximos do cliente.
//
// Mapa: Leaflet + OpenStreetMap (gratuito, sem chave). O Leaflet é carregado
// sob demanda da CDN só quando esta página abre.
//
// Origem (de onde medimos a distância), nesta ordem:
//   1. localização do navegador, se a pessoa clicar em "Usar minha localização"
//   2. endereço salvo do usuário logado (o backend usa direto)
// Lista e marcadores vêm de GET /agricultores/proximos, já ordenados por distância.

import { el, limpar, bannerErro, criarAvatar, renderEstrelas, loading, estadoVazio } from '../ui.js';
import { listarAgricultoresProximos } from '../api.js';
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
      el('h1', { className: 'page-title', text: 'Agricultores perto de você' }),
      el('p', { className: 'page-subtitle', text: 'Do mais perto ao mais longe, a partir do seu endereço.' }),
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
      attrs: { href: user.role === 'agricultor' ? '#/meu-perfil' : '#/meu-endereco?voltar=mapa' },
    }));
  }
  outlet.appendChild(controles);

  const avisoSlot = el('div');
  outlet.appendChild(avisoSlot);

  const layout = el('div', { className: 'mapa-layout' });
  const mapaEl = el('div', { className: 'mapa-canvas', attrs: { id: 'mapa-canvas', role: 'region', 'aria-label': 'Mapa dos agricultores' } });
  const listaEl = el('ol', { className: 'mapa-lista' });
  layout.appendChild(mapaEl);
  layout.appendChild(listaEl);
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
    listaEl.appendChild(loading('Buscando agricultores...'));
    camada.clearLayers();
    marcadores.clear();

    let data;
    try {
      data = await listarAgricultoresProximos({
        lat: coordsNavegador?.lat,
        lng: coordsNavegador?.lng,
        raio_km: raioSelect.value || undefined,
      });
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

    if (!items.length) {
      listaEl.appendChild(estadoVazio(raioSelect.value
        ? 'Nenhum agricultor nessa distância. Tente aumentar o raio.'
        : 'Nenhum agricultor com localização cadastrada ainda.'));
      mapa.setView([origem.latitude, origem.longitude], 12);
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
    const pontos = [[origem.latitude, origem.longitude], ...items.slice(0, 5).map((a) => [a.latitude, a.longitude])];
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
    attrs: { href: user.role === 'agricultor' ? '#/meu-perfil' : '#/meu-endereco?voltar=mapa' },
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
