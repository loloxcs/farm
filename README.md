# FarmDirect — Marketplace de Agricultura Familiar

Site onde **pequenos agricultores vendem direto para clientes da região**. O cliente monta um carrinho, combina tudo pelo chat com o agricultor, paga direto para ele e recebe em casa ou retira no local. No site o projeto aparece com o nome **Roça**.

Projeto Integrador — Sistemas de Informação.

| | |
|---|---|
| **Frontend** | HTML + CSS + JavaScript puro (sem framework, sem build) |
| **Backend** | Node.js + Express (API REST) |
| **Banco de dados** | MongoDB Atlas (online) |
| **Login** | JWT (token guardado no navegador) |

---

## 1. Rodar em 5 minutos

### Você precisa de

- **Node.js 20 ou 22** — confira com `node -v`. ([nodejs.org](https://nodejs.org), versão LTS)
- **Uma string de conexão do MongoDB Atlas** (a `MONGO_URI`). Se você é do grupo, peça para alguém do time por mensagem privada. Se é de fora, crie a sua de graça — [passo a passo aqui](#como-criar-o-seu-banco-no-mongodb-atlas-grátis).

### Passo a passo

**1) Baixe o projeto**

```bash
git clone https://github.com/loloxcs/farm.git
cd farm
```

**2) Crie o arquivo de configuração `backend/.env`**

```bash
cp .env.example backend/.env        # Windows: copy .env.example backend\.env
```

Abra `backend/.env` e preencha duas linhas:

```dotenv
JWT_SECRET=qualquer-texto-longo-e-aleatorio-inventado-por-voce
MONGO_URI=mongodb+srv://usuario:senha@seu-cluster.mongodb.net/
```

> O `backend/.env` guarda a senha do banco e **não vai para o Git** (está no `.gitignore`). Nunca cole a `MONGO_URI` real em outro arquivo.

**3) Instale, prepare o banco e ligue o servidor**

```bash
cd backend
npm install          # baixa as dependências (só na primeira vez)
npm run db:setup     # cria as coleções no MongoDB (não apaga nada; pode rodar sempre)
npm run dev          # liga o servidor
```

Quando aparecer `Site:  http://localhost:3000`, está no ar.

**4) Abra o site:** **http://localhost:3000**

Para desligar: `Ctrl+C` no terminal.

> **Atalho (Mac/Linux):** depois do passo 2, `./run.sh` na raiz faz o passo 3 inteiro sozinho. (Na primeira vez: `chmod +x run.sh reset.sh`.)

### Deu erro?

O servidor explica a causa provável na própria mensagem. Para um diagnóstico completo do banco:

```bash
cd backend
npm run db:check
```

