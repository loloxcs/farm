/**
 * Marketplace Agricultura Familiar — Backend Fase 2
 * Entrypoint Express.
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { errorHandler } = require('./middleware/error');
const { initializeMongo, nomeDoBanco, uriSemSenha, explicarErroMongo } = require('./db/mongodb');

const authRoutes = require('./routes/mongo-auth');
const agricultoresRoutes = require('./routes/mongo-agricultores');
const catalogosRoutes = require('./routes/mongo-catalogos');
const carrinhoRoutes = require('./routes/mongo-carrinho');
const conversasRoutes = require('./routes/mongo-conversas');
const pedidosRoutes = require('./routes/mongo-pedidos');
const { produtos, produtosPorAgr, imagens } = require('./routes/mongo-produtos');
const { avaliacoes, avaliacoesPorAgr } = require('./routes/mongo-avaliacoes');

const app = express();

// ----------------- middlewares globais -----------------
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' })); // 10mb cobre payloads de imagens em base64

// Logger simples (LOG_HTTP=off silencia — usado pelo teste automático)
app.use((req, res, next) => {
  if (process.env.LOG_HTTP === 'off') return next();
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ----------------- health -----------------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ----------------- rotas -----------------
app.use('/api/auth',                  authRoutes);
app.use('/api',                       catalogosRoutes); // /api/categorias, /api/formas-pagamento

app.use('/api/produtos',              produtos);
app.use('/api/imagens',               imagens);
app.use('/api/agricultores/:id/produtos',    produtosPorAgr);
app.use('/api/agricultores/:id/avaliacoes',  avaliacoesPorAgr);
app.use('/api/agricultores',          agricultoresRoutes);

app.use('/api/carrinho',              carrinhoRoutes);
app.use('/api/conversas',             conversasRoutes);
app.use('/api/pedidos',               pedidosRoutes);
app.use('/api/avaliacoes',            avaliacoes);

// ----------------- frontend -----------------
// O site (pasta frontend/) também é servido aqui: com o backend no ar, basta
// abrir http://localhost:3000 — não precisa de um segundo servidor.
// (O ./run.sh continua servindo o mesmo site em http://localhost:5500.)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ----------------- 404 e errorHandler -----------------
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Rota não encontrada: ${req.method} ${req.path}` }
  });
});
app.use(errorHandler);

// ----------------- start -----------------
const PORT = parseInt(process.env.PORT, 10) || 3000;

async function start() {
  try {
    // Cria coleções/índices/catálogos que faltarem (não apaga nada).
    await initializeMongo();
    app.listen(PORT, () => {
      console.log(`\nMarketplace Agricultura Familiar — Backend`);
      console.log(`Banco: MongoDB "${nomeDoBanco()}" em ${uriSemSenha()}`);
      console.log(`Site:  http://localhost:${PORT}`);
      console.log(`API rodando em http://localhost:${PORT}/api`);
      console.log(`Health: http://localhost:${PORT}/api/health\n`);
    });
  } catch (error) {
    console.error(`\nNão foi possível iniciar o backend com MongoDB (${error.name}).`);
    console.error(explicarErroMongo(error));
    console.error('Diagnóstico completo: npm run db:check\n');
    process.exitCode = 1;
  }
}

// `node server.js` sobe o servidor; `require('./server')` (testes) só pega o app.
if (require.main === module) start();

module.exports = { app, start };
