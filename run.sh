#!/usr/bin/env bash
#
# run.sh — Inicia o projeto (backend + frontend) SEM resetar o banco.
#
# - Backend (Express + MongoDB Atlas) em http://localhost:3000
# - Frontend (HTML/JS estático)       em http://localhost:5500
#
# O banco fica no MongoDB (MONGO_URI em backend/.env) e NÃO é apagado.
# A cada início o script confere coleções/índices e, só na primeira vez,
# copia os dados do antigo database.sqlite para o MongoDB.
# Para apagar tudo e começar do zero, use ./reset.sh
#
# Uso:  ./run.sh
# Parar: Ctrl+C (encerra backend e frontend juntos)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
FRONTEND_PORT=5500
BACKEND_PORT=3000

echo "==> Projeto: $ROOT_DIR"

# --- pré-requisitos ---
command -v node >/dev/null 2>&1 || { echo "ERRO: node não encontrado. Instale o Node.js."; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERRO: npm não encontrado.";  exit 1; }

# --- libera a porta do backend se houver processo preso ---
if lsof -ti ":$BACKEND_PORT" >/dev/null 2>&1; then
  echo "==> Porta $BACKEND_PORT ocupada — encerrando processo anterior..."
  lsof -ti ":$BACKEND_PORT" | xargs kill 2>/dev/null || true
  sleep 1
fi

# --- dependências do backend (instala só se faltar) ---
cd "$BACKEND_DIR"
if [ ! -d node_modules ] || [ ! -d node_modules/mongodb ]; then
  echo "==> Instalando dependências do backend (npm install)..."
  npm install
fi

# --- configuração: backend/.env com MONGO_URI ---
if [ ! -f .env ]; then
  echo "ERRO: backend/.env não existe. Crie com:  cp .env.example backend/.env"
  echo "      e preencha JWT_SECRET e MONGO_URI (string de conexão do MongoDB Atlas)."
  exit 1
fi

# --- banco: confere coleções/índices e migra o SQLite antigo na 1ª vez (nunca apaga) ---
echo "==> Preparando o MongoDB (npm run db:setup)..."
if ! npm run --silent db:setup; then
  echo ""
  echo "ERRO: não foi possível preparar o MongoDB — veja a explicação acima."
  echo "      Diagnóstico: cd backend && npm run db:check"
  exit 1
fi

# --- escolhe servidor estático para o frontend ---
if command -v python3 >/dev/null 2>&1; then
  SERVE_CMD=(python3 -m http.server "$FRONTEND_PORT")
elif command -v npx >/dev/null 2>&1; then
  SERVE_CMD=(npx --yes serve -l "$FRONTEND_PORT" .)
else
  echo "ERRO: nenhum servidor estático disponível (precisa de python3 ou npx)."
  exit 1
fi

# --- inicia backend em background ---
echo "==> Iniciando backend em http://localhost:$BACKEND_PORT ..."
npm run dev &
BACKEND_PID=$!

# garante que o backend morra quando este script encerrar
cleanup() {
  echo ""
  echo "==> Encerrando..."
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- inicia frontend em foreground ---
echo "==> Iniciando frontend em http://localhost:$FRONTEND_PORT ..."
echo ""
echo "    Backend : http://localhost:$BACKEND_PORT/api  (health: /api/health)"
echo "    Frontend: http://localhost:$FRONTEND_PORT"
echo ""
echo "    Pressione Ctrl+C para parar tudo."
echo ""
cd "$FRONTEND_DIR"
"${SERVE_CMD[@]}"