Os erros mais comuns estão em [Problemas comuns](#7-problemas-comuns).

### Como criar o seu banco no MongoDB Atlas (grátis)

1. Crie uma conta em [mongodb.com/atlas](https://www.mongodb.com/atlas) e um cluster **gratuito (M0)**.
2. **Database Access** → *Add New Database User* → escolha usuário e senha → papel **Read and write to any database**.
3. **Network Access** → *Add IP Address* → **Add Current IP Address**. (Sem isso o servidor não consegue conectar.)
4. **Database → Connect → Drivers** → copie a string `mongodb+srv://...` e troque `<password>` pela senha do passo 2.
5. Cole essa string em `MONGO_URI` no `backend/.env`.

Não precisa criar nada dentro do banco: o `npm run db:setup` cria tudo.

---

## 2. Testar o site (roteiro de 5 minutos)

Você precisa de **duas contas**, uma de cada tipo. Use uma janela normal e uma **janela anônima** para ficar logado nas duas ao mesmo tempo.

| # | Quem | O que fazer |
|---|---|---|
| 1 | Agricultor | **Cadastrar** como agricultor → em **Meu perfil**, marque as formas de pagamento que aceita e informe a chave PIX → em **Meus produtos**, cadastre um produto com estoque. |
| 2 | Cliente | **Cadastrar** como cliente → **Agricultores** → abra o agricultor → **Adicionar ao carrinho**. |
| 3 | Cliente | **Ver carrinho** → escolha **como quer pagar** → **Enviar para o agricultor**. O carrinho vai para o chat. |
| 4 | Agricultor | **Conversas** → abra a conversa → **Gerar pedido** (escolhe entrega ou retirada, data e local). Depois, na tela do pedido, **Confirmar pedido**. |
| 5 | Cliente | No chat aparece **Pagar agora** → faça o PIX na chave mostrada → **Já fiz o PIX**. |
| 6 | Agricultor | No chat ou no pedido: **Confirmar recebimento** → depois **Marcar como entregue**. |
| 7 | Cliente | **Avaliar** o agricultor. |

Cada passo gera uma mensagem automática no chat entre os dois.

Prefere um teste automático? Ele percorre esse fluxo inteiro (34 verificações) em um banco temporário, que é apagado no final:

```bash
cd backend
npm run test:fluxo
```

---

## 3. Como o sistema funciona

### Visão geral

```
 Navegador                      Servidor (Node.js)                 Nuvem
┌──────────────────┐  HTTP/JSON  ┌───────────────────────┐        ┌───────────────┐
│ frontend/        │ ──────────► │ backend/server.js     │ ─────► │ MongoDB Atlas │
│ telas em JS puro │ ◄────────── │ rotas em /api/...     │ ◄───── │ banco "farm"  │
└──────────────────┘             └───────────────────────┘        └───────────────┘
```

- O **frontend** é uma página só (`index.html`). O JavaScript troca a tela conforme o endereço depois do `#` (ex.: `#/pedidos/3`). Toda conversa com o servidor passa por `frontend/api.js`.
- O **backend** recebe as chamadas em `/api/...`, confere quem está logado, aplica as regras e grava no MongoDB. Ele também entrega os arquivos do site, por isso basta um servidor.
- O **banco** fica no MongoDB Atlas. Nada é guardado no computador.

### Dois tipos de usuário

| | Cliente | Agricultor |
|---|---|---|
| Faz | busca agricultores, monta carrinho, **escolhe a forma de pagamento**, paga, avalia | cadastra produtos e estoque, gera e confirma pedidos, **confirma o recebimento**, entrega |
| Não faz | não cadastra produtos | não compra, não escolhe a forma de pagamento do cliente |

### O caminho de uma compra

```
Cliente monta o carrinho e escolhe a forma de pagamento
        │  envia pelo chat
        ▼
Agricultor gera o pedido ............ pedido: PENDENTE     (o estoque já é reservado)
        │  confirma
        ▼
Pedido confirmado ................... pedido: CONFIRMADO   (cliente já pode pagar)
        │  cliente paga e avisa
        ▼
Agricultor confirma o recebimento ... pagamento: APROVADO
        │  entrega ou cliente retira
        ▼
Pedido concluído .................... pedido: ENTREGUE     (cliente pode avaliar)
```

Cancelar um pedido devolve o estoque.

### Pagamento

O dinheiro vai **direto do cliente para o agricultor** — o site não cobra nem movimenta dinheiro; ele registra a escolha e a confirmação de cada lado.

| Forma | Como funciona |
|---|---|
| **PIX / transferência** | Cliente paga no banco dele e clica em "Já fiz o PIX". O agricultor confirma que recebeu — ou avisa que não localizou, e o cliente informa de novo. |
| **Dinheiro** | Cliente avisa que paga na entrega ou retirada. Ao marcar o pedido como entregue, o agricultor confirma o recebimento junto. |
| **Cartão** | **Simulação acadêmica**: aprovado na hora, nada é cobrado. |

Situações do pagamento: `aguardando_confirmacao` · `pagar_na_entrega` · `aprovado` · `recusado` · `cancelado`.

---

## 4. Onde fica cada coisa no código

```
farm/
├── README.md              ← este arquivo
├── .env.example           ← modelo do arquivo de configuração
├── run.sh / reset.sh      ← atalhos para ligar tudo / apagar os dados e ligar
│
├── backend/               ← servidor (API)
│   ├── server.js          ← ponto de entrada: liga o servidor e registra as rotas
│   ├── API.md             ← documentação de todas as rotas da API
│   ├── routes/            ← uma rota = um arquivo por assunto
│   ├── utils/             ← regras e funções de apoio
│   ├── middleware/        ← login, permissão por tipo de usuário e tratamento de erros
│   ├── db/                ← conexão com o MongoDB e scripts do banco
│   └── scripts/           ← teste automático
│
└── frontend/              ← site
    ├── index.html         ← a única página HTML
    ├── main.js            ← lista de telas (rotas) e o menu do topo
    ├── api.js             ← todas as chamadas ao servidor
    ├── pages/             ← uma tela = um arquivo
    └── styles.css         ← todo o visual
```

### Backend, arquivo por arquivo

| Arquivo | O que faz |
|---|---|
| `server.js` | Liga o Express, registra as rotas em `/api/...` e entrega os arquivos do site. |
| `routes/mongo-auth.js` | Cadastro, login e "quem sou eu". |
| `routes/mongo-agricultores.js` | Lista e perfil de agricultores; edição do próprio perfil (inclui chave PIX e formas aceitas). |
| `routes/mongo-produtos.js` | Produtos de cada agricultor (criar, editar, remover) e fotos. |
| `routes/mongo-catalogos.js` | Listas fixas: categorias e formas de pagamento. |
| `routes/mongo-carrinho.js` | Carrinho do cliente com cada agricultor. |
| `routes/mongo-conversas.js` | Chat e envio do carrinho pelo chat (com a forma de pagamento escolhida pelo cliente). |
| `routes/mongo-pedidos.js` | Pedidos, mudança de status e **pagamento**. |
| `routes/mongo-avaliacoes.js` | Avaliações dos agricultores. |
| `utils/pagamentos.js` | **Regras do pagamento**: formas, situações e o que cada lado pode fazer. |
| `utils/mensagens-sistema.js` | Textos das **mensagens automáticas** do chat. |
| `utils/validacao.js`, `utils/senha.js`, `utils/mongo-helpers.js`, `utils/imagens-mongo.js` | Validações, criptografia de senha, apoio às rotas e gravação de fotos. |
| `middleware/auth.js` | Confere o token de login (JWT). |
| `middleware/role.js` | Restringe uma rota a clientes ou a agricultores. |
| `middleware/error.js` | Padroniza as respostas de erro: `{ error: { code, message } }`. |
| `db/mongodb.js` | **Conexão** com o banco e definição das coleções e índices. |
| `db/*-mongo.js` | Scripts de linha de comando do banco (veja [Comandos](#6-comandos)). |
| `scripts/teste-fluxo.js` | Teste automático do sistema inteiro. |

### Frontend, arquivo por arquivo

| Arquivo | Tela / função | Endereço |
|---|---|---|
| `pages/login.js`, `pages/registro.js` | Entrar e cadastrar | `#/login`, `#/registro` |
| `pages/agricultores-lista.js` | Busca de agricultores | `#/agricultores` |
| `pages/agricultor-perfil.js` | Perfil público, produtos e avaliações | `#/agricultores/:id` |
| `pages/carrinho.js` | Carrinho e **escolha da forma de pagamento** | `#/carrinho/:agricultorId` |
| `pages/conversas-lista.js`, `pages/conversa.js` | Chat (inclui os cartões automáticos) | `#/conversas`, `#/conversas/:id` |
| `pages/modal-gerar-pedido.js` | Janela em que o agricultor gera o pedido | (abre dentro do chat) |
| `pages/pedidos-lista.js`, `pages/pedido-detalhe.js` | Pedidos, com o bloco de pagamento dos dois lados | `#/pedidos`, `#/pedidos/:id` |
| `pages/pagamento.js` | Pagamento do pedido (cliente) | `#/pedidos/:id/pagamento` |
| `pages/modal-avaliacao.js` | Janela de avaliação | (abre dentro do pedido) |
| `pages/meu-perfil.js`, `pages/meus-produtos.js` | Área do agricultor | `#/meu-perfil`, `#/meus-produtos` |
| `main.js` | Liga cada endereço à sua tela e desenha o menu | |
| `router.js` | Lê o endereço depois do `#` e chama a tela certa | |
| `api.js` | Uma função para cada rota do servidor | |
| `auth.js` | Guarda o login no navegador | |
| `ui.js`, `pagamento-ui.js` | Peças reutilizadas (botões, avisos, formatação de preço e data, selos de pagamento) | |

### Quero mudar...

| O quê | Onde |
|---|---|
| O texto ou os campos de uma tela | `frontend/pages/<tela>.js` |
| Cores, fontes, espaçamentos | `frontend/styles.css` (as cores ficam no topo, em `:root`) |
| Uma regra do pagamento | `backend/utils/pagamentos.js` |
| O texto de uma mensagem automática do chat | `backend/utils/mensagens-sistema.js` |
| Uma rota da API (ou criar uma nova) | `backend/routes/mongo-<assunto>.js`; rota nova também entra em `backend/server.js` e em `frontend/api.js` |
| Categorias ou formas de pagamento | listas no topo de `backend/db/mongodb.js` |
| O endereço do servidor que o site usa | `BASE_URL` no topo de `frontend/api.js` |

### Convenções do código

- **Ids numéricos (1, 2, 3...)** em vez dos ids padrão do MongoDB. A numeração vem da coleção `contadores` (função `nextId` em `db/mongodb.js`).
- **Remover não apaga**: um produto removido ganha uma data em `deleted_at` e some das listas, mas continua no banco (os pedidos antigos ainda apontam para ele).
- **Datas** são gravadas como texto no formato ISO (`2026-10-05T18:00:00.000Z`).
- **Transações**: gerar ou cancelar um pedido mexe em estoque e pedido juntos, ou não mexe em nada.
- **Frontend sem `innerHTML`** com dados do servidor: as telas são montadas com a função `el()` de `ui.js`, o que evita injeção de código.

---

## 5. Banco de dados

Banco `farm` no MongoDB Atlas. As coleções são criadas automaticamente pelo `npm run db:setup`.

| Coleção | O que guarda |
|---|---|
| `usuarios` | Clientes e agricultores: cadastro e senha criptografada. O perfil do agricultor (cidade, chave PIX, formas aceitas, nota) fica dentro, em `perfil`. |
| `produtos` | Produtos de cada agricultor, com preço e **estoque**. |
| `imagens` | Fotos de perfil e de produto. |
| `categorias`, `formas_pagamento` | Listas fixas. |
| `carrinhos` | Um carrinho por par cliente–agricultor, com os itens dentro. |
| `conversas`, `mensagens` | Chat: textos, carrinhos enviados e mensagens automáticas. |
| `pedidos` | Pedidos, com os itens dentro. |
| `pagamentos` | Um pagamento por pedido, com histórico. |
| `avaliacoes` | Nota e comentário do cliente sobre o agricultor. |
| `contadores` | Numeração dos ids de cada coleção. |

Para olhar os dados, use o [MongoDB Compass](https://www.mongodb.com/products/tools/compass) com a mesma `MONGO_URI`.

---

## 6. Comandos

Todos rodam dentro de `backend/`.

| Comando | O que faz | Apaga dados? |
|---|---|---|
| `npm run dev` | Liga o servidor e reinicia sozinho quando um arquivo muda. | não |
| `npm start` | Liga o servidor sem reinício automático. | não |
| `npm run db:setup` | Cria coleções, índices e listas fixas que faltarem. | não |
| `npm run db:check` | **Diagnóstico**: conexão, coleções, índices e contadores. | não |
| `npm run test:fluxo` | **Teste automático** em banco temporário. | não |
| `npm run db:reset -- --confirmar` | Apaga **tudo** e recria vazio. | **SIM** |

Na raiz (Mac/Linux): `./run.sh` liga tudo sem apagar nada; `./reset.sh` apaga os dados (pede confirmação) e liga tudo.

> ⚠️ O banco é online. `db:reset` e `./reset.sh` apagam os dados de **todo mundo** que usa a mesma `MONGO_URI`.

---

## 7. Problemas comuns

| O que aparece | O que fazer |
|---|---|
| "Não consegui chegar no cluster" | Seu IP não está liberado: Atlas → **Network Access → Add Current IP Address**. Também acontece com cluster pausado ou rede que bloqueia o banco (teste no 4G). |
| "O Atlas recusou o usuário/senha" | A senha na `MONGO_URI` não é a do usuário em Atlas → **Database Access**. |
| "MONGO_URI não está definida" | Falta criar ou preencher o `backend/.env` (passo 2). O arquivo precisa estar **dentro de `backend/`**. |
| `npm install` falha em `better-sqlite3` | Use o Node 22 (LTS) ou rode `npm install --ignore-scripts`. Esse pacote só serve para migrar o banco antigo; o servidor não usa. |
| `EADDRINUSE ... :3000` | Já tem um servidor ligado nessa porta. Feche o outro terminal, ou: `lsof -ti :3000 \| xargs kill` (Mac/Linux). |
| Site abre, mas dá erro ao entrar ou listar | O servidor não está ligado. Confira `http://localhost:3000/api/health`. |
| Tela antiga depois de mudar o código | Atualize sem cache: **Ctrl+Shift+R** (Mac: Cmd+Shift+R). |
| Fui deslogado sozinho | O login vale 10 dias, e trocar o `JWT_SECRET` desloga todo mundo. É só entrar de novo. |

---

## 8. Mais documentação

- [`backend/API.md`](backend/API.md) — todas as rotas da API, com exemplos de envio e resposta.
- [`backend/README.md`](backend/README.md) — detalhes do servidor e exemplos com `curl`.
- [`frontend/README.md`](frontend/README.md) — detalhes das telas.

### Arquivos antigos (pode ignorar)

O projeto começou com um banco local (SQLite) e foi migrado para o MongoDB. Estes arquivos são dessa fase, **não são usados pelo servidor** e ficaram só como referência: `backend/routes/` **sem** o prefixo `mongo-` (`auth.js`, `pedidos.js`, `pagamentos.js`...), `backend/db/connection.js`, `init.js`, `schema.sql`, `seeds.sql`, `backend/utils/imagens.js` e `backend/database.sqlite*`. O script `npm run db:migrate` copia os dados desse banco antigo para o MongoDB, uma única vez.
