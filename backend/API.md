**Stack:** Node.js + Express + SQLite
**Auth:** JWT em `Authorization: Bearer <token>`
**Base URL:** `/api`
**Content-Type padrão:** `application/json` (exceto upload de imagens, que usa `multipart/form-data`)

---

## 1. Auth

### `POST /api/auth/register`
- **Auth:** pública
- **Descrição:** Cria uma conta nova como cliente ou agricultor. Quando `role='agricultor'`, cria também o registro em `perfis_agricultor` com campos vazios para preenchimento posterior.
- **Request body:**
  ```json
  {
    "nome": "Maria Silva",
    "email": "maria@email.com",
    "senha": "minhasenha123",
    "role": "cliente",
    "telefone": "11999990000"
  }
  ```
- **Response 201:**
  ```json
  {
    "token": "eyJhbGciOi...",
    "usuario": {
      "id": 7,
      "nome": "Maria Silva",
      "email": "maria@email.com",
      "role": "cliente"
    }
  }
  ```
- **Erros:**
  - `400` campos obrigatórios ausentes, email inválido, senha < 6 chars, role fora do enum
  - `409` email já cadastrado
- **RF coberto:** RF01

---

### `POST /api/auth/login`
- **Auth:** pública
- **Descrição:** Autentica via email + senha, devolve JWT.
- **Request body:**
  ```json
  { "email": "maria@email.com", "senha": "minhasenha123" }
  ```
- **Response 200:**
  ```json
  {
    "token": "eyJhbGciOi...",
    "usuario": { "id": 7, "nome": "Maria Silva", "role": "cliente" }
  }
  ```
- **Erros:**
  - `400` email/senha não enviados
  - `401` credenciais inválidas (mensagem genérica para não revelar se email existe)
- **RF coberto:** RF02

---

### `POST /api/auth/logout`
- **Auth:** qualquer logado
- **Descrição:** Endpoint de cortesia. Como JWT é stateless, o token é descartado no cliente (`localStorage.removeItem`). Servidor apenas confirma.
- **Request body:** vazio
- **Response 200:** `{ "ok": true }`
- **Erros:**
  - `401` token ausente ou inválido
- **RF coberto:** RF02

---

### `GET /api/auth/me`
- **Auth:** qualquer logado
- **Descrição:** Retorna dados do usuário do token. Útil para validar sessão ao recarregar a página.
- **Response 200:**
  ```json
  {
    "id": 7,
    "nome": "Maria Silva",
    "email": "maria@email.com",
    "role": "cliente",
    "telefone": "11999990000"
  }
  ```
- **Erros:**
  - `401` token ausente, inválido ou expirado
- **RF coberto:** RF02

---

## 2. Agricultores

### `GET /api/agricultores`
- **Auth:** pública
- **Descrição:** Lista agricultores com filtros opcionais e paginação. Usado na descoberta pelo cliente.
- **Query params:**
  - `q` — busca textual em `nome` e `descricao`
  - `cidade` — filtro exato
  - `estado` — filtro exato (UF, 2 chars)
  - `page` — default 1
  - `limit` — default 20, máx 50
- **Response 200:**
  ```json
  {
    "items": [
      {
        "id": 12,
        "nome": "Sítio Boa Terra",
        "cidade": "Valinhos",
        "estado": "SP",
        "media_avaliacoes": 4.7,
        "total_avaliacoes": 23,
        "foto_id": 88
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 134
  }
  ```
- **Erros:**
  - `400` parâmetros inválidos (limit fora do range, estado com tamanho errado)
- **RF coberto:** RF09

---

### `GET /api/agricultores/:id`
- **Auth:** pública
- **Descrição:** Retorna o perfil completo de um agricultor.
- **Response 200:**
  ```json
  {
    "id": 12,
    "nome": "Sítio Boa Terra",
    "telefone": "19988887777",
    "perfil": {
      "descricao": "Hortaliças orgânicas há 20 anos",
      "cidade": "Valinhos",
      "estado": "SP",
      "cep": "13270-000",
      "latitude": -22.97,
      "longitude": -46.99,
      "foto_id": 88,
      "media_avaliacoes": 4.7,
      "total_avaliacoes": 23
    }
  }
  ```
