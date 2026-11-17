/**
 * Endereços: validação, geocodificação (endereço → latitude/longitude) e distância.
 *
 * Geocodificação: Nominatim (OpenStreetMap) — gratuito, sem chave de API.
 * Regras de uso do Nominatim: no máximo 1 requisição por segundo e um User-Agent
 * identificando a aplicação. Por isso a chamada acontece no backend (o navegador
 * não deixa trocar o User-Agent) e passa por uma fila com intervalo mínimo.
 *
 * Variáveis opcionais (backend/.env):
 *   GEOCODER_URL         padrão https://nominatim.openstreetmap.org/search
 *   GEOCODER_USER_AGENT  padrão "RocaMarketplace/1.0 (projeto academico)"
 *   GEOCODER=off         desliga a geocodificação (testes offline)
 */
const { httpError } = require('../middleware/error');

const CAMPOS_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];
const LIMITES = { cep: 9, logradouro: 150, numero: 20, complemento: 80, bairro: 80, cidade: 80, estado: 2 };

/**
 * Valida e normaliza os campos de endereço presentes em `body`.
 * Devolve só os campos enviados (undefined = não mexer; null = apagar).
 */
function normalizarEndereco(body = {}) {
  const out = {};
  for (const campo of CAMPOS_ENDERECO) {
    if (body[campo] === undefined) continue;
    if (body[campo] === null) { out[campo] = null; continue; }
    let valor = String(body[campo]).trim();
    if (campo === 'estado') valor = valor.toUpperCase();
    if (campo === 'cep') {
      const digitos = valor.replace(/\D/g, '');
      if (digitos && digitos.length !== 8) throw httpError(400, 'VALIDATION', 'CEP deve ter 8 dígitos');
      valor = digitos ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : '';
    }
    if (campo === 'estado' && valor && !/^[A-Z]{2}$/.test(valor)) {
      throw httpError(400, 'VALIDATION', 'estado deve ter 2 letras (ex.: SP)');
    }
    if (valor.length > LIMITES[campo]) {
      throw httpError(400, 'VALIDATION', `${campo} deve ter até ${LIMITES[campo]} caracteres`);
    }
    out[campo] = valor || null;
  }
  return out;
}

/** Valida latitude/longitude opcionais do body. Devolve { latitude?, longitude? }. */
function normalizarCoordenadas(body = {}) {
  const out = {};
  if (body.latitude !== undefined) {
    if (body.latitude === null || body.latitude === '') out.latitude = null;
    else {
      const lat = Number(body.latitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw httpError(400, 'VALIDATION', 'latitude fora de range');
      out.latitude = lat;
    }
  }
  if (body.longitude !== undefined) {
    if (body.longitude === null || body.longitude === '') out.longitude = null;
    else {
      const lng = Number(body.longitude);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw httpError(400, 'VALIDATION', 'longitude fora de range');
      out.longitude = lng;
    }
  }
  return out;
}

// ---------------- Geocodificação ----------------

const cache = new Map();          // chave da consulta → { latitude, longitude } | null
let fila = Promise.resolve();     // serializa as chamadas (1 por segundo)
let ultimaChamada = 0;
const INTERVALO_MS = 1100;

function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function consultarNominatim(params) {
  const chave = JSON.stringify(params);
  if (cache.has(chave)) return cache.get(chave);

  const executar = async () => {
    const espera = ultimaChamada + INTERVALO_MS - Date.now();
    if (espera > 0) await esperar(espera);
    ultimaChamada = Date.now();

    const url = new URL(process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search');
    for (const [k, v] of Object.entries({ ...params, format: 'jsonv2', limit: 1, countrycodes: 'br' })) {
      if (v) url.searchParams.set(k, v);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': process.env.GEOCODER_USER_AGENT || 'RocaMarketplace/1.0 (projeto academico)',
          'Accept-Language': 'pt-BR',
        },
      });
      if (!res.ok) return undefined; // erro do serviço: não guarda no cache
      const lista = await res.json();
      const primeiro = Array.isArray(lista) ? lista[0] : null;
      const resultado = primeiro
        ? { latitude: Number(primeiro.lat), longitude: Number(primeiro.lon) }
        : null;
      cache.set(chave, resultado);
      return resultado;
    } catch {
      return undefined; // sem internet / timeout
    } finally {
      clearTimeout(timer);
    }
  };

  const promessa = fila.then(executar, executar);
  fila = promessa.catch(() => {});
  return promessa;
}

