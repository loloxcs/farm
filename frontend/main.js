// main.js — entrypoint. Configura router, header global e eventos de auth.

import * as router from './router.js';
import { el, limpar, icone, criarAvatar } from './ui.js';
import { getUser, isAuthenticated, logout } from './auth.js';

import { renderLogin } from './pages/login.js';
import { renderRegistro } from './pages/registro.js';
import { renderAgricultoresLista } from './pages/agricultores-lista.js';
import { renderAgricultorPerfil } from './pages/agricultor-perfil.js';
import { renderEmBreve } from './pages/em-breve.js';
import { renderCarrinho } from './pages/carrinho.js';
import { renderConversasLista } from './pages/conversas-lista.js';
import { renderConversa, renderConversaCom } from './pages/conversa.js';
import { renderMeuPerfil } from './pages/meu-perfil.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderMeusProdutos } from './pages/meus-produtos.js';
import { renderPedidosLista } from './pages/pedidos-lista.js';
import { renderPedidoDetalhe } from './pages/pedido-detalhe.js';
import { renderPagamento } from './pages/pagamento.js';
import { renderMapa } from './pages/mapa.js';
import { renderPerfilCliente } from './pages/perfil-cliente.js';
import { renderMinhasFeiras } from './pages/minhas-feiras.js';

// =============================================================
// Header global
// =============================================================
const headerEl = document.getElementById('app-header');

/** Links do menu conforme quem está logado: [texto, hash, ícone]. */
function linksDoMenu(role) {
  if (role === 'agricultor') {
    return [
      ['Painel', '#/dashboard', 'painel'],
      ['Meus produtos', '#/meus-produtos', 'broto'],
      ['Minhas feiras', '#/minhas-feiras', 'barraca'],
      ['Pedidos', '#/pedidos', 'recibo'],
      ['Conversas', '#/conversas', 'conversa'],
    ];
  }
  if (role === 'cliente') {
    return [
      ['Agricultores', '#/agricultores', 'cesta'],
      ['Mapa', '#/mapa', 'mapa'],
      ['Pedidos', '#/pedidos', 'recibo'],
      ['Conversas', '#/conversas', 'conversa'],
    ];
  }
  return [
    ['Agricultores', '#/agricultores', 'cesta'],
    ['Mapa', '#/mapa', 'mapa'],
  ];
}

