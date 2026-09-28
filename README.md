# FarmDirect — Marketplace de Agricultura Familiar

Projeto full-stack com:

- **Backend** — API REST em Node.js + Express, banco SQLite. Roda em `http://localhost:3000`.
- **Frontend** — HTML + CSS + JavaScript puro (sem build, sem bundler). Servido em `http://localhost:5500`.
- **Pagamentos de demonstração** — gravados na coleção `pagamentos` do MongoDB `farm`; pedidos e demais dados continuam no SQLite.

```
farmDirectBackend/
├── backend/        # API Express + SQLite
├── frontend/       # site estático (HTML/JS)
├── run.sh          # inicia tudo SEM resetar o banco  ← uso do dia a dia
└── reset.sh        # reseta o banco do zero e inicia tudo
```

---

## Pré-requisitos

- **Node.js** (e `npm`) — verifique com `node -v`
- **python3** — usado para servir o frontend (já vem no macOS). Alternativamente, o script usa `npx serve` se python3 não existir.

---

## Como rodar (jeito mais fácil)

Na **raiz do projeto**, dê permissão de execução uma única vez:

```bash
chmod +x run.sh reset.sh
```

Na primeira execução, crie a configuração privada do backend e preencha `JWT_SECRET`. Para habilitar a gravação de pagamentos simulados, preencha também `MONGO_URI` com a URI do Atlas. O arquivo `backend/.env` é ignorado pelo Git.

```bash
cp .env.example backend/.env
```

### Uso normal — NÃO mexe no banco

```bash
./run.sh
```

- Instala dependências do backend se ainda não estiverem instaladas.
- Cria o banco **apenas se ele não existir** (nunca apaga um banco existente).
- Sobe backend e frontend juntos.
- **Ctrl+C** encerra os dois.

### Começar do zero — RESETA o banco

Use quando algo quebrar ou quiser dados limpos:

```bash
./reset.sh
```

- ⚠️ **Apaga todos os dados atuais** e recria o banco com schema + seeds.
- Pede confirmação (digite `sim`) antes de apagar.
- Depois sobe backend e frontend igual ao `run.sh`.

Depois que tudo subir, abra **http://localhost:5500** no navegador.

---

## Rodar manualmente (sem os scripts)

Se preferir controlar cada parte em terminais separados:

**Terminal 1 — backend**
```bash
cd backend
cp ../.env.example .env  # só na primeira vez; preencha JWT_SECRET e MONGO_URI
npm install        # só na primeira vez
npm run db:init    # só na primeira vez (ATENÇÃO: db:init/db:reset apagam o banco!)
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

Se `/api/categorias` voltar `[]`, o banco não foi populado — rode `./reset.sh` (ou `npm run db:init` no backend).

---

## Problemas comuns

| Sintoma | Causa / Solução |
|---|---|
| `EADDRINUSE: address already in use :::3000` | Sobrou um processo na porta 3000. Os scripts já liberam automaticamente; manualmente: `lsof -ti :3000 \| xargs kill` |
| Frontend não conecta no backend | Backend precisa estar em `http://localhost:3000`. O `BASE_URL` fica no topo de `frontend/api.js`. |
| `categorias` retorna `[]` | Banco sem seeds — rode `./reset.sh`. |
| Erro de CORS | O backend já manda `cors({ origin: true })`. Só acontece se a config foi alterada. |
| Imagem antiga aparecendo | Cache agressivo do navegador. Force refresh com **Ctrl+Shift+R**. |

---

## Observações

- O banco fica em `backend/database.sqlite` (com arquivos auxiliares `-wal` / `-shm`). Eles **não** são versionados.
- `npm run db:init` e `npm run db:reset` são **destrutivos** — apagam o banco antes de recriar. Por isso o `./run.sh` nunca os chama em um banco existente.
