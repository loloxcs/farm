#!/usr/bin/env bash
#
# reset.sh — Roda o projeto DO ZERO, RESETANDO o banco de dados.
#
# ATENÇÃO: isto APAGA todos os dados do sistema no MongoDB (usuários, produtos,
# pedidos, conversas...) e recria as coleções vazias, só com os catálogos.
# O banco fica no Atlas (online): o reset vale para TODO MUNDO que usa a mesma
# MONGO_URI, não só para este computador.
#
# Depois do reset, inicia backend + frontend igual ao ./run.sh.
#
# Uso:  ./reset.sh
# Parar: Ctrl+C

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

# --- confirmação (o reset apaga dados) ---
echo ""
echo "!!  ATENÇÃO: isto vai APAGAR todos os dados do MongoDB (banco online, compartilhado"
echo "    por todos que usam a mesma MONGO_URI) e recriá-lo do zero."
read -r -p "    Tem certeza? Digite 'sim' para continuar: " CONFIRM
if [ "$CONFIRM" != "sim" ]; then
  echo "==> Cancelado. Nenhuma alteração feita."
  exit 0
fi

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

# --- RESET do banco (sempre) ---
echo "==> Resetando o MongoDB (npm run db:reset)..."
if ! npm run --silent db:reset -- --confirmar; then
  echo ""
  echo "ERRO: não foi possível resetar o MongoDB — veja a explicação acima."
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
