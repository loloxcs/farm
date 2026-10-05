/**
 * Teste automático do sistema inteiro contra o MongoDB DE VERDADE.
 *
 * Sobe a API numa porta livre e percorre o fluxo completo — cadastro, login,
 * perfil, produto com foto, estoque, carrinho, chat, pedido, pagamento,
 * entrega, avaliação e cancelamento — conferindo o que ficou gravado.
 *
 * Usa um banco TEMPORÁRIO (farm_teste_<número>) no mesmo cluster e o apaga
 * no final. O banco real ("farm") não é lido nem alterado.
 *
 * Uso: npm run test:fluxo
 */
require('dotenv').config();

const BANCO_TESTE = `farm_teste_${Date.now()}`;
process.env.MONGO_DB = BANCO_TESTE;
process.env.LOG_HTTP = 'off';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'segredo-apenas-para-o-teste';

const { app } = require('../server');
const {
  initializeMongo, getMongoDb, getMongoClient, closeMongo, resumoDoBanco, uriSemSenha, explicarErroMongo,
} = require('../db/mongodb');

const NOME_DE_TESTE = /^farm_teste_\d{13}$/;

/**
 * Apaga um banco temporário deste teste. Trava de segurança: só age em nomes
 * farm_teste_<13 dígitos>, que só este script cria.
 * Usuários comuns do Atlas ("read and write") não têm permissão de dropDatabase,
 * mas podem apagar coleção por coleção — e o banco some quando fica vazio.
 */
async function apagarBancoDeTeste(db) {
  if (!NOME_DE_TESTE.test(db.databaseName)) return;
  try {
    await db.dropDatabase();
  } catch {
    const colecoes = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of colecoes) await db.collection(name).drop();
  }
}

/** Remove bancos temporários deixados por execuções anteriores que não conseguiram limpar. */
async function limparSobras() {
  try {
    const client = await getMongoClient();
    const { databases } = await client.db('admin').command({ listDatabases: 1, nameOnly: true });
    for (const { name } of databases) {
      if (name === BANCO_TESTE || !NOME_DE_TESTE.test(name)) continue;
      await apagarBancoDeTeste(client.db(name));
      console.log(`Sobra de um teste anterior removida: ${name}`);
    }
  } catch { /* sem permissão para listar bancos: segue sem limpar sobras */ }
}

// PNG 1×1 transparente
const FOTO = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let base;
let total = 0;
let falhas = 0;

function confere(nome, condicao, detalhe) {
  total += 1;
  if (condicao) { console.log(`  ok     ${nome}`); return; }
  falhas += 1;
  console.log(`  FALHOU ${nome}`);
  if (detalhe !== undefined) console.log(`         ${JSON.stringify(detalhe).slice(0, 400)}`);
}

async function api(metodo, caminho, { token, body } = {}) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tipo = resposta.headers.get('content-type') || '';
  const dados = tipo.includes('json') ? await resposta.json() : Buffer.from(await resposta.arrayBuffer());
  return { status: resposta.status, dados, tipo };
}

