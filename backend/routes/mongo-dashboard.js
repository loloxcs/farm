/**
 * Dashboard do Agricultor — Agregações de dados para visualização
 * GET /agricultores/me/dashboard
 *
 * Retorna:
 * - Faturamento mensal (últimos 12 meses)
 * - Pedidos por status
 * - Produtos ativos
 * - Clientes únicos
 * - Top 5 produtos mais vendidos
 */

const express = require('express');
const { getMongoDb } = require('../db/mongodb');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { asyncRoute } = require('../utils/mongo-helpers');
const { httpError } = require('../middleware/error');

const router = express.Router();

/**
 * Gera array de 12 meses (últimos 12 meses a partir de hoje)
 * Retorna: [{ mes: "Jan", ano: 2024, periodo: "2024-01" }, ...]
 */
function gerarUltimos12Meses() {
  const meses = [];
  const hoje = new Date();
  
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const ano = d.getFullYear();
    const mes = d.getMonth();
    const nomeMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][mes];
    const periodo = `${ano}-${String(mes + 1).padStart(2, '0')}`;
    
    meses.push({ mes: nomeMes, ano, periodo, valor: 0 });
  }
  
  return meses;
}

/**
 * Extrai ano-mês de uma data ISO string (2024-10-21T12:00:00.000Z → "2024-10")
 */
function extrairPeriodo(isoString) {
  if (!isoString) return null;
  return isoString.substring(0, 7);
}

/**
 * GET /agricultores/me/dashboard
 * Retorna todos os dados para o dashboard
 */
router.get('/', requireAuth, requireRole('agricultor'), asyncRoute(async (req, res) => {
  const agricultor_id = req.user.id;
  const db = await getMongoDb();
  
  // ==================== 1. Faturamento Mensal ====================
  const faturamentoRaw = await db.collection('pedidos').aggregate([
    {
      $match: {
        agricultor_id,
        status: { $in: ['confirmado', 'entregue'] }, // Só pedidos confirmados/entregues
      }
    },
    {
      $group: {
        _id: {
          $substr: ['$created_at', 0, 7] // Extrai "YYYY-MM"
        },
        total: { $sum: '$total' },
        quantidade: { $sum: 1 }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]).toArray();

  // Monta estrutura de 12 meses com dados reais
  const faturamentoMensal = gerarUltimos12Meses();
  for (const row of faturamentoRaw) {
    const idx = faturamentoMensal.findIndex(m => m.periodo === row._id);
    if (idx !== -1) {
      faturamentoMensal[idx].valor = Number(row.total.toFixed(2));
      faturamentoMensal[idx].quantidade_pedidos = row.quantidade;
    }
  }

  // ==================== 2. Pedidos por Status ====================
  const pedidosPorStatus = await db.collection('pedidos').aggregate([
    { $match: { agricultor_id } },
    {
      $group: {
        _id: '$status',
        quantidade: { $sum: 1 }
      }
    }
  ]).toArray();

  const pedidosData = {
    pendente: 0,
    confirmado: 0,
    entregue: 0,
    cancelado: 0
  };
  for (const row of pedidosPorStatus) {
    pedidosData[row._id] = row.quantidade;
  }

  // ==================== 3. Produtos Ativos ====================
  const produtosAtivos = await db.collection('produtos').countDocuments({
    agricultor_id,
    deleted_at: null
  });

  // ==================== 4. Clientes Únicos ====================
  const clientesUnicos = await db.collection('pedidos').aggregate([
    {
      $match: {
        agricultor_id,
        status: { $in: ['confirmado', 'entregue', 'cancelado'] } // Pelo menos alguma interação
      }
    },
    {
      $group: {
        _id: '$cliente_id'
      }
    },
    {
      $count: 'total'
    }
  ]).toArray();

  const totalClientesUnicos = clientesUnicos[0]?.total || 0;

  // ==================== 5. Top 5 Produtos Mais Vendidos ====================
  const topProdutos = await db.collection('pedidos').aggregate([
    {
      $match: {
        agricultor_id,
        status: { $in: ['confirmado', 'entregue'] }
      }
    },
    {
      $unwind: '$itens' // Desempacota array de itens
    },
    {
      $group: {
        _id: '$itens.produto_id',
        nome_produto: { $first: '$itens.nome_produto' },
        quantidade_vendida: { $sum: '$itens.quantidade' },
        faturamento: { $sum: '$itens.subtotal' }
      }
    },
    {
      $sort: { quantidade_vendida: -1 }
    },
    {
      $limit: 5
    },
    {
      $project: {
        _id: 0,
        produto_id: '$_id',
        nome_produto: 1,
        quantidade_vendida: 1,
        faturamento: { $round: ['$faturamento', 2] }
      }
    }
  ]).toArray();

  // ==================== 6. Resumo Total ====================
  const faturamentoTotal = faturamentoMensal.reduce((sum, m) => sum + m.valor, 0);
  const pedidosTotal = Object.values(pedidosData).reduce((a, b) => a + b, 0);

  // ==================== Retorna ====================
  res.json({
    faturamento_mensal: faturamentoMensal,
    faturamento_total: Number(faturamentoTotal.toFixed(2)),
    pedidos_por_status: pedidosData,
    pedidos_total: pedidosTotal,
    produtos_ativos: produtosAtivos,
    clientes_unicos: totalClientesUnicos,
    produtos_top_5: topProdutos
  });
}));

module.exports = router;
