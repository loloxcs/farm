// main.js — entrypoint. Configura router, header global e eventos de auth.

import * as router from './router.js';
import { el, limpar } from './ui.js';
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
import { renderMeusProdutos } from './pages/meus-produtos.js';
import { renderPedidosLista } from './pages/pedidos-lista.js';
import { renderPedidoDetalhe } from './pages/pedido-detalhe.js';
import { renderPagamento } from './pages/pagamento.js';

// =============================================================
// Header global
// =============================================================
const headerEl = document.getElementById('app-header');

function renderHeader() {
  limpar(headerEl);

  const inner = el('div', { className: 'app-header-inner' });

  // Brand
  const brand = el('a', {
    className: 'app-brand',
    attrs: { href: '#/agricultores' },
  });
  brand.appendChild(el('span', { className: 'app-brand-mark', text: 'R' }));
  brand.appendChild(el('span', { text: 'Roça' }));
  inner.appendChild(brand);

  // Nav
  const nav = el('nav', { className: 'app-nav' });

  if (isAuthenticated()) {
    const user = getUser();
    const role = user?.role;

    // Links principais conforme role
    if (role === 'cliente') {
      nav.appendChild(el('a', { text: 'Agricultores', attrs: { href: '#/agricultores' } }));
    } else if (role === 'agricultor') {
      nav.appendChild(el('a', { text: 'Meu perfil', attrs: { href: '#/meu-perfil' } }));
      nav.appendChild(el('a', { text: 'Meus produtos', attrs: { href: '#/meus-produtos' } }));
    }
    nav.appendChild(el('a', { text: 'Conversas', attrs: { href: '#/conversas' } }));
    nav.appendChild(el('a', { text: 'Pedidos', attrs: { href: '#/pedidos' } }));

    // Nome do usuário (texto, sem link)
    nav.appendChild(el('span', {
      className: 'app-nav-user',
      text: user?.nome || '',
    }));

    nav.appendChild(el('button', {
      className: 'btn btn-ghost',
      text: 'Sair',
      attrs: { type: 'button' },
      on: {
        click: () => {
          logout();
          window.dispatchEvent(new Event('auth:changed'));
          router.navigate('#/login');
        },
      },
    }));
  } else {
    nav.appendChild(el('a', { text: 'Agricultores', attrs: { href: '#/agricultores' } }));
    nav.appendChild(el('a', { text: 'Entrar', attrs: { href: '#/login' } }));
    nav.appendChild(el('a', {
      className: 'btn btn-primary',
      text: 'Cadastrar',
      attrs: { href: '#/registro' },
    }));
  }

  inner.appendChild(nav);
  headerEl.appendChild(inner);
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
  if (isAuthenticated()) {
    const u = getUser();
    router.replace(u?.role === 'agricultor' ? '#/meu-perfil' : '#/agricultores');
  } else {
    router.replace('#/agricultores');
  }
  // outlet fica vazio; o replace dispara novo render imediato
  limpar(outlet);
});

// Públicas — Fase A
router.register('#/login', renderLogin);
router.register('#/registro', renderRegistro);
router.register('#/agricultores', renderAgricultoresLista);
router.register('#/agricultores/:id', renderAgricultorPerfil);

// Fase B — carrinho + chat
router.register('#/carrinho/:agricultorId',
  exigirRole('cliente', renderCarrinho));
router.register('#/conversas',
  exigirRole(null, renderConversasLista));
router.register('#/conversas/com/:outroId',
  exigirRole(null, renderConversaCom));
router.register('#/conversas/:id',
  exigirRole(null, renderConversa));

// Fase C — área do agricultor
router.register('#/meu-perfil',
  exigirRole('agricultor', renderMeuPerfil));
router.register('#/meus-produtos',
  exigirRole('agricultor', renderMeusProdutos));

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
  const box = el('div', { className: 'em-breve' });
  box.appendChild(el('h2', { text: 'Página não encontrada' }));
  box.appendChild(el('p', { text: 'O endereço que você acessou não existe.' }));
  box.appendChild(el('a', {
    className: 'btn btn-primary',
    text: 'Ir para Agricultores',
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
    router.navigate('#/login');
  }
});

// auth:changed — disparado por login/registro/logout pra re-renderizar header.
window.addEventListener('auth:changed', () => {
  renderHeader();
});

// =============================================================
// Boot
// =============================================================
router.setOutlet(document.getElementById('app'));
renderHeader();
router.start();