async function fluxo() {
  const db = await getMongoDb();
  const conta = (colecao, filtro = {}) => db.collection(colecao).countDocuments(filtro);

  console.log('\nCadastro e login');
  let r = await api('POST', '/auth/register', { body: { nome: 'Ana Agricultora', email: 'ana@teste.com', senha: 'segredo1', role: 'agricultor', telefone: '11999990000' } });
  confere('cadastro de agricultor', r.status === 201 && r.dados.token, r);
  const ag = r.dados;
  r = await api('POST', '/auth/register', { body: { nome: 'Caio Cliente', email: 'caio@teste.com', senha: 'segredo2', role: 'cliente' } });
  confere('cadastro de cliente', r.status === 201 && r.dados.token, r);
  const cl = r.dados;
  r = await api('POST', '/auth/register', { body: { nome: 'Outro', email: 'caio@teste.com', senha: 'segredo3', role: 'cliente' } });
  confere('e-mail repetido é recusado (409)', r.status === 409, r);
  r = await api('POST', '/auth/login', { body: { email: 'caio@teste.com', senha: 'segredo2' } });
  confere('login com a senha certa', r.status === 200 && r.dados.token, r);
  r = await api('POST', '/auth/login', { body: { email: 'caio@teste.com', senha: 'errada' } });
  confere('login com senha errada é recusado (401)', r.status === 401, r);
  r = await api('GET', '/auth/me', { token: cl.token });
  confere('sessão reconhece o usuário', r.status === 200 && r.dados.nome === 'Caio Cliente', r);
  const usuarioSalvo = await db.collection('usuarios').findOne({ email: 'ana@teste.com' });
  confere('usuário gravado no MongoDB com senha criptografada', usuarioSalvo && usuarioSalvo.senha_hash && usuarioSalvo.senha_hash !== 'segredo1' && usuarioSalvo.perfil, usuarioSalvo && Object.keys(usuarioSalvo));

  console.log('\nPerfil do agricultor, produtos, foto e estoque');
  r = await api('PATCH', '/agricultores/me', { token: ag.token, body: { cidade: 'Jundiaí', estado: 'SP', descricao: 'Horta orgânica', chave_pix: 'ana@teste.com', foto_base64: FOTO, foto_mime: 'image/png' } });
  confere('perfil atualizado (cidade, PIX, foto)', r.status === 200 && r.dados.perfil.cidade === 'Jundiaí' && r.dados.perfil.foto_id, r);
  const fotoId = r.dados.perfil?.foto_id;
  r = await api('GET', `/imagens/${fotoId}`);
  confere('foto volta do banco como imagem', r.status === 200 && r.tipo.includes('image/png') && r.dados.length === Buffer.from(FOTO, 'base64').length, { status: r.status, tipo: r.tipo });
  r = await api('GET', '/categorias');
  confere('8 categorias cadastradas', r.status === 200 && r.dados.length === 8, r);
  r = await api('GET', '/formas-pagamento', { token: ag.token });
  confere('5 formas de pagamento cadastradas', r.status === 200 && r.dados.length === 5, r);
  r = await api('POST', '/produtos', { token: ag.token, body: { nome: 'Tomate', preco: 7.5, unidade: 'kg', categoria_id: 3, estoque: 10, foto_base64: FOTO, foto_mime: 'image/png' } });
  confere('produto criado com estoque 10', r.status === 201 && r.dados.estoque === 10 && r.dados.categoria?.nome, r);
  const tomate = r.dados;
  r = await api('PATCH', `/produtos/${tomate.id}`, { token: ag.token, body: { preco: 8, estoque: 12 } });
  confere('produto editado (preço 8, estoque 12)', r.status === 200 && r.dados.preco === 8 && r.dados.estoque === 12, r);
  r = await api('POST', '/produtos', { token: ag.token, body: { nome: 'Alface', preco: 3, unidade: 'un', categoria_id: 2, estoque: 5 } });
  const alface = r.dados;
  r = await api('DELETE', `/produtos/${alface.id}`, { token: ag.token });
  r = await api('GET', `/agricultores/${ag.usuario.id}/produtos`);
  confere('produto removido some da vitrine', r.status === 200 && r.dados.total === 1 && r.dados.items[0].nome === 'Tomate', r);
  r = await api('GET', '/agricultores?q=ana');
  confere('busca de agricultores encontra pelo nome', r.status === 200 && r.dados.items.some((item) => item.id === ag.usuario.id), r);

  console.log('\nCarrinho, chat e pedido');
  r = await api('POST', `/carrinho/${ag.usuario.id}/itens`, { token: cl.token, body: { produto_id: tomate.id, quantidade: 2 } });
  r = await api('POST', `/carrinho/${ag.usuario.id}/itens`, { token: cl.token, body: { produto_id: tomate.id, quantidade: 1 } });
  confere('carrinho soma quantidades (3 × R$ 8 = 24)', r.status === 200 && r.dados.itens.length === 1 && r.dados.total === 24, r);
  r = await api('POST', `/conversas/com/${ag.usuario.id}/mensagens`, { token: cl.token, body: { conteudo: 'Olá, tem tomate?' } });
  confere('mensagem de texto enviada', r.status === 201 && r.dados.conversa_id, r);
  const conversaId = r.dados.conversa_id;
  r = await api('POST', `/conversas/com/${ag.usuario.id}/snapshot`, { token: cl.token, body: { metodo_pagamento: 'bitcoin' } });
  confere('forma de pagamento inválida no carrinho é recusada', r.status === 400, r);
  r = await api('POST', `/conversas/com/${ag.usuario.id}/snapshot`, { token: cl.token, body: { metodo_pagamento: 'pix' } });
  confere('carrinho enviado pelo chat com a forma escolhida pelo cliente (PIX)', r.status === 201 && r.dados.mensagem.snapshot_json.total === 24 && r.dados.mensagem.snapshot_json.pagamento?.metodo === 'pix', r);
  const snapshotId = r.dados.mensagem.id;
  // o agricultor até tenta mandar outra forma: quem decide é o cliente
  r = await api('POST', '/pedidos', { token: ag.token, body: { mensagem_snapshot_id: snapshotId, forma_pagamento_id: 1, tipo_entrega: 'entrega', local_entrega: 'Rua A, 1' } });
  confere('pedido gerado (transação)', r.status === 201 && r.dados.total === 24 && r.dados.status === 'pendente', r);
  confere('pedido fica com a forma do cliente, não a do agricultor', r.dados.forma_pagamento?.nome === 'PIX' && r.dados.metodo_combinado === 'pix', r.dados?.forma_pagamento);
  const pedido = r.dados;
  let produtoSalvo = await db.collection('produtos').findOne({ id: tomate.id });
  confere('estoque baixou de 12 para 9 no MongoDB', produtoSalvo.estoque === 9, produtoSalvo.estoque);
  r = await api('POST', '/pedidos', { token: ag.token, body: { mensagem_snapshot_id: snapshotId } });
  confere('mesmo carrinho não gera dois pedidos', r.status === 400 && (await conta('pedidos')) === 1, r);

  console.log('\nPagamento, entrega e avaliação');
  r = await api('PATCH', `/pedidos/${pedido.id}/status`, { token: ag.token, body: { status: 'confirmado' } });
  confere('agricultor confirma o pedido', r.status === 200 && r.dados.status === 'confirmado', r);
  r = await api('POST', `/pedidos/${pedido.id}/pagamento`, { token: cl.token, body: { metodo: 'pix' } });
  confere('cliente informa o PIX', r.status === 201 && r.dados.pagamento.status === 'aguardando_confirmacao', r);
  r = await api('PATCH', `/pedidos/${pedido.id}/pagamento`, { token: ag.token, body: { acao: 'confirmar' } });
  confere('agricultor confirma o recebimento', r.status === 200 && r.dados.pagamento.status === 'aprovado', r);
  r = await api('PATCH', `/pedidos/${pedido.id}/status`, { token: ag.token, body: { status: 'entregue' } });
  confere('pedido marcado como entregue', r.status === 200 && r.dados.status === 'entregue' && r.dados.pagamento?.status === 'aprovado', r);
  r = await api('GET', `/conversas/${conversaId}/mensagens`, { token: cl.token });
  const tipos = (r.dados.mensagens || []).map((m) => m.evento?.tipo || m.tipo);
  confere('chat guardou a conversa e as 5 confirmações', r.status === 200 && tipos.join() === 'texto,snapshot,pedido_criado,pedido_confirmado,pagamento_informado,pagamento_confirmado,pedido_entregue', tipos);
  r = await api('POST', '/avaliacoes', { token: cl.token, body: { agricultor_id: ag.usuario.id, pedido_id: pedido.id, nota: 4, comentario: 'Muito bom' } });
  confere('avaliação registrada', r.status === 200 && r.dados.nota === 4, r);
  r = await api('POST', '/avaliacoes', { token: cl.token, body: { agricultor_id: ag.usuario.id, pedido_id: pedido.id, nota: 5 } });
  r = await api('GET', `/agricultores/${ag.usuario.id}`);
  confere('reavaliar atualiza a média (5,0 com 1 avaliação)', r.status === 200 && r.dados.perfil.media_avaliacoes === 5 && r.dados.perfil.total_avaliacoes === 1 && (await conta('avaliacoes')) === 1, r.dados?.perfil);
  r = await api('GET', '/pedidos', { token: cl.token });
  confere('lista de pedidos do cliente', r.status === 200 && r.dados.total === 1 && r.dados.items[0].agricultor_nome === 'Ana Agricultora', r);

  console.log('\nCancelamento devolve o estoque');
  r = await api('POST', `/carrinho/${ag.usuario.id}/itens`, { token: cl.token, body: { produto_id: tomate.id, quantidade: 1 } });
  r = await api('POST', `/conversas/com/${ag.usuario.id}/snapshot`, { token: cl.token, body: { metodo_pagamento: 'cash' } });
  r = await api('POST', '/pedidos', { token: ag.token, body: { mensagem_snapshot_id: r.dados.mensagem.id } });
  const pedido2 = r.dados;
  produtoSalvo = await db.collection('produtos').findOne({ id: tomate.id });
  const estoqueReservado = produtoSalvo.estoque;
  r = await api('PATCH', `/pedidos/${pedido2.id}/status`, { token: cl.token, body: { status: 'cancelado' } });
  produtoSalvo = await db.collection('produtos').findOne({ id: tomate.id });
  confere('cliente cancela e o estoque volta', r.status === 200 && r.dados.status === 'cancelado' && estoqueReservado === 5 && produtoSalvo.estoque === 9, { estoqueReservado, depois: produtoSalvo.estoque });
  r = await api('POST', `/carrinho/${ag.usuario.id}/itens`, { token: cl.token, body: { produto_id: tomate.id, quantidade: 50 } });
  r = await api('POST', `/conversas/com/${ag.usuario.id}/snapshot`, { token: cl.token });
  r = await api('POST', '/pedidos', { token: ag.token, body: { mensagem_snapshot_id: r.dados.mensagem.id } });
  produtoSalvo = await db.collection('produtos').findOne({ id: tomate.id });
  confere('pedido maior que o estoque é recusado e nada muda', r.status === 400 && r.dados.error?.code === 'ESTOQUE_INSUFICIENTE' && produtoSalvo.estoque === 9 && (await conta('pedidos')) === 2, r);

  console.log('\nO que ficou gravado no banco de teste');
  const resumo = Object.fromEntries((await resumoDoBanco()).map(({ nome, documentos }) => [nome, documentos]));
  console.log(' ', JSON.stringify(resumo));
  confere('todas as coleções receberam os dados esperados',
    resumo.usuarios === 2 && resumo.produtos === 2 && resumo.imagens === 2 && resumo.carrinhos === 1
    && resumo.conversas === 1 && resumo.pedidos === 2 && resumo.pagamentos === 1 && resumo.avaliacoes === 1
    && resumo.categorias === 8 && resumo.formas_pagamento === 5 && resumo.mensagens >= 10, resumo);
}

async function main() {
  console.log(`Teste do fluxo completo em ${uriSemSenha()}`);
  console.log(`Banco temporário: ${BANCO_TESTE} (apagado no final; o banco "farm" não é tocado)`);

  await initializeMongo();
  await limparSobras();
  const servidor = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${servidor.address().port}/api`;

  try {
    await fluxo();
  } finally {
    servidor.close();
    // A limpeza nunca esconde o resultado do teste: se falhar, só avisa.
    try {
      const db = await getMongoDb();
      if (db.databaseName === BANCO_TESTE) {
        await apagarBancoDeTeste(db);
        console.log(`\nBanco temporário ${BANCO_TESTE} apagado.`);
      }
    } catch (error) {
      console.log(`\nAviso: não consegui apagar o banco temporário ${BANCO_TESTE} (${error.message}). Ele será removido na próxima execução, ou apague pelo Compass.`);
    }
  }

  console.log(falhas
    ? `\n${falhas} de ${total} verificações FALHARAM — copie a saída acima para investigar.`
    : `\nTudo certo: ${total} de ${total} verificações passaram no MongoDB.`);
  if (falhas) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`\nO teste não conseguiu rodar (${error.name}).\n${explicarErroMongo(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
