import {
  el, limpar, bannerErro, formatarMoeda, loading, toast,
} from '../ui.js';
import { getPedido, getPagamentoPedido, simularPagamentoPedido } from '../api.js';
import { getUser } from '../auth.js';
import { navigate } from '../router.js';

const METODOS = [
  ['pix', 'PIX'],
  ['credit_card', 'Cartão de crédito'],
  ['debit_card', 'Cartão de débito'],
  ['cash', 'Dinheiro na retirada'],
];

export async function renderPagamento({ outlet, params }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando pagamento...'));

  const user = getUser();
  if (!user?.id) return;

  let pedido;
  let pagamento;
  try {
    pedido = await getPedido(params.id);
  } catch (error) {
    limpar(outlet);
    outlet.appendChild(bannerErro(error));
    return;
  }

  if (user.role !== 'cliente') {
    limpar(outlet);
    outlet.appendChild(bannerErro('Somente o cliente pode pagar este pedido.'));
    return;
  }
  if (!['confirmado', 'entregue'].includes(pedido.status)) {
    limpar(outlet);
    outlet.appendChild(bannerErro('O pagamento fica disponível após a confirmação do pedido.'));
    return;
  }

  try {
    const resposta = await getPagamentoPedido(pedido.id);
    pagamento = resposta?.pagamento || null;
  } catch (error) {
    limpar(outlet);
    outlet.appendChild(bannerErro(error));
    return;
  }

  limpar(outlet);
  const root = el('section', { className: 'pagamento-page' });
  outlet.appendChild(root);
  root.appendChild(el('a', {
    className: 'pagamento-voltar',
    text: '← Voltar ao pedido',
    attrs: { href: `#/pedidos/${pedido.id}` },
  }));
  root.appendChild(el('h1', { className: 'pagamento-titulo', text: `Pagamento do pedido #${pedido.id}` }));
  root.appendChild(renderResumo(pedido));

  if (pagamento?.status === 'aprovado') {
    root.appendChild(renderAprovado(pagamento));
    return;
  }

  root.appendChild(renderFormulario(pedido));
}

function renderResumo(pedido) {
  const resumo = el('section', {
    className: 'pagamento-resumo',
    attrs: { 'aria-label': 'Resumo do pedido' },
  });
  resumo.appendChild(el('span', { className: 'pagamento-resumo-label', text: 'Total do pedido' }));
  resumo.appendChild(el('strong', {
    className: 'pagamento-resumo-total',
    text: formatarMoeda(pedido.total),
  }));
  resumo.appendChild(el('span', {
    className: 'pagamento-resumo-ajuda',
    text: 'Simulação acadêmica: nenhum pagamento real será processado.',
  }));
  return resumo;
}

