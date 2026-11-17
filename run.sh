#!/usr/bin/env bash
#
# run.sh — Liga o sistema inteiro com um comando só (SEM apagar o banco).
#
#   ./run.sh
#
# O que ele faz, em ordem:
#   1. confere Node.js e npm
#   2. libera as portas 3000/5500 se algo antigo ficou preso
#   3. instala/atualiza as dependências do backend quando precisa
#   4. confere o backend/.env (cria a partir do .env.example se não existir)
#   5. prepara o MongoDB (coleções, índices, catálogos — nunca apaga nada)
#   6. sobe o backend, que também serve o site
#   7. espera ficar pronto, preenche coordenadas que faltarem (mapa) e abre o navegador
#
# Depois é só usar:  http://localhost:3000
# Parar tudo: Ctrl+C
# Para apagar os dados e começar do zero: ./reset.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PORT=3000
URL="http://localhost:$PORT"

verde()   { printf '\033[32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[31m%s\033[0m\n' "$*"; }
passo()   { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

passo "Projeto: $ROOT_DIR"

# --- 1. pré-requisitos ---
command -v node >/dev/null 2>&1 || { vermelho "ERRO: Node.js não encontrado. Instale em https://nodejs.org (versão 18 ou maior)."; exit 1; }
command -v npm  >/dev/null 2>&1 || { vermelho "ERRO: npm não encontrado (vem junto com o Node.js)."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  vermelho "ERRO: o Node.js instalado é a versão $(node -v). Precisa ser 18 ou maior."
  exit 1
fi
echo "    Node $(node -v), npm $(npm -v)"

# --- 2. libera portas presas (3000 = sistema; 5500 = site antigo separado) ---
for porta in "$PORT" 5500; do
  pids="$(lsof -tiTCP:"$porta" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    amarelo "    Porta $porta ocupada — encerrando processo anterior ($pids)"
    kill $pids 2>/dev/null || true
  fi
done
sleep 1

# --- 3. dependências: instala se faltar ou se o package.json mudou ---
cd "$BACKEND_DIR"
MARCA="node_modules/.instalado-em"
if [ ! -d node_modules ] || [ ! -f "$MARCA" ] || [ package.json -nt "$MARCA" ] || [ package-lock.json -nt "$MARCA" ]; then
  passo "Instalando dependências do backend (npm install)..."
  npm install --no-audit --no-fund
  date > "$MARCA"
fi

# --- 4. configuração ---
if [ ! -f .env ]; then
  if [ -f "$ROOT_DIR/.env" ]; then
    cp "$ROOT_DIR/.env" .env
    amarelo "    backend/.env criado a partir do .env da raiz."
  else
    cp "$ROOT_DIR/.env.example" .env
    vermelho "ERRO: criei backend/.env a partir do .env.example, mas falta preencher."
    vermelho "      Abra backend/.env, preencha MONGO_URI (string do MongoDB Atlas) e JWT_SECRET, e rode ./run.sh de novo."
    exit 1
  fi
fi
if ! grep -qE '^MONGO_URI=.+' .env; then
  vermelho "ERRO: MONGO_URI está vazia em backend/.env. Preencha com a string de conexão do MongoDB Atlas."
  exit 1
fi

# --- 5. banco ---
passo "Preparando o MongoDB..."
if ! npm run --silent db:setup; then
  vermelho "ERRO: não foi possível preparar o MongoDB — veja a explicação acima."
  vermelho "      Diagnóstico: cd backend && npm run db:check"
  exit 1
fi

# --- 6. backend (serve a API e o site) ---
passo "Ligando o sistema em $URL ..."
npm run dev &
BACKEND_PID=$!
cleanup() {
  trap - EXIT INT TERM
  echo ""
  passo "Encerrando..."
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- 7. espera ficar pronto ---
for _ in $(seq 1 60); do
  if curl -fs "$URL/api/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    vermelho "ERRO: o backend parou ao iniciar — veja a mensagem acima."
    exit 1
  fi
  sleep 1
done
if ! curl -fs "$URL/api/health" >/dev/null 2>&1; then
  vermelho "ERRO: o backend não respondeu em 60 s."
  exit 1
fi

# Coordenadas de quem tem endereço mas ainda não aparece no mapa (rápido quando não há nada a fazer).
(npm run --silent db:geocodificar >/dev/null 2>&1 || true) &

echo ""
verde "    ✔ Sistema no ar:  $URL"
echo "      API: $URL/api   (health: $URL/api/health)"
echo "      Pressione Ctrl+C para parar."
echo ""

# Abre o navegador (Mac: open; Linux: xdg-open). Use NO_BROWSER=1 ./run.sh para não abrir.
if [ -z "${NO_BROWSER:-}" ]; then
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  fi
fi

wait "$BACKEND_PID"
