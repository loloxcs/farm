// pages/meu-perfil.js — RF03 (edição) — Fase C
//
// Tela "perfil + edição" em uma única view, com um único formulário.
// Carrega em paralelo:
//   GET /auth/me                → { id, nome, email, role, telefone }
//   GET /agricultores/:id       → { nome, telefone, perfil: { ... } }
//   GET /agricultores/me/pagamento → { formas_aceitas, chave_pix, metodos_disponiveis }
//                                 (chave PIX é privada; não vem no perfil público)
//
// Submit: monta um PATCH só com os campos que mudaram em relação ao estado inicial.
// Se o `nome` mudar, atualiza também o getUser() no localStorage e dispara
// 'auth:changed' para o header global refletir.

import {
  el, limpar, bannerErro, criarAvatar, renderEstrelas,
  loading, toast, campoUploadFoto,
} from '../ui.js';
import {
  authMe, getAgricultor, atualizarMeuPerfilAgricultor, getMeuRecebimento,
} from '../api.js';
import { getUser, setUser } from '../auth.js';
import { navigate } from '../router.js';
import { camposEndereco, textoLocalizacao, mascaraCep } from '../campos-endereco.js';

const DESC_MAX = 600;
const CAMPOS_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];
const CHAVE_PIX_MAX = 140;

// Usado se o backend não devolver a lista (mantém a tela funcionando).
const METODOS_PADRAO = [
  { id: 'pix', rotulo: 'PIX' },
  { id: 'transfer', rotulo: 'Transferência bancária' },
  { id: 'cash', rotulo: 'Dinheiro' },
  { id: 'credit_card', rotulo: 'Cartão de crédito' },
  { id: 'debit_card', rotulo: 'Cartão de débito' },
];
const DICA_METODO = {
  pix: 'Cliente paga na sua chave; você confirma o recebimento.',
  transfer: 'Você passa os dados bancários pelo chat e confirma quando cair.',
  cash: 'Pago em mãos na entrega ou retirada.',
  credit_card: 'Simulado nesta versão — aprovado na hora.',
  debit_card: 'Simulado nesta versão — aprovado na hora.',
};

export async function renderMeuPerfil({ outlet }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando perfil...'));

  const user = getUser();
  if (!user?.id) {
    // exigirRole já deveria ter barrado, mas vamos ser defensivos
    navigate('#/login');
    return;
  }

  let me, agricultor, recebimento;
  try {
    [me, agricultor, recebimento] = await Promise.all([
      authMe(),
      getAgricultor(user.id),
      getMeuRecebimento(),
    ]);
  } catch (err) {
    limpar(outlet);
    outlet.appendChild(bannerErro(err));
    return;
  }

  limpar(outlet);

  const perfil = agricultor?.perfil || {};

  // Estado inicial — usado pra calcular o diff no submit.
  // null/undefined viram '' nos campos texto e null nos numéricos pra simplificar.
  // CEP é normalizado pra forma mascarada pra o diff bater com o que o input mostra.
  const estadoInicial = {
    nome: me.nome || agricultor.nome || '',
    telefone: me.telefone || agricultor.telefone || '',
    descricao: perfil.descricao || '',
    endereco: enderecoInicial(me.endereco || perfil),
    foto_id: perfil.foto_id || null,
    chave_pix: recebimento?.chave_pix || '',
    formas_aceitas: [...(recebimento?.formas_aceitas || METODOS_PADRAO.map((m) => m.id))],
  };
  const metodosDisponiveis = recebimento?.metodos_disponiveis?.length
    ? recebimento.metodos_disponiveis
    : METODOS_PADRAO;

  // Header com avatar grande + nome + nota
  outlet.appendChild(renderHeader(estadoInicial, perfil));

  // Form
  outlet.appendChild(renderForm(estadoInicial, metodosDisponiveis));
}