- **Erros:**
  - `404` agricultor não encontrado ou soft-deleted
- **RF coberto:** RF03, RF09

---

### `PATCH /api/agricultores/me`
- **Auth:** agricultor
- **Descrição:** Atualiza o próprio perfil. Apenas campos enviados são modificados.
- **Request body (todos opcionais):**
  ```json
  {
    "nome": "Sítio Boa Terra",
    "telefone": "19988887777",
    "descricao": "Hortaliças orgânicas há 20 anos",
    "cidade": "Valinhos",
    "estado": "SP",
    "cep": "13270-000",
    "latitude": -22.97,
    "longitude": -46.99,
    "foto_id": 88
  }
  ```
- **Response 200:** perfil atualizado (mesmo formato do GET)
- **Erros:**
  - `400` validação (estado com tamanho errado, lat/long fora de range, foto_id inexistente)
  - `401` não autenticado
  - `403` usuário não é agricultor
- **RF coberto:** RF03

---

## 3. Produtos

### `GET /api/agricultores/:id/produtos`
- **Auth:** pública
- **Descrição:** Lista produtos ativos de um agricultor, com filtro opcional de categoria.
- **Query params:**
  - `categoria_id` — filtro por categoria
  - `page`, `limit`
- **Response 200:**
  ```json
  {
    "items": [
      {
        "id": 301,
        "nome": "Alface crespa",
        "descricao": "Pé grande, colhida no dia",
        "preco": 4.5,
        "unidade": "un",
        "estoque": 50,
        "foto_id": 412,
        "categoria": { "id": 2, "nome": "Verduras e Folhosas" }
      }
    ],
    "page": 1, "limit": 20, "total": 17
  }
  ```
- **Erros:**
  - `404` agricultor não encontrado
- **RF coberto:** RF10

---

### `POST /api/produtos`
- **Auth:** agricultor
- **Descrição:** Cadastra um produto vinculado ao agricultor logado. Imagem é enviada via `multipart/form-data` ou referenciada por `foto_id` previamente criado.
- **Request body (multipart):**
  - `nome` (text)
  - `descricao` (text, opcional)
  - `preco` (number)
  - `unidade` (text, dentro do enum do schema)
  - `estoque` (number)
  - `categoria_id` (number)
  - `foto` (file, opcional) **ou** `foto_id` (number, opcional)
- **Response 201:** produto criado (mesmo formato do GET)
- **Erros:**
  - `400` validação (preço negativo, unidade inválida, categoria inexistente)
  - `401` não autenticado
  - `403` usuário não é agricultor
- **RF coberto:** RF05, RF06

---

### `PATCH /api/produtos/:id`
- **Auth:** agricultor (dono do produto)
- **Descrição:** Atualiza campos do produto. Apenas o agricultor que cadastrou pode editar.
- **Request body:** mesmos campos do POST, todos opcionais
- **Response 200:** produto atualizado
- **Erros:**
  - `400` validação
  - `401` não autenticado
  - `403` produto não pertence ao agricultor logado
  - `404` produto não encontrado ou soft-deleted
- **RF coberto:** RF05

---

### `DELETE /api/produtos/:id`
- **Auth:** agricultor (dono do produto)
- **Descrição:** Soft delete do produto (`deleted_at = now()`). Produto somem das listagens, mas continua referenciado em pedidos antigos.
- **Response 200:** `{ "ok": true }`
- **Erros:**
  - `401` não autenticado
  - `403` produto não pertence ao agricultor logado
  - `404` produto não encontrado
- **RF coberto:** RF04, RF05

---

### `GET /api/imagens/:id`
- **Auth:** pública
- **Descrição:** Serve o BLOB da imagem com `Content-Type` apropriado e cache headers (`ETag` baseado no id, `Cache-Control: public, max-age=31536000, immutable`). Permite uso direto em `<img src="/api/imagens/42">`.
- **Response 200:** binário da imagem
- **Erros:**
  - `404` imagem não encontrada
