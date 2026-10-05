# Marketplace Agricultura Familiar — Backend (Fase 2)

API REST em Node.js + Express + MongoDB (Atlas) que implementa os requisitos funcionais RF01–RF13 do projeto: cadastro/login, perfis de agricultor, produtos e categorias, carrinho por par cliente-agricultor, chat com snapshot, pedidos via snapshot e avaliações.

---

## a) Pré-requisitos

- **Node.js 18+** (testado em 18, 20 e 22)
- **npm** (vem com o Node)

E um cluster no **MongoDB Atlas** (o plano gratuito serve): todos os dados do sistema ficam lá. Não há banco local para instalar.

---

## b) Como rodar passo a passo

1. Descompactar o `.zip`
2. `cd backend`
3. `npm install`
4. `cp ../.env.example .env` e abrir o arquivo para ajustar `JWT_SECRET` (qualquer string longa e aleatória, ex.: `openssl rand -hex 32`) e `MONGO_URI` (string de conexão do Atlas). No Atlas, liberar o IP da máquina em **Network Access**.
5. `npm run db:setup` — cria coleções, índices e catálogos no MongoDB e, na primeira vez, copia os dados do antigo `database.sqlite` (se existir). Não apaga nada; pode rodar sempre.
6. `npm run dev`
7. Confirmar que subiu — você deve ver no console:

```
Marketplace Agricultura Familiar — Backend
API rodando em http://localhost:3000/api
Health: http://localhost:3000/api/health
```

Teste rápido em outro terminal:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"ts":"2026-05-06T..."}
```

> `npm run dev` usa `node --watch` e reinicia o servidor a cada save. Para produção use `npm start`.

---

## c) Variáveis de ambiente

| Nome | Descrição | Valor exemplo |
|---|---|---|
| `PORT` | Porta HTTP do servidor | `3000` |
| `JWT_SECRET` | Segredo HMAC para assinar/validar JWTs. **Trocar antes de subir.** | `9f2a8b...` (>=32 chars aleatórios) |
| `JWT_EXPIRES_IN` | Validade do token. Aceita formatos do `jsonwebtoken` (`240h`, `10d`, etc.) | `240h` |
| `MONGO_URI` | **Obrigatória.** String de conexão do MongoDB Atlas | `mongodb+srv://usuario:senha@cluster.../` |
| `MONGO_DB` | Nome do banco dentro do cluster (opcional) | `farm` |
| `DB_PATH` | Só para a migração única: caminho do antigo arquivo SQLite | `./database.sqlite` |
| `APP_TIMEZONE` | Fuso usado nos textos automáticos do chat (opcional) | `America/Sao_Paulo` |

Todo o domínio (usuários, produtos e estoque, carrinhos, conversas, pedidos, pagamentos, avaliações e imagens) é gravado no MongoDB, banco `farm`. O checkout nunca persiste número completo do cartão, validade ou CVV.

---

## d) Estrutura de pastas

**`db/`** — Banco. `mongodb.js` abre a conexão única com o Atlas, define as coleções e índices e expõe `nextId()` (ids numéricos sequenciais via coleção `contadores`). Scripts: `init-mongo.js` (`db:init`, cria o que faltar), `setup-mongo.js` (`db:setup`, init + migração), `migrate-sqlite-to-mongo.js` (`db:migrate`, cópia única do banco antigo), `check-mongo.js` (`db:check`, diagnóstico só leitura) e `reset-mongo.js` (`db:reset`, apaga tudo). `schema.sql`, `seeds.sql`, `init.js` e `connection.js` são do antigo banco SQLite e só continuam aqui como referência/origem da migração.

**`middleware/`** — Plumbing transversal. `auth.js` extrai e valida o JWT do header `Authorization: Bearer ...` e injeta `req.user = { id, role }`. `role.js` é uma fábrica que produz `requireRole('cliente')` ou `requireRole('agricultor')` para gating por papel. `error.js` é o handler central que formata todo erro como `{ error: { code, message, details? } }` com o status correto e expõe um helper `httpError(status, code, msg, details)` usado nas rotas para sinalizar erros estruturados.