/** Marca o link do menu que corresponde à página atual. */
function marcarLinkAtivo() {
  const atual = (location.hash || '#/').split('?')[0];
  for (const a of headerEl.querySelectorAll('[data-nav]')) {
    const alvo = a.getAttribute('href');
    const ativo = atual === alvo || atual.startsWith(alvo + '/')
      || (alvo === '#/agricultores' && atual.startsWith('#/carrinho'));
    a.classList.toggle('is-active', ativo);
    if (ativo) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function fecharMenu() {
  headerEl.classList.remove('menu-aberto');
  const btn = headerEl.querySelector('.app-menu-toggle');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function renderHeader() {
  limpar(headerEl);

  const inner = el('div', { className: 'app-header-inner' });
  const user = isAuthenticated() ? getUser() : null;
  const role = user?.role;

  // Marca
  const brand = el('a', {
    className: 'app-brand',
    attrs: { href: role === 'agricultor' ? '#/dashboard' : '#/agricultores', 'aria-label': 'Roça — início' },
  });
  brand.appendChild(el('span', { className: 'app-brand-mark', children: [icone('folha', { tamanho: 18 })] }));
  brand.appendChild(el('span', { className: 'app-brand-nome', text: 'Roça' }));
  inner.appendChild(brand);

  // Botão do menu (celular)
  const toggle = el('button', {
    className: 'app-menu-toggle',
    attrs: { type: 'button', 'aria-label': 'Abrir menu', 'aria-expanded': 'false', 'aria-controls': 'app-nav' },
    children: [icone('menu', { tamanho: 22, className: 'icone-abrir' }), icone('fechar', { tamanho: 22, className: 'icone-fechar' })],
    on: {
      click: () => {
        const aberto = headerEl.classList.toggle('menu-aberto');
        toggle.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      },
    },
  });

  // Navegação principal
  const nav = el('nav', { className: 'app-nav', attrs: { id: 'app-nav', 'aria-label': 'Principal' } });
  const links = el('div', { className: 'app-nav-links' });
  for (const [texto, hash, ic] of linksDoMenu(role)) {
    links.appendChild(el('a', {
      className: 'app-nav-link',
      attrs: { href: hash, 'data-nav': '' },
      children: [icone(ic, { tamanho: 18 }), el('span', { text: texto })],
    }));
  }
  nav.appendChild(links);

  const conta = el('div', { className: 'app-nav-conta' });
  if (user) {
    const perfil = el('a', {
      className: 'app-nav-user',
      attrs: { href: '#/meu-perfil', 'data-nav': '', title: 'Meu perfil' },
    });
    perfil.appendChild(criarAvatar(user.nome, user.foto_id || user.perfil?.foto_id, 30));
    perfil.appendChild(el('span', {
      className: 'app-nav-user-textos',
      children: [
        el('span', { className: 'app-nav-user-nome', text: (user.nome || '').split(' ')[0] || 'Minha conta' }),
        el('span', { className: 'app-nav-user-papel', text: role === 'agricultor' ? 'Agricultor' : 'Cliente' }),
      ],
    }));
    conta.appendChild(perfil);
    conta.appendChild(el('button', {
      className: 'btn btn-ghost btn-sm app-nav-sair',
      attrs: { type: 'button', title: 'Sair da conta' },
      children: [icone('sair', { tamanho: 16 }), el('span', { text: 'Sair' })],
      on: {
        click: () => {
          logout();
          window.dispatchEvent(new Event('auth:changed'));
          router.navigate('#/login');
        },
      },
    }));
  } else {
    conta.appendChild(el('a', { className: 'btn btn-ghost', text: 'Entrar', attrs: { href: '#/login' } }));
    conta.appendChild(el('a', { className: 'btn btn-primary', text: 'Criar conta', attrs: { href: '#/registro' } }));
  }
  nav.appendChild(conta);

  // Fecha o menu do celular ao escolher um link
  nav.addEventListener('click', (ev) => { if (ev.target.closest('a')) fecharMenu(); });

  inner.appendChild(nav);
  inner.appendChild(toggle);
  headerEl.appendChild(inner);
  marcarLinkAtivo();
}

// =============================================================
// Rodapé global
// =============================================================
function renderFooter() {
  let footer = document.getElementById('app-footer');
  if (!footer) {
    footer = el('footer', { className: 'app-footer', attrs: { id: 'app-footer' } });
    document.body.appendChild(footer);
  }
  limpar(footer);
  const inner = el('div', { className: 'app-footer-inner' });

  const marca = el('div', { className: 'app-footer-marca' });
  marca.appendChild(el('span', {
    className: 'app-brand',
    children: [
      el('span', { className: 'app-brand-mark', children: [icone('folha', { tamanho: 18 })] }),
      el('span', { className: 'app-brand-nome', text: 'Roça' }),
    ],
  }));
  marca.appendChild(el('p', { text: 'Do campo direto para a sua mesa. Compre de quem planta, perto de você.' }));
  inner.appendChild(marca);

  const col = (titulo, itens) => el('div', {
    className: 'app-footer-col',
    children: [
      el('h4', { text: titulo }),
      ...itens.map(([t, h]) => el('a', { text: t, attrs: { href: h } })),
    ],
  });
  inner.appendChild(col('Explorar', [['Agricultores', '#/agricultores'], ['Mapa de feiras', '#/mapa']]));
  inner.appendChild(col('Sua conta', isAuthenticated()
    ? [['Meu perfil', '#/meu-perfil'], ['Pedidos', '#/pedidos'], ['Conversas', '#/conversas']]
    : [['Entrar', '#/login'], ['Criar conta', '#/registro']]));
  footer.appendChild(inner);
  footer.appendChild(el('div', {
    className: 'app-footer-base',
    text: `© ${new Date().getFullYear()} Roça · Marketplace de agricultura familiar`,
  }));
}

// =============================================================
// Guards de rota
// =============================================================

/** Envolve um handler exigindo que o usuário esteja logado com determinado role. */
function exigirRole(roleEsperado, handler) {
  return (ctx) => {
    if (!isAuthenticated()) {
      router.replace('#/login');
      return;
    }
    const user = getUser();
    if (roleEsperado && user?.role !== roleEsperado) {
      // role errado → manda pra área padrão do role que ele tem
      router.replace(user?.role === 'agricultor' ? '#/meu-perfil' : '#/agricultores');
      return;
    }
    return handler(ctx);
  };
}

// =============================================================
// Registro de rotas
// =============================================================

// Raiz → redireciona conforme estado de auth
router.register('#/', ({ outlet }) => {
  // Limpa ANTES do replace: o replace já começa a desenhar a página de destino
  // na hora; limpar depois apagava o que ela tinha acabado de montar (tela em branco).
  limpar(outlet);
  if (isAuthenticated()) {
    const u = getUser();
    router.replace(u?.role === 'agricultor' ? '#/meu-perfil' : '#/agricultores');
  } else {
    router.replace('#/agricultores');
  }
});

// Públicas — Fase A
router.register('#/login', renderLogin);
router.register('#/registro', renderRegistro);
router.register('#/agricultores', renderAgricultoresLista);
router.register('#/agricultores/:id', renderAgricultorPerfil);
router.register('#/mapa', renderMapa); // visitante usa a localização do navegador

// Fase B — carrinho + chat
router.register('#/carrinho/:agricultorId',
  exigirRole('cliente', renderCarrinho));
router.register('#/conversas',
  exigirRole(null, renderConversasLista));
router.register('#/conversas/com/:outroId',
  exigirRole(null, renderConversaCom));
router.register('#/conversas/:id',
  exigirRole(null, renderConversa));

// Endereço agora fica dentro de "Meu perfil" (links antigos continuam funcionando).
router.register('#/meu-endereco', () => router.replace('#/meu-perfil?aba=endereco'));

// Fase C — área do agricultor
// "Meu perfil": mesma rota para os dois papéis, telas diferentes.
router.register('#/meu-perfil',
  exigirRole(null, (ctx) => (getUser()?.role === 'agricultor' ? renderMeuPerfil(ctx) : renderPerfilCliente(ctx))));
router.register('#/dashboard',
  exigirRole('agricultor', renderDashboard));
router.register('#/meus-produtos',
  exigirRole('agricultor', renderMeusProdutos));
router.register('#/minhas-feiras',
  exigirRole('agricultor', renderMinhasFeiras));

// Fase D — pedidos (cliente + agricultor)
router.register('#/pedidos',
  exigirRole(null, renderPedidosLista));
router.register('#/pedidos/:id/pagamento',
  exigirRole('cliente', renderPagamento));
router.register('#/pedidos/:id',
  exigirRole(null, renderPedidoDetalhe));

// 404
router.setNotFound(({ outlet }) => {
  limpar(outlet);
  const box = el('div', { className: 'em-breve pagina-404' });
  box.appendChild(el('span', { className: 'em-breve-icone', children: [icone('broto', { tamanho: 32 })] }));
  box.appendChild(el('p', { className: 'em-breve-fase', text: 'Erro 404' }));
  box.appendChild(el('h2', { text: 'Essa página não brotou por aqui' }));
  box.appendChild(el('p', { text: 'O endereço que você acessou não existe ou foi movido.' }));
  box.appendChild(el('a', {
    className: 'btn btn-primary',
    text: 'Ver agricultores',
    attrs: { href: '#/agricultores' },
  }));
  outlet.appendChild(box);
});

// =============================================================
// Eventos globais
// =============================================================

// auth:expired — disparado pelo api.js em qualquer 401.
window.addEventListener('auth:expired', () => {
  if (isAuthenticated()) {
    logout();
    renderHeader();
    renderFooter();
    router.navigate('#/login');
  }
});

// auth:changed — disparado por login/registro/logout pra re-renderizar header.
window.addEventListener('auth:changed', () => {
  renderHeader();
  renderFooter();
});

// Destaca o link da página atual, fecha o menu do celular e volta ao topo.
window.addEventListener('hashchange', () => {
  marcarLinkAtivo();
  fecharMenu();
  window.scrollTo(0, 0);
});

// =============================================================
// Boot
// =============================================================
router.setOutlet(document.getElementById('app'));
renderHeader();
renderFooter();
router.start();
