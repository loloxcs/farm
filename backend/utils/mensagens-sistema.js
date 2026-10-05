/**
 * Mensagens automáticas do chat (tipo = 'sistema').
 *
 * Cada etapa do pedido/pagamento publica uma mensagem na conversa entre
 * cliente e agricultor. A mensagem leva:
 *   - `conteudo`: texto pronto (usado na prévia da lista de conversas e como fallback)
 *   - `evento`:   dados estruturados para o front desenhar o cartão e os botões
 */
const { nextId } = require('../db/mongodb');
const { rotuloMetodo } = require('./pagamentos');

const FUSO = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataHora(iso) {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' às');
}

/** "Entrega em 10/10/2026 às 09:00 — Rua X, 12" / "Retirada — a combinar". */
function resumoEntrega(pedido) {
  const tipo = pedido.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada';
  const quando = dataHora(pedido.data_retirada);
  const partes = [quando ? `${tipo} em ${quando}` : `${tipo} com data a combinar`];
  if (pedido.local_entrega) partes.push(pedido.local_entrega);
  return partes.join(' — ');
}

/** Frase "o que acontece agora" depois que o pagamento está resolvido. */
function fraseProximoPasso(pedido) {
  const quando = dataHora(pedido.data_retirada);
  const local = pedido.local_entrega;
  if (pedido.tipo_entrega === 'entrega') {
    if (!quando && !local) return 'O pedido será entregue — combinem data e endereço por aqui.';
    return `O pedido será entregue${quando ? ` em ${quando}` : ''}${local ? `, no endereço: ${local}` : ''}.`;
  }
  if (!quando && !local) return 'O pedido estará disponível para retirada — combinem data e local por aqui.';
  return `O pedido estará disponível para retirada${quando ? ` em ${quando}` : ''}${local ? `, em: ${local}` : ''}.`;
}

/** "Pagamento escolhido pelo cliente: PIX" / "... o cliente escolhe ao pagar". */
function frasePagamento(pedido) {
  return pedido.forma_pagamento?.nome
    ? `Pagamento escolhido pelo cliente: ${pedido.forma_pagamento.nome}`
    : 'Forma de pagamento: o cliente escolhe ao pagar';
}

function textoDoEvento(tipo, { pedido, pagamento, atorNome, motivo }) {
  const numero = `#${pedido.id}`;
  const valor = moeda(pagamento?.valor ?? pedido.total);
  const metodo = rotuloMetodo(pagamento?.metodo);
  const ondePaga = pedido.tipo_entrega === 'entrega' ? 'na entrega' : 'na retirada';
  switch (tipo) {
    case 'pedido_criado':
      return `Pedido ${numero} gerado a partir do carrinho · ${moeda(pedido.total)} · ${resumoEntrega(pedido)} · `
        + `${frasePagamento(pedido)}.`;
    case 'pedido_confirmado':
      return `Pedido ${numero} confirmado por ${atorNome}. ${resumoEntrega(pedido)}. `
        + `${frasePagamento(pedido)} — o cliente já pode pagar.`;
    case 'pagamento_informado':
      return `${atorNome} informou o pagamento de ${valor} via ${metodo} (pedido ${numero}). `
        + 'Aguardando o agricultor confirmar o recebimento.';
    case 'pagamento_na_entrega':
      return `${atorNome} vai pagar ${valor} em dinheiro ${ondePaga} (pedido ${numero}). ${fraseProximoPasso(pedido)}`;
    case 'pagamento_confirmado':
      return `Pagamento de ${valor} confirmado (${metodo}) — pedido ${numero}. `
        + (pedido.status === 'entregue' ? 'Pedido já entregue.' : fraseProximoPasso(pedido));
    case 'pagamento_recusado':
      return `${atorNome} não localizou o pagamento de ${valor} via ${metodo} (pedido ${numero}).`
        + `${motivo ? ` Motivo: ${motivo}.` : ''} O cliente pode conferir e informar o pagamento novamente.`;
    case 'pedido_entregue':
      return `Pedido ${numero} ${pedido.tipo_entrega === 'entrega' ? 'entregue ao cliente' : 'retirado pelo cliente'}.`
        + (pagamento?.status === 'aprovado' ? ' Pagamento recebido.' : ' Pagamento ainda não confirmado.');
    case 'pedido_cancelado':
      return `Pedido ${numero} cancelado por ${atorNome}.`
        + (pagamento?.devolucao_pendente
          ? ` Havia um pagamento confirmado de ${valor} — combinem a devolução por aqui.` : '');
    default:
      return `Atualização do pedido ${numero}.`;
  }
}

/**
 * Publica um evento na conversa do pedido. Nunca derruba a operação
 * principal: se falhar, apenas registra no log.
 */
async function publicarEvento(db, tipo, { pedido, pagamento = null, ator, motivo = null }) {
  try {
    let conversaId = pedido.conversa_id;
    if (!conversaId) {
      const conversa = await db.collection('conversas').findOne({
        cliente_id: pedido.cliente_id, agricultor_id: pedido.agricultor_id,
      });
      conversaId = conversa?.id;
    }
    if (!conversaId) return null;

    const usuario = await db.collection('usuarios').findOne({ id: ator.id }, { projection: { nome: 1 } });
    const atorNome = usuario?.nome || (ator.role === 'agricultor' ? 'O agricultor' : 'O cliente');
    const id = await nextId('mensagens');
    const agora = new Date().toISOString();
    const mensagem = {
      _id: id,
      id,
      conversa_id: conversaId,
      remetente_id: ator.id,
      tipo: 'sistema',
      conteudo: textoDoEvento(tipo, { pedido, pagamento, atorNome, motivo }),
      snapshot_json: null,
      carrinho_id: null,
      evento: {
        tipo,
        pedido_id: pedido.id,
        pedido_status: pedido.status,
        total: pedido.total,
        tipo_entrega: pedido.tipo_entrega || 'retirada',
        data_retirada: pedido.data_retirada || null,
        local_entrega: pedido.local_entrega || null,
        forma_combinada: pedido.forma_pagamento?.nome || null,
        metodo: pagamento?.metodo || null,
        metodo_rotulo: pagamento ? rotuloMetodo(pagamento.metodo) : null,
        valor: pagamento?.valor ?? pedido.total,
        pagamento_status: pagamento?.status || null,
        devolucao_pendente: Boolean(pagamento?.devolucao_pendente),
        motivo: motivo || null,
        ator_id: ator.id,
        ator_nome: atorNome,
        ator_role: ator.role,
      },
      created_at: agora,
    };
    await Promise.all([
      db.collection('mensagens').insertOne(mensagem),
      db.collection('conversas').updateOne({ id: conversaId }, { $set: { updated_at: agora } }),
    ]);
    return mensagem;
  } catch (error) {
    console.error(`[chat] não foi possível publicar "${tipo}" do pedido ${pedido?.id}:`, error);
    return null;
  }
}

module.exports = { publicarEvento, textoDoEvento, resumoEntrega, fraseProximoPasso };