- **RF coberto:** RF03, RF05 (suporte)

---

## 4. Categorias e Formas de Pagamento (read-only)

### `GET /api/categorias`
- **Auth:** pública
- **Descrição:** Lista todas as categorias seed para popular dropdowns no frontend.
- **Response 200:**
  ```json
  [
    { "id": 1, "nome": "Frutas" },
    { "id": 2, "nome": "Verduras e Folhosas" }
  ]
  ```
- **Erros:** nenhum esperado
- **RF coberto:** RF06

---

### `GET /api/formas-pagamento`
- **Auth:** qualquer logado
- **Descrição:** Lista as formas de pagamento disponíveis para o agricultor escolher ao criar um pedido.
- **Response 200:**
  ```json
  [
    { "id": 1, "nome": "Dinheiro" },
    { "id": 2, "nome": "PIX" }
  ]
  ```
- **Erros:**
  - `401` não autenticado
- **RF coberto:** RF13

---

## 5. Carrinho

> Carrinho é por par `(cliente, agricultor)`, com `UNIQUE WHERE status='ativo'` no schema. Todas as rotas são na perspectiva do **cliente logado**, identificando o agricultor pelo path.

### `GET /api/carrinho/:agricultorId`
- **Auth:** cliente
- **Descrição:** Retorna o carrinho ativo do par `(cliente_logado, agricultorId)`. Se não existir, retorna um carrinho vazio sem persistir (o INSERT acontece no primeiro `addItem`).
- **Response 200:**
  ```json
  {
    "id": 42,
    "agricultor_id": 12,
    "status": "ativo",
    "itens": [
      {
        "id": 901,
        "produto_id": 301,
        "nome": "Alface crespa",
        "quantidade": 3,
        "preco_unit": 4.5,
        "subtotal": 13.5
      }
    ],
    "total": 13.5
  }
  ```
- **Erros:**
  - `401` não autenticado
  - `403` usuário não é cliente
  - `404` agricultor não encontrado
- **RF coberto:** RF07

---

### `POST /api/carrinho/:agricultorId/itens`
- **Auth:** cliente
- **Descrição:** Adiciona um item ao carrinho ativo. Cria o carrinho se não existir. Se o produto já estiver no carrinho, soma à quantidade existente. `preco_unit` é capturado do produto no momento do POST.
- **Request body:**
  ```json
  { "produto_id": 301, "quantidade": 3 }
  ```
- **Response 200:** carrinho completo (mesmo formato do GET)
- **Erros:**
  - `400` quantidade ≤ 0, produto não pertence ao agricultor da rota
  - `401` não autenticado
  - `403` usuário não é cliente
  - `404` produto não encontrado ou soft-deleted
- **RF coberto:** RF07

---

### `PATCH /api/carrinho/:agricultorId/itens/:itemId`
- **Auth:** cliente (dono do carrinho)
- **Descrição:** Atualiza quantidade de um item específico.
- **Request body:**
  ```json
  { "quantidade": 5 }
  ```
- **Response 200:** carrinho completo
- **Erros:**
  - `400` quantidade ≤ 0
  - `401` não autenticado
  - `403` item não pertence ao carrinho do cliente logado
  - `404` item não encontrado
- **RF coberto:** RF07

---

### `DELETE /api/carrinho/:agricultorId/itens/:itemId`
- **Auth:** cliente (dono do carrinho)
- **Descrição:** Remove um item do carrinho.
- **Response 200:** carrinho completo
- **Erros:**
  - `401` não autenticado
  - `403` item não pertence ao carrinho do cliente logado
  - `404` item não encontrado
- **RF coberto:** RF07

---

### `DELETE /api/carrinho/:agricultorId`
- **Auth:** cliente
- **Descrição:** Limpa o carrinho ativo (remove todos os itens, mantém o registro do carrinho).
- **Response 200:** `{ "ok": true }`
- **Erros:**
  - `401` não autenticado
  - `403` usuário não é cliente
  - `404` carrinho não existe