function renderHeader(estado, perfil) {
  const wrap = el('div', { className: 'profile-header meu-perfil-header' });
  wrap.appendChild(criarAvatar(estado.nome, estado.foto_id, 96));

  const info = el('div', { className: 'profile-info' });
  info.appendChild(el('h1', {
    className: 'profile-nome',
    text: estado.nome || 'Meu perfil',
  }));
  info.appendChild(renderEstrelas(perfil.media_avaliacoes, perfil.total_avaliacoes));
  wrap.appendChild(info);
  return wrap;
}

function renderForm(estadoInicial, metodosDisponiveis) {
  // Cópia mutável que vai sendo "rebatizada" como novo inicial após cada save
  // bem-sucedido (assim o próximo submit só envia o que mudar de novo).
  let estado = { ...estadoInicial };

  const form = el('form', { className: 'form form-perfil', attrs: { novalidate: true } });
  form.appendChild(el('h2', { text: 'Editar meu perfil' }));

  const erroSlot = el('div');
  form.appendChild(erroSlot);

  // Upload de foto — usa o componente reusável de ui.js
  const upload = campoUploadFoto({
    fotoIdInicial: estado.foto_id,
    label: 'Foto de perfil',
  });
  form.appendChild(upload.node);

  // Nome
  const nomeField = campoTexto({
    id: 'mp-nome', label: 'Nome', type: 'text',
    value: estado.nome, required: true, autocomplete: 'name',
  });
  form.appendChild(nomeField.node);

  // Telefone
  const telField = campoTexto({
    id: 'mp-telefone', label: 'Telefone', type: 'tel',
    value: estado.telefone, autocomplete: 'tel',
  });
  form.appendChild(telField.node);

  // Descrição — textarea com contador
  const descWrap = el('div', { className: 'form-field' });
  descWrap.appendChild(el('label', { text: 'Descrição', attrs: { for: 'mp-descricao' } }));
  const descTextarea = el('textarea', {
    attrs: {
      id: 'mp-descricao',
      maxlength: DESC_MAX,
      rows: 4,
      placeholder: 'Conte um pouco sobre sua produção, métodos e diferenciais...',
    },
  });
  descTextarea.value = estado.descricao;
  descWrap.appendChild(descTextarea);
  const descContador = el('span', { className: 'form-help form-contador' });
  descWrap.appendChild(descContador);
  function atualizarContador() {
    descContador.textContent = `${descTextarea.value.length} / ${DESC_MAX}`;
  }
  atualizarContador();
  descTextarea.addEventListener('input', atualizarContador);
  form.appendChild(descWrap);

  // Endereço completo (CEP preenche o resto). Latitude/longitude são
  // calculadas pelo backend a partir do endereço.
  const enderecoCampos = camposEndereco({ inicial: estado.endereco, prefixo: 'mp-end' });
  form.appendChild(enderecoCampos.node);

  // ---------- Recebimento de pagamentos ----------
  form.appendChild(el('h2', { className: 'form-secao-titulo', text: 'Como você recebe' }));
  form.appendChild(el('p', {
    className: 'form-help',
    text: 'O cliente paga direto para você. Marque as formas que aceita — elas aparecem para ele na hora de pagar um pedido confirmado.',
  }));

  const formasWrap = el('div', { className: 'formas-aceitas', attrs: { role: 'group', 'aria-label': 'Formas de pagamento aceitas' } });
  const formasChecks = [];
  for (const metodo of metodosDisponiveis) {
    const id = `mp-forma-${metodo.id}`;
    const input = el('input', { attrs: { type: 'checkbox', id, value: metodo.id } });
    input.checked = estado.formas_aceitas.includes(metodo.id);
    const label = el('label', { className: 'forma-aceita', attrs: { for: id } });
    label.appendChild(input);
    const textos = el('span', { className: 'forma-aceita-textos' });
    textos.appendChild(el('span', { className: 'forma-aceita-nome', text: metodo.rotulo }));
    textos.appendChild(el('span', { className: 'form-help', text: DICA_METODO[metodo.id] || '' }));
    label.appendChild(textos);
    formasChecks.push(input);
    formasWrap.appendChild(label);
  }
  form.appendChild(formasWrap);

  const pixField = campoTexto({
    id: 'mp-chave-pix', label: 'Chave PIX', type: 'text', value: estado.chave_pix,
    extraAttrs: { maxlength: CHAVE_PIX_MAX, placeholder: 'CPF, e-mail, celular ou chave aleatória', autocomplete: 'off' },
  });
  pixField.node.appendChild(el('span', {
    className: 'form-help',
    text: 'Não aparece no seu perfil público: só é mostrada ao cliente depois que você confirma um pedido dele.',
  }));
  // Aviso não bloqueante: aceitar PIX sem chave funciona, mas o cliente vai ter que pedir pelo chat.
  const pixAviso = el('span', { className: 'form-help form-aviso' });
  pixField.node.appendChild(pixAviso);
  function atualizarAvisoPix() {
    const aceitaPix = formasChecks.some((c) => c.value === 'pix' && c.checked);
    pixAviso.textContent = aceitaPix && !pixField.input.value.trim()
      ? 'Você aceita PIX mas ainda não informou a chave — o cliente terá que pedir pelo chat.'
      : '';
  }
  pixField.input.addEventListener('input', atualizarAvisoPix);
  formasChecks.forEach((c) => c.addEventListener('change', atualizarAvisoPix));
  atualizarAvisoPix();
  form.appendChild(pixField.node);

  // Footer com botões
  const footer = el('div', { className: 'form-acoes' });
  const submitBtn = el('button', {
    className: 'btn btn-primary',
    text: 'Salvar alterações',
    attrs: { type: 'submit' },
  });
  const voltarBtn = el('a', {
    className: 'btn btn-ghost',
    text: 'Voltar ao painel',
    attrs: { href: '#/meus-produtos' },
  });
  footer.appendChild(submitBtn);
  footer.appendChild(voltarBtn);
  form.appendChild(footer);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpar(erroSlot);

    // Coleta dos valores atuais do form
    const novo = {
      nome: nomeField.input.value.trim(),
      telefone: telField.input.value.trim(),
      descricao: descTextarea.value.trim(),
      endereco: enderecoCampos.getValores(),
      chave_pix: pixField.input.value.trim(),
      formas_aceitas: formasChecks.filter((c) => c.checked).map((c) => c.value),
    };

    // Validações
    if (!novo.nome) {
      erroSlot.appendChild(bannerErro('Informe seu nome.'));
      return;
    }
    const erroEndereco = enderecoCampos.validar();
    if (erroEndereco) {
      erroSlot.appendChild(bannerErro(erroEndereco));
      return;
    }
    if (novo.formas_aceitas.length === 0) {
      erroSlot.appendChild(bannerErro('Marque ao menos uma forma de pagamento que você aceita.'));
      return;
    }
    if (novo.descricao.length > DESC_MAX) {
      erroSlot.appendChild(bannerErro(`Descrição não pode passar de ${DESC_MAX} caracteres.`));
      return;
    }

    // Lê a foto (se houver nova)
    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando...';
    let fotoPayload;
    try {
      fotoPayload = await upload.getValue(); // { foto_base64, foto_mime } | null
    } catch (err) {
      erroSlot.appendChild(bannerErro('Não foi possível ler o arquivo de foto: ' + (err?.message || 'erro desconhecido')));
      submitBtn.disabled = false;
      submitBtn.textContent = 'Salvar alterações';
      return;
    }

    // Diff: só envia o que mudou
    const patch = {};
    if (novo.nome !== estado.nome) patch.nome = novo.nome;
    if (novo.telefone !== estado.telefone) patch.telefone = novo.telefone || null;
    if (novo.descricao !== estado.descricao) patch.descricao = novo.descricao || null;
    for (const campo of CAMPOS_ENDERECO) {
      if (novo.endereco[campo] !== estado.endereco[campo]) patch[campo] = novo.endereco[campo] || null;
    }
    const coordsManuais = enderecoCampos.getCoordsManuais();
    if (coordsManuais) Object.assign(patch, coordsManuais);
    if (novo.chave_pix !== estado.chave_pix) patch.chave_pix = novo.chave_pix || null;
    if (novo.formas_aceitas.join() !== estado.formas_aceitas.join()) patch.formas_aceitas = novo.formas_aceitas;
    if (fotoPayload) {
      patch.foto_base64 = fotoPayload.foto_base64;
      patch.foto_mime = fotoPayload.foto_mime;
    }

    if (Object.keys(patch).length === 0) {
      toast('Nada a salvar', { tipo: 'info' });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Salvar alterações';
      return;
    }

    try {
      const atualizado = await atualizarMeuPerfilAgricultor(patch);

      // Atualiza usuário em localStorage se o nome mudou — header global escuta auth:changed
      if (patch.nome !== undefined) {
        const u = getUser();
        if (u) {
          setUser({ ...u, nome: patch.nome });
          window.dispatchEvent(new Event('auth:changed'));
        }
      }

      // Rebatiza o "estado inicial" pro próximo diff. O backend devolve o perfil
      // completo; preferimos seus valores quando disponíveis, com fallback no que
      // enviamos.
      const perfilAt = atualizado?.perfil || {};
      estado = {
        nome: atualizado?.nome ?? novo.nome,
        telefone: atualizado?.telefone ?? novo.telefone,
        descricao: perfilAt.descricao ?? novo.descricao,
        endereco: atualizado?.endereco ? enderecoInicial(atualizado.endereco) : novo.endereco,
        foto_id: perfilAt.foto_id ?? estado.foto_id,
        chave_pix: atualizado?.recebimento?.chave_pix ?? novo.chave_pix,
        formas_aceitas: atualizado?.recebimento?.formas_aceitas ?? novo.formas_aceitas,
      };

      enderecoCampos.limparCoordsManuais();
      if (atualizado?.endereco) {
        enderecoCampos.setStatusLocalizacao(textoLocalizacao(atualizado.endereco, atualizado.geocodificado));
      }
      toast('Perfil atualizado', { tipo: 'success' });

      // Se a foto mudou, re-renderiza a página inteira pra atualizar avatar do header
      // local e do componente de upload (que cacheava a foto_id anterior).
      if (fotoPayload) {
        navigate('#/meu-perfil');
        return;
      }
    } catch (err) {
      erroSlot.appendChild(bannerErro(err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Salvar alterações';
    }
  });

  return form;
}

// ---------------------------------------------------------------
// Helpers locais
// ---------------------------------------------------------------

/** Pequeno builder pra campo texto com label + input. Retorna { node, input }. */
function campoTexto({ id, label, type = 'text', value = '', required = false, autocomplete, extraAttrs = {} }) {
  const node = el('div', { className: 'form-field' });
  node.appendChild(el('label', { text: label, attrs: { for: id } }));
  const attrs = { id, name: id, type, ...extraAttrs };
  if (required) attrs.required = true;
  if (autocomplete) attrs.autocomplete = autocomplete;
  const input = el('input', { attrs });
  // value via prop (não atributo) pra suportar number vazio etc.
  input.value = value;
  node.appendChild(input);
  return { node, input };
}

/** Endereço vindo do backend → valores como aparecem no formulário ('' em vez de null). */
function enderecoInicial(e = {}) {
  const out = {};
  for (const campo of CAMPOS_ENDERECO) out[campo] = e?.[campo] ? String(e[campo]) : '';
  out.cep = mascaraCep(out.cep);
  out.latitude = e?.latitude ?? null;
  out.longitude = e?.longitude ?? null;
  return out;
}