/**
 * Converte um endereço em { latitude, longitude, precisao }.
 * Tenta do mais preciso ao menos preciso: rua+número → CEP → bairro → cidade.
 * Devolve null se não achar (ou se o serviço estiver fora do ar).
 */
async function geocodificar(endereco = {}) {
  if (process.env.GEOCODER === 'off') return null;
  const { logradouro, numero, bairro, cidade, estado, cep } = endereco;
  if (!cidade && !cep) return null;

  const tentativas = [];
  if (logradouro && cidade) {
    tentativas.push({ precisao: 'rua', params: { street: [numero, logradouro].filter(Boolean).join(' '), city: cidade, state: estado, country: 'Brasil' } });
  }
  if (cep) tentativas.push({ precisao: 'cep', params: { postalcode: cep, country: 'Brasil' } });
  if (bairro && cidade) tentativas.push({ precisao: 'bairro', params: { q: [bairro, cidade, estado, 'Brasil'].filter(Boolean).join(', ') } });
  if (cidade) tentativas.push({ precisao: 'cidade', params: { city: cidade, state: estado, country: 'Brasil' } });

  for (const { precisao, params } of tentativas) {
    const r = await consultarNominatim(params);
    if (r && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) return { ...r, precisao };
  }
  return null;
}

/** Distância em km entre dois pontos (fórmula de Haversine). */
function distanciaKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function temCoordenadas(obj) {
  return obj && Number.isFinite(obj.latitude) && Number.isFinite(obj.longitude);
}

/**
 * Monta o $set de endereço para salvar no Mongo.
 * - `prefixo`: 'perfil.' (agricultor) ou 'endereco.' (cliente)
 * - `atual`: endereço já salvo (para mesclar e geocodificar o resultado final)
 * - se o body trouxe latitude/longitude, elas valem (ex.: "usar minha localização");
 *   senão, quando algum campo de endereço mudou, recalcula pelo Nominatim.
 * Devolve { updates, geocodificado: bool|null } (null = nada a geocodificar).
 */
async function prepararAtualizacaoEndereco(body, atual = {}, prefixo) {
  const campos = normalizarEndereco(body);
  const coords = normalizarCoordenadas(body);
  const updates = {};
  for (const [k, v] of Object.entries(campos)) updates[prefixo + k] = v;

  let geocodificado = null;
  const enderecoMudou = Object.keys(campos).some((k) => (atual?.[k] ?? null) !== campos[k]);

  if (coords.latitude !== undefined || coords.longitude !== undefined) {
    if (coords.latitude !== undefined) updates[prefixo + 'latitude'] = coords.latitude;
    if (coords.longitude !== undefined) updates[prefixo + 'longitude'] = coords.longitude;
    updates[prefixo + 'localizacao_fonte'] = 'manual';
  } else if (enderecoMudou) {
    const final = { ...(atual || {}), ...campos };
    const r = await geocodificar(final);
    geocodificado = Boolean(r);
    updates[prefixo + 'latitude'] = r ? r.latitude : null;
    updates[prefixo + 'longitude'] = r ? r.longitude : null;
    updates[prefixo + 'localizacao_fonte'] = r ? `endereco:${r.precisao}` : null;
  }
  return { updates, geocodificado };
}

module.exports = {
  CAMPOS_ENDERECO,
  normalizarEndereco,
  normalizarCoordenadas,
  geocodificar,
  distanciaKm,
  temCoordenadas,
  prepararAtualizacaoEndereco,
};