- **RF coberto:** RF07

---

## 6. Conversas / Chat

> Conversa é única e persistente por par `(cliente, agricultor)`. Auto-criada na primeira mensagem ou snapshot.

### `GET /api/conversas`
- **Auth:** qualquer logado
- **Descrição:** Lista as conversas do usuário logado (clientes veem suas conversas com agricultores; agricultores veem suas conversas com clientes), ordenadas pela última mensagem mais recente.
- **Response 200:**
  ```json
  [
    {
      "id": 17,
      "outro": { "id": 12, "nome": "Sítio Boa Terra", "role": "agricultor" },
      "ultima_mensagem": {
        "tipo": "texto",
        "preview": "Posso passar amanhã às 9h?",
        "created_at": "2026-05-06T14:22:31Z"
      }
    }
  ]
  ```
- **Erros:**
  - `401` não autenticado
- **RF coberto:** RF08, RF12

---

### `GET /api/conversas/:id/mensagens`
- **Auth:** qualquer logado (participante da conversa)
- **Descrição:** Retorna histórico paginado de mensagens. Sem `since`, devolve as últimas N. Com `since`, devolve apenas mensagens posteriores (usado pelo polling).
- **Query params:**
  - `since` — ISO timestamp da última mensagem conhecida (polling)
  - `limit` — default 50, máx 100 (usado quando não há `since`)
- **Response 200:**
  ```json
  {
    "mensagens": [
      {
        "id": 5012,
        "remetente_id": 7,
        "tipo": "texto",
        "conteudo": "Posso passar amanhã às 9h?",
        "snapshot_json": null,
        "carrinho_id": null,
        "created_at": "2026-05-06T14:22:31Z"
      },
      {
        "id": 5013,
        "remetente_id": 7,
        "tipo": "snapshot",
        "conteudo": null,
        "snapshot_json": {
          "itens": [
            { "produto_id": 301, "nome": "Alface crespa", "quantidade": 3, "preco_unit": 4.5 }
          ],
          "total": 13.5
        },
        "carrinho_id": 42,
        "created_at": "2026-05-06T14:23:05Z"
      }
    ],
    "server_time": "2026-05-06T14:23:08Z"
  }
  ```
  > `server_time` é o cursor que o cliente deve mandar como `since` no próximo polling.
- **Erros:**
  - `400` `since` mal formatado
  - `401` não autenticado
  - `403` usuário não participa da conversa
  - `404` conversa não encontrada
- **RF coberto:** RF08

---

### `POST /api/conversas/com/:outroId/mensagens`
- **Auth:** qualquer logado
- **Descrição:** Envia mensagem de texto para outro usuário, identificado pelo id. Cria a conversa se ainda não existir (`UNIQUE` no par garante uma só). O cliente fala com agricultor e vice-versa; servidor valida que os dois lados têm roles compatíveis.
- **Request body:**
  ```json
  { "conteudo": "Olá, vocês entregam em Campinas?" }
  ```
- **Response 201:**
  ```json
  {
    "conversa_id": 17,
    "mensagem": {
      "id": 5014,
      "tipo": "texto",
      "conteudo": "Olá, vocês entregam em Campinas?",
      "created_at": "2026-05-06T14:25:00Z"
    }
  }
  ```
- **Erros:**
  - `400` conteúdo vazio
  - `401` não autenticado
  - `403` ambos os usuários têm o mesmo role (cliente↔cliente ou agricultor↔agricultor não permitido)
  - `404` `outroId` não encontrado
- **RF coberto:** RF08, RF12

---