**`routes/`** — Um arquivo por domínio: `auth`, `agricultores`, `produtos` (mais imagens), `catalogos` (categorias e formas de pagamento), `carrinho`, `conversas` (chat e snapshot), `pedidos`, `avaliacoes`. Os arquivos em uso são os `mongo-*.js` (os de mesmo nome sem o prefixo são a versão antiga em SQLite, não carregada pelo servidor). Cada rota faz validação inline, persiste no MongoDB — com transação onde mexe em estoque e pedido — e devolve JSON; erros vão para o handler global.

**`utils/`** — Helpers puros. `senha.js` envelopa `bcryptjs` (`hashSenha` / `verificarSenha`). `validacao.js` tem checagens simples (`obrigatorio`, `exigirEmail`, `numeroPositivo`, `emEnum`, `paginacao`) que lançam `httpError(400, ...)` em falha.

---

## e) Como testar os endpoints

Todos os exemplos usam `localhost:3000`. Substitua `<TOKEN>` pelo retornado no login.

### Auth

Registrar agricultor:
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"nome":"Sítio Boa Terra","email":"agr@x.com","senha":"senha123","role":"agricultor","telefone":"19988887777"}'
# 201 → {"token":"eyJ...","usuario":{"id":1,"nome":"Sítio Boa Terra","email":"agr@x.com","role":"agricultor"}}
```

Login (guarde o token para os próximos exemplos):
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"agr@x.com","senha":"senha123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo $TOKEN
```

Sessão atual:
```bash
curl http://localhost:3000/api/auth/me -H "Authorization: Bearer $TOKEN"
# 200 → {"id":1,"nome":"Sítio Boa Terra","email":"agr@x.com","role":"agricultor","telefone":"..."}
```

### Agricultores

Listar com filtros:
```bash
curl "http://localhost:3000/api/agricultores?q=boa&estado=SP&page=1&limit=20"
# 200 → { items:[...], page:1, limit:20, total:N }
```

Editar próprio perfil (precisa ser agricultor):
```bash
curl -X PATCH http://localhost:3000/api/agricultores/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"descricao":"Hortaliças orgânicas","cidade":"Valinhos","estado":"SP","latitude":-22.97,"longitude":-46.99}'
```

### Produtos

Criar produto (agricultor):
```bash
curl -X POST http://localhost:3000/api/produtos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nome":"Alface crespa","descricao":"Pé grande","preco":4.5,"unidade":"un","estoque":50,"categoria_id":2}'
# 201 → produto completo com categoria expandida
```

> Para incluir imagem: adicionar `"foto_base64":"<base64>","foto_mime":"image/jpeg"`. A imagem fica acessível em `GET /api/imagens/:foto_id`.

Listar produtos do agricultor 1:
```bash
curl "http://localhost:3000/api/agricultores/1/produtos?categoria_id=2"
```

Soft delete:
```bash
curl -X DELETE http://localhost:3000/api/produtos/1 -H "Authorization: Bearer $TOKEN"
# 200 → {"ok":true}
```

### Carrinho (cliente)

Adicionar item ao carrinho com agricultor 1:
```bash
curl -X POST http://localhost:3000/api/carrinho/1/itens \
  -H "Authorization: Bearer $TOKEN_CLI" \
  -H "Content-Type: application/json" \
  -d '{"produto_id":1,"quantidade":3}'
# 200 → carrinho completo com itens, total
```

### Conversas / Chat

Enviar mensagem de texto:
```bash
curl -X POST http://localhost:3000/api/conversas/com/1/mensagens \
  -H "Authorization: Bearer $TOKEN_CLI" \
  -H "Content-Type: application/json" \
  -d '{"conteudo":"Olá, vocês entregam em Campinas?"}'
```

Enviar carrinho como snapshot:
```bash
curl -X POST http://localhost:3000/api/conversas/com/1/snapshot \
  -H "Authorization: Bearer $TOKEN_CLI"
# 201 → mensagem com tipo "snapshot" e snapshot_json
```

Polling do histórico (passe `desde` com o `server_time` da última resposta):
```bash
curl "http://localhost:3000/api/conversas/1/mensagens?desde=2026-05-06T14:00:00Z" \
  -H "Authorization: Bearer $TOKEN"
# 200 → { mensagens:[...], server_time:"2026-05-06T14:23:08Z" }
```

