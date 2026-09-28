/**
 * Marketplace Agricultura Familiar — Backend Fase 2
 * Entrypoint Express.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { errorHandler } = require('./middleware/error');

const authRoutes        = require('./routes/auth');
const agricultoresRoutes = require('./routes/agricultores');
const catalogosRoutes   = require('./routes/catalogos');
const carrinhoRoutes    = require('./routes/carrinho');
const conversasRoutes   = require('./routes/conversas');
const pedidosRoutes     = require('./routes/pedidos');
const pagamentosRoutes  = require('./routes/pagamentos');

const { produtos, produtosPorAgr, imagens } = require('./routes/produtos');
const { avaliacoes, avaliacoesPorAgr }      = require('./routes/avaliacoes');

const app = express();

// ----------------- middlewares globais -----------------
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' })); // 10mb cobre payloads de imagens em base64

// Logger simples
app.use((req, res, next) => {
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
app.use('/api/pedidos',               pagamentosRoutes);
app.use('/api/pedidos',               pedidosRoutes);
app.use('/api/avaliacoes',            avaliacoes);

// ----------------- 404 e errorHandler -----------------
app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Rota não encontrada: ${req.method} ${req.path}` }
  });
});
app.use(errorHandler);

// ----------------- start -----------------
const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, () => {
  console.log(`\nMarketplace Agricultura Familiar — Backend`);
  console.log(`API rodando em http://localhost:${PORT}/api`);
  console.log(`Health: http://localhost:${PORT}/api/health\n`);
});