### `POST /api/conversas/com/:agricultorId/snapshot`
- **Auth:** cliente
- **Descrição:** Envia o carrinho ativo do par como mensagem do tipo `snapshot`. Serializa o carrinho atual em JSON imutável dentro de `mensagens.snapshot_json`, marca o carrinho como `status='snapshot_enviado'` (libera novo carrinho ativo se o cliente quiser começar outro), e cria/usa a conversa do par. **O snapshot não muda mais, mesmo se o carrinho original for alterado depois.**
- **Request body:** vazio (servidor lê o carrinho ativo do par)
- **Response 201:**
  ```json
  {
    "conversa_id": 17,
    "mensagem": {
      "id": 5015,
      "tipo": "snapshot",
      "snapshot_json": {
        "itens": [
          { "produto_id": 301, "nome": "Alface crespa", "quantidade": 3, "preco_unit": 4.5, "subtotal": 13.5 }
        ],
        "total": 13.5
      },
      "carrinho_id": 42,
      "created_at": "2026-05-06T14:30:00Z"
    }
  }
  ```
- **Erros:**
  - `400` carrinho ativo está vazio ou não existe
  - `401` não autenticado
  - `403` usuário não é cliente
  - `404` agricultor não encontrado
- **RF coberto:** RF07, RF08

---

## 7. Pedidos

### `POST /api/pedidos`
- **Auth:** agricultor
- **Descrição:** Cria um pedido a partir de uma mensagem de snapshot recebida. Apenas o **agricultor destinatário** da snapshot pode formalizar. Lê `mensagens.snapshot_json`, copia itens para `itens_pedido` (preservando preços e nomes), calcula `total`, vincula à conversa e à mensagem-fonte. Em transação: também faz `UPDATE produtos SET estoque = estoque - quantidade` para cada item.
- **Request body:**
  ```json
  {
    "mensagem_snapshot_id": 5015,
    "forma_pagamento_id": 2,
    "data_retirada": "2026-05-08T09:00:00Z",
    "observacoes": "Trazer sacolas reutilizáveis"
  }
  ```
- **Response 201:**
  ```json
  {
    "id": 88,
    "conversa_id": 17,
    "cliente_id": 7,
    "agricultor_id": 12,
    "status": "pendente",
    "total": 13.5,
    "forma_pagamento": { "id": 2, "nome": "PIX" },
    "data_retirada": "2026-05-08T09:00:00Z",
    "itens": [
      { "produto_id": 301, "nome_produto": "Alface crespa", "quantidade": 3, "preco_unit": 4.5, "subtotal": 13.5 }
    ],
    "created_at": "2026-05-06T14:35:00Z"
  }
  ```
- **Erros:**
  - `400` mensagem não é do tipo snapshot, snapshot já virou pedido, estoque insuficiente em algum item, forma_pagamento_id inválida
  - `401` não autenticado
  - `403` agricultor não é o destinatário da snapshot
  - `404` mensagem ou forma de pagamento não encontrada
- **RF coberto:** RF13

---

### `GET /api/pedidos`
- **Auth:** qualquer logado
- **Descrição:** Lista pedidos do usuário logado. Cliente vê os seus; agricultor vê os recebidos. Filtro opcional por status.
- **Query params:**
  - `status` — `pendente` | `confirmado` | `entregue` | `cancelado`
  - `page`, `limit`
- **Response 200:**
  ```json
  {
    "items": [ /* mesmo formato do POST */ ],
    "page": 1, "limit": 20, "total": 5
  }
  ```
- **Erros:**
  - `401` não autenticado
- **RF coberto:** RF13

---

### `GET /api/pedidos/:id`
- **Auth:** qualquer logado (cliente ou agricultor do pedido)
- **Descrição:** Detalha um pedido específico.
- **Response 200:** mesmo formato do POST
- **Erros:**
  - `401` não autenticado
  - `403` usuário não é parte do pedido
  - `404` pedido não encontrado
- **RF coberto:** RF13

---

### `PATCH /api/pedidos/:id/status`
- **Auth:** qualquer logado (com regras por role)
- **Descrição:** Atualiza o status do pedido seguindo transições válidas:
  - **Agricultor:** `pendente → confirmado`, `confirmado → entregue`, qualquer → `cancelado`
  - **Cliente:** apenas `pendente → cancelado`
- **Request body:**
  ```json
  { "status": "confirmado" }
  ```