### Pedidos (criado por agricultor a partir de um snapshot)

```bash
curl -X POST http://localhost:3000/api/pedidos \
  -H "Authorization: Bearer $TOKEN_AGR" \
  -H "Content-Type: application/json" \
  -d '{"mensagem_snapshot_id":5,"forma_pagamento_id":2,"observacoes":"Trazer sacolas"}'
# 201 → pedido com itens, total, status="pendente"; estoques decrementados em transação
```

Atualizar status:
```bash
curl -X PATCH http://localhost:3000/api/pedidos/1/status \
  -H "Authorization: Bearer $TOKEN_AGR" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmado"}'
```

### Avaliações

Avaliar (só após pedido `entregue`):
```bash
curl -X POST http://localhost:3000/api/avaliacoes \
  -H "Authorization: Bearer $TOKEN_CLI" \
  -H "Content-Type: application/json" \
  -d '{"agricultor_id":1,"pedido_id":1,"nota":5,"comentario":"Excelente!"}'
# 200 → avaliação. POST de novo do mesmo cliente faz upsert (atualiza)
```

Listar avaliações de um agricultor:
```bash
curl http://localhost:3000/api/agricultores/1/avaliacoes
# 200 → { items:[...], resumo:{ media:4.7, total:23 } }
```

---

## f) Fluxo end-to-end de teste manual

Sequência que prova o sistema inteiro funcionando. Use dois terminais ou guarde os tokens em variáveis. Substitua `:agr` e `:cli` pelos ids retornados nos passos 1 e 2 (provavelmente `1` e `2`). Substitua `:prod`, `:msg`, `:pedido` da mesma forma conforme as respostas.

```bash
BASE=http://localhost:3000/api

# 1. Registrar agricultor
curl -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"nome":"Sítio Boa Terra","email":"agr@x.com","senha":"senha123","role":"agricultor"}'

# 2. Registrar cliente
curl -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"nome":"Maria Silva","email":"cli@x.com","senha":"senha123","role":"cliente"}'

# 3. Login agricultor → guardar token
TOKEN_AGR=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"agr@x.com","senha":"senha123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 4. Agricultor edita perfil
curl -X PATCH $BASE/agricultores/me \
  -H "Authorization: Bearer $TOKEN_AGR" -H "Content-Type: application/json" \
  -d '{"descricao":"Hortaliças orgânicas há 20 anos","cidade":"Valinhos","estado":"SP","telefone":"19988887777"}'

# 5. Agricultor cria produto
curl -X POST $BASE/produtos \
  -H "Authorization: Bearer $TOKEN_AGR" -H "Content-Type: application/json" \
  -d '{"nome":"Alface crespa","preco":4.5,"unidade":"un","estoque":50,"categoria_id":2}'

# 6. Login cliente → guardar token
TOKEN_CLI=$(curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"cli@x.com","senha":"senha123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 7. Cliente lista agricultores
curl "$BASE/agricultores?q=boa"

# 8. Cliente vê perfil + produtos
curl $BASE/agricultores/1
curl $BASE/agricultores/1/produtos

# 9. Cliente adiciona item ao carrinho
curl -X POST $BASE/carrinho/1/itens \
  -H "Authorization: Bearer $TOKEN_CLI" -H "Content-Type: application/json" \
  -d '{"produto_id":1,"quantidade":3}'

# 10. Cliente envia carrinho como snapshot pro chat
SNAP=$(curl -s -X POST $BASE/conversas/com/1/snapshot \
  -H "Authorization: Bearer $TOKEN_CLI")
echo "$SNAP"
MSG_ID=$(echo "$SNAP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
# (o id da mensagem aparece dentro de "mensagem":{...} — ajuste o grep se necessário)

# 11. Agricultor lista conversas
curl $BASE/conversas -H "Authorization: Bearer $TOKEN_AGR"

# 12. Agricultor cria pedido a partir do snapshot (use o id da mensagem snapshot)
curl -X POST $BASE/pedidos \
  -H "Authorization: Bearer $TOKEN_AGR" -H "Content-Type: application/json" \
  -d "{\"mensagem_snapshot_id\":$MSG_ID,\"forma_pagamento_id\":2,\"observacoes\":\"Trazer sacolas\"}"

# Marca como entregue (necessário para o passo 13)
curl -X PATCH $BASE/pedidos/1/status -H "Authorization: Bearer $TOKEN_AGR" \
  -H "Content-Type: application/json" -d '{"status":"confirmado"}'
curl -X PATCH $BASE/pedidos/1/status -H "Authorization: Bearer $TOKEN_AGR" \
  -H "Content-Type: application/json" -d '{"status":"entregue"}'

# 13. Cliente avalia agricultor
curl -X POST $BASE/avaliacoes \
  -H "Authorization: Bearer $TOKEN_CLI" -H "Content-Type: application/json" \
  -d '{"agricultor_id":1,"pedido_id":1,"nota":5,"comentario":"Produtos fresquinhos!"}'

# Verificar média no perfil do agricultor
curl $BASE/agricultores/1
```

