# FarmDirect — Marketplace de Agricultura Familiar

Projeto full-stack com:

- **Backend** — API REST em Node.js + Express. Roda em `http://localhost:3000`.
- **Banco de dados** — **MongoDB Atlas** (online). Todos os dados ficam lá: usuários, produtos e estoque, carrinhos, conversas, pedidos, pagamentos e avaliações. Não há mais banco local.
- **Frontend** — HTML + CSS + JavaScript puro (sem build, sem bundler). Servido em `http://localhost:5500`.

```
farm/
├── backend/        # API Express + MongoDB
├── frontend/       # site estático (HTML/JS)
├── run.sh          # inicia tudo SEM apagar dados  ← uso do dia a dia
└── reset.sh        # APAGA os dados do MongoDB e inicia tudo do zero
```

---

## Pré-requisitos

- **Node.js 18+** (e `npm`) — verifique com `node -v`
- **python3** — usado para servir o frontend (já vem no macOS). Alternativamente, o script usa `npx serve` se python3 não existir.
- **Um cluster no MongoDB Atlas** (o plano gratuito serve) e a string de conexão dele.

---

## Configuração (uma vez)

1. Crie a configuração privada do backend:

   ```bash
   cp .env.example backend/.env
   ```

2. Abra `backend/.env` e preencha:
   - `JWT_SECRET` — qualquer texto longo e aleatório;
   - `MONGO_URI` — a string de conexão do Atlas (`mongodb+srv://usuario:senha@cluster.../`).

   O `backend/.env` é ignorado pelo Git. **Nunca** coloque a string real em arquivos versionados.

3. No site do Atlas, em **Network Access**, libere o IP do seu computador ("Add Current IP Address"). Sem isso o backend não consegue conectar.

4. Dê permissão de execução aos scripts:

   ```bash
   chmod +x run.sh reset.sh
   ```

---

## Como rodar

### Uso normal — NÃO apaga dados

```bash
./run.sh
```

- Instala dependências do backend se faltarem.
- Prepara o MongoDB (`npm run db:setup`): cria as coleções, índices e catálogos que faltarem. Na **primeira** execução, se ainda existir o antigo `backend/database.sqlite`, copia os dados dele para o MongoDB — uma única vez.
- Sobe backend e frontend juntos. **Ctrl+C** encerra os dois.

Depois que tudo subir, abra **http://localhost:5500** no navegador.

### Começar do zero — APAGA os dados

```bash
./reset.sh
```

- ⚠️ **Apaga todos os dados do MongoDB** (usuários, produtos, pedidos...) e recria as coleções vazias, só com categorias e formas de pagamento.
- O banco é online: o reset vale para **todo mundo** que usa a mesma `MONGO_URI`.
- Pede confirmação (digite `sim`) antes de apagar.

---

## Coleções no MongoDB (banco `farm`)

| Coleção | O que guarda |
|---|---|
| `usuarios` | clientes e agricultores (cadastro, senha criptografada; o perfil do agricultor fica em `perfil`) |
| `produtos` | produtos de cada agricultor, com preço e **estoque** |
| `imagens` | fotos de perfil e de produto |
| `categorias`, `formas_pagamento` | catálogos fixos |
| `carrinhos` | carrinho de cada cliente com cada agricultor |
| `conversas`, `mensagens` | chat, carrinhos enviados e avisos automáticos de pedido/pagamento |
| `pedidos` | pedidos e seus itens |
| `pagamentos` | pagamento de cada pedido |
| `avaliacoes` | avaliações dos agricultores |
| `contadores` | numeração (1, 2, 3...) dos ids de cada coleção |

---

## Comandos do banco (dentro de `backend/`)

| Comando | O que faz |
|---|---|
| `npm run db:check` | **Diagnóstico** (só leitura): conexão, coleções, índices, contadores. Comece por aqui se algo der errado. |
| `npm run db:init` | Cria coleções, índices e catálogos que faltarem. Não apaga nada. |
| `npm run db:setup` | `db:init` + migração única do `database.sqlite` antigo (é o que o `./run.sh` chama). |
| `npm run db:migrate` | Só a migração do SQLite (recusa se o MongoDB já tiver dados). |
| `npm run db:reset -- --confirmar` | Apaga todos os dados e recria vazio (é o que o `./reset.sh` chama). |
| `npm run test:fluxo` | **Teste automático** do sistema inteiro em um banco temporário (`farm_teste_...`), apagado no final. Não toca nos dados reais. |

---

## Rodar manualmente (sem os scripts)

**Terminal 1 — backend**
```bash
cd backend
npm install        # só na primeira vez
npm run db:setup   # prepara o MongoDB (pode rodar sempre; não apaga nada)
npm run dev        # ou: npm start
```

**Terminal 2 — frontend**
```bash
cd frontend
python3 -m http.server 5500
```

Abra **http://localhost:5500**.

---

## Endpoints úteis

```bash
curl http://localhost:3000/api/health       # status do servidor
curl http://localhost:3000/api/categorias   # deve retornar 8 categorias
```

A documentação completa da API está em `backend/API.md`.

---

## Problemas comuns

| Sintoma | Causa / Solução |
|---|---|
| "Não consegui chegar no cluster" ao iniciar | Seu IP não está liberado no Atlas → **Network Access → Add Current IP Address**. Também acontece com cluster pausado ou rede que bloqueia a porta 27017 (teste em outra rede). |
| "O Atlas recusou o usuário/senha" | A senha do `MONGO_URI` em `backend/.env` não confere com a do usuário em **Database Access**. |
| "MONGO_URI não está definida" | Falta preencher `MONGO_URI` em `backend/.env`. |
| `EADDRINUSE: address already in use :::3000` | Sobrou um processo na porta 3000. Os scripts já liberam automaticamente; manualmente: `lsof -ti :3000 \| xargs kill` |
| Frontend não conecta no backend | Backend precisa estar em `http://localhost:3000`. O `BASE_URL` fica no topo de `frontend/api.js`. |
| `categorias` retorna `[]` | Rode `npm run db:init` no backend. |
| Imagem ou tela antiga aparecendo | Cache do navegador. Force refresh com **Ctrl+Shift+R**. |

---

## Observações

- O antigo banco local (`backend/database.sqlite`) não é mais usado pelo servidor. Ele é mantido apenas como origem da migração única e pode ser apagado depois que os dados estiverem conferidos no MongoDB.
- `npm run db:reset` e `./reset.sh` são **destrutivos** e afetam o banco online compartilhado. O `./run.sh` nunca apaga nada.