- **Response 200:** pedido atualizado
- **Erros:**
  - `400` transição inválida para o role do usuário, status fora do enum
  - `401` não autenticado
  - `403` usuário não é parte do pedido, ou role não autoriza a transição
  - `404` pedido não encontrado
- **RF coberto:** RF13

---

## 8. Avaliações

### `POST /api/avaliacoes`
- **Auth:** cliente
- **Descrição:** Cria ou atualiza a avaliação do cliente para um agricultor. Como há `UNIQUE(cliente_id, agricultor_id)` no schema, segundo POST do mesmo cliente para o mesmo agricultor faz `UPDATE` (upsert via `INSERT ... ON CONFLICT DO UPDATE`). O trigger do schema recalcula `media_avaliacoes` automaticamente. Requer um `pedido_id` concluído entre o par.
- **Request body:**
  ```json
  {
    "agricultor_id": 12,
    "pedido_id": 88,
    "nota": 5,
    "comentario": "Produtos fresquinhos, atendimento ótimo."
  }
  ```
- **Response 200:**
  ```json
  {
    "id": 33,
    "cliente_id": 7,
    "agricultor_id": 12,
    "pedido_id": 88,
    "nota": 5,
    "comentario": "Produtos fresquinhos, atendimento ótimo.",
    "created_at": "2026-05-06T15:00:00Z",
    "updated_at": "2026-05-06T15:00:00Z"
  }
  ```
- **Erros:**
  - `400` nota fora de 1–5, pedido não pertence ao par cliente-agricultor, pedido não está em status `entregue`
  - `401` não autenticado
  - `403` usuário não é cliente
  - `404` agricultor ou pedido não encontrado
- **RF coberto:** RF11

### `GET /api/pedidos/:id/pagamento`
- **Auth:** cliente dono do pedido
- **Descrição:** Retorna o pagamento simulado salvo na coleção `pagamentos` do banco MongoDB `farm`, ou `null` quando ainda não existe.
- **Response 200:** `{ "pagamento": { "pedido_id": 88, "metodo": "pix", "valor": 13.5, "status": "aprovado", "transacao_id": "..." } }`
- **Erros:** `401` não autenticado; `403` usuário não é o cliente do pedido; `404` pedido inexistente; `503` MongoDB não configurado ou indisponível.

### `POST /api/pedidos/:id/pagamento`
- **Auth:** cliente dono do pedido
- **Descrição:** Simula a aprovação de um pagamento para pedido confirmado ou entregue. Aceita `metodo`: `pix`, `credit_card`, `debit_card` ou `cash`; cartões também enviam `cartao_ultimos4`.
- **Persistência:** registra pedido, cliente, agricultor, método, valor, status, referência simulada e, para cartão, somente os últimos quatro dígitos. Número completo, validade, CVV e chave Pix não são enviados nem guardados.
- **Response 201:** objeto do pagamento com `status: "aprovado"` e `transacao_id`.
- **Erros:** `400` método ou metadados inválidos; `401` não autenticado; `403` pedido não pertence ao cliente; `409` pedido não confirmado ou pagamento já registrado; `503` MongoDB indisponível.
- **Observação:** pagamento acadêmico de demonstração; não processa transações reais.

---

### `GET /api/agricultores/:id/avaliacoes`
- **Auth:** pública
- **Descrição:** Lista avaliações recebidas pelo agricultor, mais recentes primeiro.
- **Query params:** `page`, `limit`
- **Response 200:**
  ```json
  {
    "items": [
      {
        "id": 33,
        "cliente": { "id": 7, "nome": "Maria Silva" },
        "nota": 5,
        "comentario": "Produtos fresquinhos, atendimento ótimo.",
        "created_at": "2026-05-06T15:00:00Z"
      }
    ],
    "page": 1, "limit": 20, "total": 23,
    "resumo": { "media": 4.7, "total": 23 }
  }
  ```
- **Erros:**
  - `404` agricultor não encontrado
- **RF coberto:** RF11

---

## Tabela resumo — RF × Endpoints