---

## g) Troubleshooting

**Porta 3000 ocupada (`EADDRINUSE`)**
Edite `.env` e mude `PORT=3001` (ou outro). Reinicie com `npm run dev`.

**"Não foi possível iniciar o backend com MongoDB" logo no start**
O servidor explica a causa provável na linha seguinte. As mais comuns: IP não liberado no Atlas (**Network Access → Add Current IP Address**), senha errada no `MONGO_URI` ou `MONGO_URI` vazio no `.env`. Rode `npm run db:check` para o diagnóstico completo.

**Token expirado (401 com `code: TOKEN_EXPIRED`)**
Faça login de novo para obter um novo token. O default é 240 horas; pode aumentar em `JWT_EXPIRES_IN`.

**Erro de CORS no frontend**
O CORS já vem habilitado pra qualquer origem (`cors({ origin: true })`). Se ainda falhar, é porque o frontend está chamando outro host/porta sem `Authorization` corretamente formatado — confira com a aba Network do navegador se o header `Authorization: Bearer ...` está sendo enviado.

**Quero começar do zero**
`npm run db:reset -- --confirmar` apaga todos os dados do banco `farm` no Atlas e recria as coleções vazias. Atenção: o banco é online e compartilhado.

**`Cannot find module 'mongodb'`**
Você esqueceu o `npm install`, ou ele falhou silenciosamente. Rode `npm install` de novo e olhe o output.

---

## h) Próximos passos

O frontend será integrado na **Fase 4**. Por ora, basta que esta API esteja rodando e os endpoints respondendo conforme o `API.md`. Nada a fazer aqui ainda.

---

## Tabela RF × Endpoints (referência rápida)

| RF | Descrição | Endpoint(s) |
|---|---|---|
| RF01 | Cadastro | `POST /api/auth/register` |
| RF02 | Login/sessão | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| RF03 | Perfil agricultor | `GET /api/agricultores/:id`, `PATCH /api/agricultores/me`, `GET /api/imagens/:id` |
| RF04 | Soft delete | `DELETE /api/produtos/:id` (e filtragem em todos os GETs) |
| RF05 | CRUD produtos | `POST /api/produtos`, `PATCH /api/produtos/:id`, `DELETE /api/produtos/:id` |
| RF06 | Categorias fixas | `GET /api/categorias` |
| RF07 | Carrinho por par | `GET/POST/PATCH/DELETE /api/carrinho/:agricultorId[/itens[/:itemId]]` |
| RF08 | Chat/snapshot | `GET /api/conversas/:id/mensagens`, `POST /api/conversas/com/:outroId/mensagens`, `POST /api/conversas/com/:agricultorId/snapshot` |
| RF09 | Busca agricultores | `GET /api/agricultores`, `GET /api/agricultores/:id` |
| RF10 | Listagem produtos | `GET /api/agricultores/:id/produtos` |
| RF11 | Avaliações | `POST /api/avaliacoes`, `GET /api/agricultores/:id/avaliacoes` |
| RF12 | Conversa única | `GET /api/conversas` (UNIQUE no schema) |
| RF13 | Pedido via snapshot | `GET /api/formas-pagamento`, `POST /api/pedidos`, `GET /api/pedidos[/:id]`, `PATCH /api/pedidos/:id/status` |
