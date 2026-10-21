/**
 * pages/dashboard.js — Dashboard visual do agricultor
 * Mostra gráficos com:
 * - Faturamento mensal (últimos 12 meses)
 * - Pedidos por status
 * - Produtos ativos
 * - Clientes únicos
 * - Top 5 produtos mais vendidos
 */

import {
  el, limpar, bannerErro, loading, toast, formatarMoeda,
} from '../ui.js';
import { getDashboardAgricultor } from '../api.js';
import { getUser } from '../auth.js';
import { navigate } from '../router.js';

export async function renderDashboard({ outlet }) {
  limpar(outlet);
  outlet.appendChild(loading('Carregando dashboard...'));

  const user = getUser();
  if (!user?.id || user?.role !== 'agricultor') {
    navigate('#/meu-perfil');
    return;
  }

  try {
    const dados = await getDashboardAgricultor();
    limpar(outlet);
    
    const container = el('div', { className: 'dashboard-container' });
    
    // Título
    container.appendChild(el('h1', { text: 'Dashboard', className: 'dashboard-titulo' }));
    
    // Cards KPI
    const kpiGrid = el('div', { className: 'dashboard-kpi-grid' });
    
    kpiGrid.appendChild(criarCardKPI(
      'Faturamento Total',
      formatarMoeda(dados.faturamento_total),
      '💰',
      'primary'
    ));
    
    kpiGrid.appendChild(criarCardKPI(
      'Total de Pedidos',
      String(dados.pedidos_total),
      '📦',
      'info'
    ));
    
    kpiGrid.appendChild(criarCardKPI(
      'Produtos Ativos',
      String(dados.produtos_ativos),
      '🌾',
      'success'
    ));
    
    kpiGrid.appendChild(criarCardKPI(
      'Clientes Únicos',
      String(dados.clientes_unicos),
      '👥',
      'warning'
    ));
    
    container.appendChild(kpiGrid);
    
    // Seção de gráficos
    const chartsSection = el('div', { className: 'dashboard-charts' });
    
    // Gráfico 1: Faturamento Mensal
    chartsSection.appendChild(criarSecaoGrafico(
      'Faturamento Mensal',
      `faturamento-chart`,
      'line'
    ));
    
    // Gráfico 2: Pedidos por Status
    chartsSection.appendChild(criarSecaoGrafico(
      'Pedidos por Status',
      'status-chart',
      'doughnut'
    ));
    
    // Gráfico 3: Top 5 Produtos
    chartsSection.appendChild(criarSecaoGrafico(
      'Top 5 Produtos Mais Vendidos',
      'produtos-chart',
      'bar'
    ));
    
    container.appendChild(chartsSection);
    
    outlet.appendChild(container);
    
    // Aguarda Chart.js estar carregado
    await esperarChartjs();
    
    // Renderiza os gráficos
    renderGraficoFaturamento(dados.faturamento_mensal);
    renderGraficoPedidosPorStatus(dados.pedidos_por_status);
    renderGraficoTopProdutos(dados.produtos_top_5);
    
  } catch (err) {
    limpar(outlet);
    outlet.appendChild(bannerErro(err));
  }
}

/**
 * Cria um card KPI (Key Performance Indicator)
 */
function criarCardKPI(titulo, valor, emoji, tipo = 'primary') {
  const card = el('div', {
    className: `dashboard-kpi dashboard-kpi-${tipo}`
  });
  
  const header = el('div', { className: 'dashboard-kpi-header' });
  header.appendChild(el('span', { className: 'dashboard-kpi-emoji', text: emoji }));
  header.appendChild(el('span', { className: 'dashboard-kpi-titulo', text: titulo }));
  
  card.appendChild(header);
  card.appendChild(el('div', { className: 'dashboard-kpi-valor', text: valor }));
  
  return card;
}

/**
 * Cria uma seção com canvas para um gráfico
 */
function criarSecaoGrafico(titulo, canvasId, tipo) {
  const secao = el('div', { className: 'dashboard-grafico' });
  
  secao.appendChild(el('h3', { text: titulo, className: 'dashboard-grafico-titulo' }));
  
  const canvasWrapper = el('div', { className: 'dashboard-canvas-wrapper' });
  canvasWrapper.appendChild(el('canvas', {
    attrs: { id: canvasId }
  }));
  
  secao.appendChild(canvasWrapper);
  
  return secao;
}

/**
 * Espera Chart.js estar disponível
 */
async function esperarChartjs() {
  return new Promise((resolve) => {
    if (typeof Chart !== 'undefined') {
      resolve();
      return;
    }
    
    // Carrega Chart.js via CDN se não estiver
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
    script.onload = resolve;
    script.onerror = () => {
      console.error('Erro ao carregar Chart.js');
      resolve(); // mesmo assim continua
    };
    document.head.appendChild(script);
  });
}

/**
 * Renderiza gráfico de faturamento mensal (linha)
 */
function renderGraficoFaturamento(dados) {
  const ctx = document.getElementById('faturamento-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  
  const labels = dados.map(m => m.mes);
  const valores = dados.map(m => m.valor);
  
  // Calcula max pra escala melhor
  const max = Math.max(...valores, 100);
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento (R$)',
        data: valores,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        borderWidth: 3,
        tension: 0.3,
        fill: true,
        pointRadius: 5,
        pointBackgroundColor: '#22c55e',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#666' }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: max * 1.1,
          ticks: { color: '#666' },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { color: '#666' },
          grid: { display: false }
        }
      }
    }
  });
}

/**
 * Renderiza gráfico de pedidos por status (rosca)
 */
function renderGraficoPedidosPorStatus(dados) {
  const ctx = document.getElementById('status-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  
  const labels = [
    'Pendente',
    'Confirmado',
    'Entregue',
    'Cancelado'
  ];
  const valores = [
    dados.pendente || 0,
    dados.confirmado || 0,
    dados.entregue || 0,
    dados.cancelado || 0
  ];
  
  const cores = [
    '#ef4444', // vermelho (pendente)
    '#f59e0b', // laranja (confirmado)
    '#22c55e', // verde (entregue)
    '#6b7280'  // cinza (cancelado)
  ];
  
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: cores,
        borderColor: '#fff',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#666', padding: 15 }
        }
      }
    }
  });
}

/**
 * Renderiza gráfico de top 5 produtos (barras horizontais)
 */
function renderGraficoTopProdutos(dados) {
  const ctx = document.getElementById('produtos-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  
  const labels = dados.map(p => p.nome_produto || `Produto ${p.produto_id}`);
  const quantidades = dados.map(p => p.quantidade_vendida);
  
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Quantidade Vendida',
        data: quantidades,
        backgroundColor: '#22c55e',
        borderColor: '#16a34a',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#666' }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: '#666' },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        y: {
          ticks: { color: '#666' },
          grid: { display: false }
        }
      }
    }
  });
}