| RF | Descrição | Endpoint(s) |
|---|---|---|
| RF01 | Cadastro de usuário | `POST /api/auth/register` |
| RF02 | Login / sessão | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| RF03 | Perfil do agricultor | `GET /api/agricultores/:id`, `PATCH /api/agricultores/me`, `GET /api/imagens/:id` |
| RF04 | Soft delete | `DELETE /api/produtos/:id` (e implícito em todos os GETs filtrando `deleted_at IS NULL`) |
| RF05 | CRUD de produtos | `POST /api/produtos`, `PATCH /api/produtos/:id`, `DELETE /api/produtos/:id`, `GET /api/imagens/:id` |
| RF06 | Categorias fixas | `GET /api/categorias`, usadas em `POST/PATCH /api/produtos` |
| RF07 | Carrinho por par | `GET /api/carrinho/:agricultorId`, `POST/PATCH/DELETE /api/carrinho/:agricultorId/itens[/:itemId]`, `DELETE /api/carrinho/:agricultorId`, `POST /api/conversas/com/:agricultorId/snapshot` |
| RF08 | Chat e snapshot | `GET /api/conversas/:id/mensagens`, `POST /api/conversas/com/:outroId/mensagens`, `POST /api/conversas/com/:agricultorId/snapshot` |
| RF09 | Busca de agricultores | `GET /api/agricultores`, `GET /api/agricultores/:id` |
| RF10 | Listagem de produtos | `GET /api/agricultores/:id/produtos` |
| RF11 | Avaliações | `POST /api/avaliacoes`, `GET /api/agricultores/:id/avaliacoes` |
| RF12 | Conversa única | `GET /api/conversas`, `POST /api/conversas/com/:outroId/mensagens` (UNIQUE no schema) |
| RF13 | Pedido via snapshot | `GET /api/formas-pagamento`, `POST /api/pedidos`, `GET /api/pedidos`, `GET /api/pedidos/:id`, `PATCH /api/pedidos/:id/status`, `GET/POST /api/pedidos/:id/pagamento` |

---

## Middlewares necessários

| Middleware | Aplicado em | Função |
|---|---|---|
| `cors` | global | Permite requisições do frontend (mesmo domínio na configuração padrão; útil se separar dev/prod) |
| `express.json()` | global | Parse de body JSON |
| `multer` (memoryStorage) | rotas de upload de imagem | Recebe `multipart/form-data` e expõe o buffer para gravar BLOB no SQLite |
| `errorHandler` | global, último | Captura erros, formata como `{ error: { code, message, details? } }` e devolve status apropriado |
| `requestLogger` | global | Loga método, rota, status e tempo de resposta |
| `requireAuth` | rotas autenticadas | Valida `Authorization: Bearer <token>`, decodifica JWT e injeta `req.user = { id, role }`. Responde `401` se ausente/inválido/expirado |
| `requireRole('cliente')` | rotas exclusivas de cliente | Roda após `requireAuth`. Responde `403` se `req.user.role !== 'cliente'` |
| `requireRole('agricultor')` | rotas exclusivas de agricultor | Roda após `requireAuth`. Responde `403` se `req.user.role !== 'agricultor'` |
| `requireOwnership` | rotas que mexem em recursos do usuário (produto, item de carrinho, pedido, conversa) | Verifica no banco que o recurso pertence ao `req.user.id` (direta ou indiretamente via `agricultor_id`/`cliente_id`). Responde `403` se não for dono |
| `validateBody(schema)` | rotas de POST/PATCH | Valida o `req.body` contra um schema (ex.: Zod ou Joi). Responde `400` com `details` quando falha |
| `validateQuery(schema)` | rotas com query params | Mesmo princípio de `validateBody`, aplicado em `req.query` |
| `rateLimiter` | `POST /api/auth/login` e `POST /api/auth/register` | Limita tentativas por IP (ex.: 10/min) para mitigar brute force |

**Pipeline típico de uma rota protegida:**
`requestLogger → cors → express.json → requireAuth → requireRole → validateBody → handler → errorHandler`