function renderFormulario(pedido) {
  const form = el('form', {
    className: 'pagamento-form pagamento-bloco',
    attrs: { novalidate: true },
  });
  form.appendChild(el('h2', { className: 'pagamento-bloco-titulo', text: 'Forma de pagamento' }));

  const erro = el('div');
  form.appendChild(erro);

  const metodoField = el('div', { className: 'form-field' });
  metodoField.appendChild(el('label', { text: 'Método', attrs: { for: 'pagamento-metodo' } }));
  const metodo = el('select', {
    attrs: { id: 'pagamento-metodo', required: true },
  });
  for (const [value, label] of METODOS) {
    metodo.appendChild(el('option', { text: label, attrs: { value } }));
  }
  metodoField.appendChild(metodo);
  form.appendChild(metodoField);

  const campos = el('div', { className: 'pagamento-campos' });
  form.appendChild(campos);

  const observacao = el('p', {
    className: 'pagamento-seguranca',
    text: 'Use somente dados fictícios. Número completo, validade e CVV ficam apenas no navegador e não são enviados nem salvos.',
  });
  form.appendChild(observacao);

  const confirmar = el('button', {
    className: 'btn btn-primary',
    text: 'Pagar e simular aprovação',
    attrs: { type: 'submit' },
  });
  form.appendChild(confirmar);

  function atualizarCampos() {
    limpar(campos);
    if (metodo.value === 'credit_card' || metodo.value === 'debit_card') {
      campos.appendChild(criarCampo('Nome no cartão', 'pagamento-nome', {
        type: 'text', autocomplete: 'cc-name', maxlength: 80,
      }));
      campos.appendChild(criarCampo('Número fictício do cartão', 'pagamento-numero', {
        type: 'text', inputmode: 'numeric', autocomplete: 'cc-number', maxlength: 19,
        placeholder: '1234 5678 9012 3456',
      }));
      const linha = el('div', { className: 'pagamento-cartao-linha' });
      linha.appendChild(criarCampo('Validade', 'pagamento-validade', {
        type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 5, placeholder: 'MM/AA',
      }));
      linha.appendChild(criarCampo('CVV fictício', 'pagamento-cvv', {
        type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 4,
      }));
      campos.appendChild(linha);
    } else if (metodo.value === 'pix') {
      campos.appendChild(el('p', {
        className: 'pagamento-metodo-ajuda',
        text: 'O PIX será aprovado imediatamente nesta demonstração. Nenhuma chave ou dado bancário é solicitado.',
      }));
    } else {
      campos.appendChild(el('p', {
        className: 'pagamento-metodo-ajuda',
        text: 'A retirada em dinheiro será marcada como aprovada apenas para demonstrar o fluxo do pedido.',
      }));
    }
  }

  metodo.addEventListener('change', atualizarCampos);
  atualizarCampos();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    limpar(erro);

    let cartao_ultimos4;
    if (metodo.value === 'credit_card' || metodo.value === 'debit_card') {
      const numero = document.getElementById('pagamento-numero').value.replace(/\D/g, '');
      const validade = document.getElementById('pagamento-validade').value.trim();
      const cvv = document.getElementById('pagamento-cvv').value.trim();
      const nome = document.getElementById('pagamento-nome').value.trim();
      if (!nome || numero.length < 12 || numero.length > 19 || !/^\d{2}\/\d{2}$/.test(validade) || !/^\d{3,4}$/.test(cvv)) {
        erro.appendChild(bannerErro('Preencha os dados fictícios do cartão no formato solicitado.'));
        return;
      }
      cartao_ultimos4 = numero.slice(-4);
    }

    confirmar.disabled = true;
    confirmar.textContent = 'Registrando pagamento...';
    try {
      await simularPagamentoPedido(pedido.id, {
        metodo: metodo.value,
        cartao_ultimos4,
      });
      toast('Pagamento aprovado', { tipo: 'success' });
      navigate(`#/pedidos/${pedido.id}/pagamento`);
    } catch (error) {
      erro.appendChild(bannerErro(error));
      confirmar.disabled = false;
      confirmar.textContent = 'Pagar e simular aprovação';
    }
  });

  return form;
}

function criarCampo(labelText, id, attrs) {
  const field = el('div', { className: 'form-field' });
  field.appendChild(el('label', { text: labelText, attrs: { for: id } }));
  field.appendChild(el('input', { attrs: { id, ...attrs } }));
  return field;
}

function renderAprovado(pagamento) {
  const bloco = el('section', { className: 'pagamento-aprovado', attrs: { role: 'status' } });
  bloco.appendChild(el('span', { className: 'pagamento-aprovado-icone', text: '✓' }));
  bloco.appendChild(el('h2', { text: 'Pagamento aprovado' }));
  bloco.appendChild(el('p', {
    text: `${nomeMetodo(pagamento.metodo)} · ${formatarMoeda(pagamento.valor)}`,
  }));
  if (pagamento.cartao_ultimos4) {
    bloco.appendChild(el('p', { text: `Cartão final ${pagamento.cartao_ultimos4}` }));
  }
  bloco.appendChild(el('p', {
    className: 'pagamento-transacao',
    text: `Transação simulada: ${pagamento.transacao_id}`,
  }));
  return bloco;
}

function nomeMetodo(metodo) {
  return METODOS.find(([value]) => value === metodo)?.[1] || 'Pagamento';
}