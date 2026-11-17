// pages/meu-endereco.js — endereço do cliente (usado no mapa de agricultores próximos).
//
//   GET   /auth/me            → { ..., endereco: { cep, logradouro, ..., latitude, longitude } }
//   PATCH /auth/me/endereco   → { endereco, geocodificado }

import { el, limpar, bannerErro, loading, toast } from '../ui.js';
import { authMe, atualizarMeuEndereco } from '../api.js';
import { getUser, setUser } from '../auth.js';
import { camposEndereco, textoLocalizacao, mascaraCep } from '../campos-endereco.js';

const CAMPOS = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];

export async function renderMeuEndereco({ outlet, query }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando endereço...'));

  let me;
  try {
    me = await authMe();
  } catch (err) {
    limpar(outlet);
    outlet.appendChild(bannerErro(err));
    return;
  }
  limpar(outlet);

  let estado = normalizar(me.endereco);
  const voltarParaMapa = query?.voltar === 'mapa';

  const form = el('form', { className: 'form form-perfil', attrs: { novalidate: true } });
  form.appendChild(el('h1', { text: 'Meu endereço' }));
  form.appendChild(el('p', {
    className: 'form-help',
    text: 'Usamos seu endereço para mostrar no mapa os agricultores mais próximos de você. Ele não aparece para outras pessoas.',
  }));

  const erroSlot = el('div');
  form.appendChild(erroSlot);

  const campos = camposEndereco({ inicial: estado, prefixo: 'me-end' });
  form.appendChild(campos.node);

  const footer = el('div', { className: 'form-acoes' });
  const submitBtn = el('button', { className: 'btn btn-primary', text: 'Salvar endereço', attrs: { type: 'submit' } });
  footer.appendChild(submitBtn);
  footer.appendChild(el('a', { className: 'btn btn-ghost', text: 'Ver mapa', attrs: { href: '#/mapa' } }));
  form.appendChild(footer);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erroSlot);
    const erro = campos.validar();
    if (erro) { erroSlot.appendChild(bannerErro(erro)); return; }

    const novo = campos.getValores();
    const patch = {};
    for (const c of CAMPOS) if (novo[c] !== estado[c]) patch[c] = novo[c] || null;
    const coords = campos.getCoordsManuais();
    if (coords) Object.assign(patch, coords);
    if (!Object.keys(patch).length) { toast('Nada a salvar', { tipo: 'info' }); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando...';
    try {
      const r = await atualizarMeuEndereco(patch);
      estado = normalizar(r.endereco);
      campos.limparCoordsManuais();
      campos.setStatusLocalizacao(textoLocalizacao(r.endereco, r.geocodificado));
      const u = getUser();
      if (u) setUser({ ...u, endereco: r.endereco });
      const achou = Number.isFinite(r.endereco?.latitude);
      toast(achou ? 'Endereço salvo' : 'Endereço salvo, mas sem localização no mapa', { tipo: achou ? 'success' : 'info' });
      if (achou && voltarParaMapa) location.hash = '#/mapa';
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Salvar endereço';
    }
  });

  outlet.appendChild(form);
}

function normalizar(e = {}) {
  const out = {};
  for (const c of CAMPOS) out[c] = e?.[c] ? String(e[c]) : '';
  out.cep = mascaraCep(out.cep);
  out.latitude = e?.latitude ?? null;
  out.longitude = e?.longitude ?? null;
  return out;
}
