// campos-endereco.js — bloco de formulário de endereço reaproveitado pelo
// "Meu perfil" do agricultor e pelo "Meu endereço" do cliente.
//
//   const end = camposEndereco({ inicial: { cep, logradouro, ... , latitude, longitude } });
//   form.appendChild(end.node);
//   end.validar()        → mensagem de erro ou null
//   end.getValores()     → { cep, logradouro, numero, complemento, bairro, cidade, estado }
//   end.getCoordsManuais() → { latitude, longitude } se a pessoa clicou em
//                            "Usar minha localização atual"; senão null
//
// Ao completar o CEP, rua/bairro/cidade/UF são preenchidos pelo ViaCEP.
// Latitude/longitude não são digitadas: o backend calcula pelo endereço.

import { el } from './ui.js';
import { buscarCep } from './api.js';

const CAMPOS = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];

export function mascaraCep(s) {
  const d = String(s || '').replace(/\D/g, '').slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function enderecoEmTexto(e = {}) {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ');
  const cidade = [e.cidade, e.estado].filter(Boolean).join(' / ');
  return [rua, e.bairro, cidade].filter(Boolean).join(' — ');
}

export function camposEndereco({ inicial = {}, prefixo = 'end' } = {}) {
  const node = el('fieldset', { className: 'endereco-fieldset' });
  node.appendChild(el('legend', { text: 'Endereço' }));

  const inputs = {};
  function campo(nome, label, attrs = {}, className = '') {
    const id = `${prefixo}-${nome}`;
    const wrap = el('div', { className: `form-field ${className}`.trim() });
    wrap.appendChild(el('label', { text: label, attrs: { for: id } }));
    const input = el('input', { attrs: { id, name: id, type: 'text', ...attrs } });
    input.value = nome === 'cep' ? mascaraCep(inicial[nome]) : (inicial[nome] || '');
    wrap.appendChild(input);
    inputs[nome] = input;
    return wrap;
  }

  // CEP + status da busca
  const linhaCep = el('div', { className: 'form-linha-dupla' });
  const cepWrap = campo('cep', 'CEP', { placeholder: '00000-000', maxlength: 9, inputmode: 'numeric', autocomplete: 'postal-code' });
  const cepStatus = el('span', { className: 'form-help' });
  cepWrap.appendChild(cepStatus);
  linhaCep.appendChild(cepWrap);
  node.appendChild(linhaCep);

  const linhaRua = el('div', { className: 'form-linha-dupla' });
  linhaRua.appendChild(campo('logradouro', 'Rua / estrada', { autocomplete: 'address-line1', placeholder: 'Rua, avenida, estrada, sítio...' }, 'form-linha-flex'));
  linhaRua.appendChild(campo('numero', 'Número', { placeholder: 'S/N', maxlength: 20 }, 'endereco-numero'));
  node.appendChild(linhaRua);

  node.appendChild(campo('complemento', 'Complemento (opcional)', { placeholder: 'Km, lote, ponto de referência...' }));

  node.appendChild(campo('bairro', 'Bairro / comunidade'));

  const linhaCidade = el('div', { className: 'form-linha-dupla' });
  linhaCidade.appendChild(campo('cidade', 'Cidade', { autocomplete: 'address-level2' }, 'form-linha-flex'));
  linhaCidade.appendChild(campo('estado', 'UF', { maxlength: 2, placeholder: 'SP', style: 'text-transform:uppercase', autocomplete: 'address-level1' }, 'endereco-uf'));
  node.appendChild(linhaCidade);

  inputs.estado.addEventListener('input', () => {
    inputs.estado.value = inputs.estado.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  });

  // CEP: máscara + autopreenchimento quando completar 8 dígitos
  let ultimoCepBuscado = String(inicial.cep || '').replace(/\D/g, '');
  inputs.cep.addEventListener('input', async () => {
    inputs.cep.value = mascaraCep(inputs.cep.value);
    const digitos = inputs.cep.value.replace(/\D/g, '');
    if (digitos.length !== 8 || digitos === ultimoCepBuscado) return;
    ultimoCepBuscado = digitos;
    cepStatus.textContent = 'Buscando CEP...';
    try {
      const r = await buscarCep(digitos);
      if (!r) { cepStatus.textContent = 'CEP não encontrado. Preencha o endereço à mão.'; return; }
      for (const k of ['logradouro', 'bairro', 'cidade', 'estado']) {
        if (r[k]) inputs[k].value = r[k];
      }
      cepStatus.textContent = 'Endereço preenchido pelo CEP. Confira e informe o número.';
      inputs.numero.focus();
    } catch {
      cepStatus.textContent = 'Não consegui consultar o CEP agora. Preencha o endereço à mão.';
    }
  });

  // Localização no mapa
  let coordsManuais = null;
  const temCoords = Number.isFinite(inicial.latitude) && Number.isFinite(inicial.longitude);
  const geoBox = el('div', { className: 'endereco-geo' });
  const geoStatus = el('span', {
    className: 'form-help',
    text: temCoords
      ? 'Localização no mapa: encontrada. ✔'
      : 'Localização no mapa: ainda não definida. Ela é calculada pelo endereço quando você salva.',
  });
  const geoBtn = el('button', {
    className: 'btn btn-ghost btn-sm',
    text: '📍 Usar minha localização atual',
    attrs: { type: 'button' },
  });
  geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      geoStatus.textContent = 'Seu navegador não permite pegar a localização.';
      return;
    }
    geoStatus.textContent = 'Pegando sua localização...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coordsManuais = {
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        };
        geoStatus.textContent = 'Localização atual capturada. Clique em salvar para usar no mapa.';
      },
      () => { geoStatus.textContent = 'Não foi possível pegar sua localização (permissão negada?).'; },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
  geoBox.appendChild(geoStatus);
  geoBox.appendChild(el('span', {
    className: 'form-help',
    text: 'Dica: se o endereço for rural e o mapa não achar, use sua localização atual estando no local.',
  }));
  geoBox.appendChild(geoBtn);
  node.appendChild(geoBox);

  return {
    node,
    getValores() {
      const out = {};
      for (const k of CAMPOS) out[k] = inputs[k].value.trim();
      out.estado = out.estado.toUpperCase();
      return out;
    },
    getCoordsManuais() { return coordsManuais; },
    limparCoordsManuais() { coordsManuais = null; },
    setStatusLocalizacao(texto) { geoStatus.textContent = texto; },
    validar() {
      const v = this.getValores();
      if (v.cep && !/^\d{5}-\d{3}$/.test(v.cep)) return 'CEP inválido. Use o formato 00000-000.';
      if (v.estado && !/^[A-Z]{2}$/.test(v.estado)) return 'UF deve ter 2 letras (ex.: SP).';
      if ((v.logradouro || v.numero || v.bairro) && !v.cidade) return 'Informe a cidade do endereço.';
      return null;
    },
  };
}

/** Texto amigável sobre o resultado da geocodificação, depois de salvar. */
export function textoLocalizacao(endereco, geocodificado) {
  const tem = Number.isFinite(endereco?.latitude) && Number.isFinite(endereco?.longitude);
  if (geocodificado === false || !tem) {
    return 'Endereço salvo, mas não achamos esse local no mapa. Confira cidade/UF ou use "Usar minha localização atual".';
  }
  return 'Localização no mapa: encontrada. ✔';
}
