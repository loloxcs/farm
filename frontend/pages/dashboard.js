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
  el, limpar, bannerErro, loading, toast, formatarMoeda, icone,
} from '../ui.js';

// Paleta dos gráficos (mesmas cores do styles.css)
const COR = {
  verde: '#2f6b3f',
  verdeClaro: 'rgba(47, 107, 63, 0.12)',
  terra: '#c8642c',
  mel: '#d9a23a',
  azul: '#3f6f9a',
  cinza: '#9aa294',
  texto: '#5f6b5c',
  grade: 'rgba(31, 42, 31, 0.06)',
};
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
    
    // Cabeçalho com saudação e atalhos
    const primeiroNome = (user.nome || '').split(' ')[0];
    container.appendChild(el('div', {
      className: 'page-header page-header-acoes',
      children: [
        el('div', {
          children: [
            el('h1', { className: 'page-title dashboard-titulo', text: primeiroNome ? `Olá, ${primeiroNome}!` : 'Painel' }),
            el('p', { className: 'page-subtitle', text: 'Acompanhe suas vendas, pedidos e produtos em um só lugar.' }),
          ],
        }),
        el('div', {
          className: 'page-header-botoes',
          children: [
            el('a', { className: 'btn btn-secondary', attrs: { href: '#/pedidos' }, children: [icone('recibo', { tamanho: 18 }), el('span', { text: 'Ver pedidos' })] }),
            el('a', { className: 'btn btn-primary', attrs: { href: '#/meus-produtos' }, children: [icone('mais', { tamanho: 18 }), el('span', { text: 'Gerenciar produtos' })] }),
          ],
        }),
      ],
    }));
    
    // Cards KPI
    const kpiGrid = el('div', { className: 'dashboard-kpi-grid' });
    
    kpiGrid.appendChild(criarCardKPI(
      'Faturamento Total',
      formatarMoeda(dados.faturamento_total),
      'carteira',
      'primary'
    ));
    
    kpiGrid.appendChild(criarCardKPI(
      'Total de Pedidos',
      String(dados.pedidos_total),
      'pacote',
      'info'
    ));
    
    kpiGrid.appendChild(criarCardKPI(
      'Produtos Ativos',
      String(dados.produtos_ativos),
      'broto',
      'success'
    ));
    
    kpiGrid.appendChild(criarCardKPI(
      'Clientes Únicos',
      String(dados.clientes_unicos),
      'pessoas',
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
    if (typeof Chart !== 'undefined') {
      Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
      Chart.defaults.color = COR.texto;
    }
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
function criarCardKPI(titulo, valor, nomeIcone, tipo = 'primary') {
  const card = el('div', {
    className: `dashboard-kpi dashboard-kpi-${tipo}`
  });
  
  const header = el('div', { className: 'dashboard-kpi-header' });
  header.appendChild(el('span', { className: 'dashboard-kpi-emoji', children: [icone(nomeIcone, { tamanho: 20 })] }));
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
  
  secao.className = `dashboard-grafico dashboard-grafico-${tipo}`;
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
        borderColor: COR.verde,
        backgroundColor: COR.verdeClaro,
        borderWidth: 2.5,
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: COR.verde,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: max,
          ticks: {
            color: COR.texto,
            maxTicksLimit: 6,
            callback: (v) => formatarMoeda(v).replace(',00', ''),
          },
          grid: { color: COR.grade }
        },
        x: {
          ticks: { color: COR.texto },
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
    COR.mel,   // pendente
    COR.azul,  // confirmado
    COR.verde, // entregue
    COR.cinza, // cancelado
  ];
  
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: cores,
        borderColor: '#fff',
        borderWidth: 3,
        hoverOffset: 6,
      }]
    },
    options: {
      cutout: '68%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: COR.texto, padding: 16, usePointStyle: true, pointStyle: 'circle' }
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
        backgroundColor: COR.terra,
        borderWidth: 0,
        borderRadius: 6,
        maxBarThickness: 28,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: COR.texto },
          grid: { color: COR.grade }
        },
        y: {
          ticks: { color: COR.texto },
          grid: { display: false }
        }
      }
    }
  });
}
