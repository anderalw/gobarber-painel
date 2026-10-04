# Painel Pontual (SaaS)

O painel de controle do Pontual. Serve para:

- cadastrar cada barbearia (ela nasce no ar, com endereço próprio);
- configurar o domínio próprio dela;
- acompanhar o uso;
- controlar a mensalidade que ela paga a você;
- gerar e restaurar backups.

Só o dono do SaaS entra nele.

## Como funciona

```
                  ┌──────────────── servidor (um docker compose) ─────────────────┐
 ze.seu.app ────► │ Caddy (80/443) ─► site ─► API do Pontual ─► Postgres/Mongo/Redis
 cia.com.br ────► │      │                       ▲
 painel.seu.app ► │      └──────────► painel ────┘ (rotas da plataforma)
                  └────────────────────────────────────────────────────────────────┘
```

- **Uma instalação para todas as barbearias.** A API do Pontual descobre a
  barbearia pelo endereço:
  - `<identificador>.BASE_DOMAIN`;
  - ou o domínio próprio dela.

  O Postgres isola os dados: cada linha tem a barbearia, e o banco só mostra
  as da barbearia da requisição (RLS).
- **O painel não mexe no Docker.** Ele conversa com a API pelas rotas da
  plataforma (`/internal`, protegidas pelo `PLATFORM_TOKEN`):
  - criar, suspender, reativar e excluir;
  - domínio próprio;
  - uso de cada barbearia;
  - backup e importação.

  O painel guarda só a cobrança e as anotações (`data/painel.db`, SQLite).
- **HTTPS sob demanda.** O Caddy emite o certificado de cada endereço no
  primeiro acesso, depois de perguntar à API se ele é de uma barbearia
  cadastrada. Barbearia nova ou domínio novo não precisam de configuração no
  servidor.
- **Atualizar a versão** atualiza todas as barbearias de uma vez:

  ```bash
  docker compose -f infra/docker-compose.yml pull
  docker compose -f infra/docker-compose.yml up -d
  ```

  As migrations rodam ao subir a API.

## No servidor

1. **DNS:**
   - `*.seudominio.com.br` e `painel.seudominio.com.br` apontando para o IP
     do servidor.
   - Domínio próprio de uma barbearia: um CNAME (ou registro A) para o
     servidor. Depois, configure o domínio na página dela no painel.
2. **`.env`** (a partir do `.env.example`):
   - `BASE_DOMAIN`;
   - `PANEL_DOMAIN`;
   - `ACME_EMAIL`;
   - as senhas e os segredos (`openssl rand -hex 32`).
3. **Imagens privadas:** faça antes `docker login ghcr.io`.
4. **Suba tudo:**

```bash
docker compose -f infra/docker-compose.yml up -d
```

O painel abre em `https://painel.seudominio.com.br`.

O Let's Encrypt emite até 50 certificados novos por semana para o mesmo
domínio. Com mais barbearias novas que isso por semana, troque os
certificados por subdomínio por um certificado curinga (`*.seudominio`),
que exige o desafio por DNS.

## Testar no computador

**A instalação inteira**, sem HTTPS. No `.env`:

- `CADDYFILE=Caddyfile.local`;
- `PUBLIC_HTTP_PORT=8088` (se a 80 estiver ocupada);
- `TENANT_WEB_URL=http://{host}:8088`.

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

O painel abre em `http://painel.localhost:8088`. Cada barbearia fica em
`http://<identificador>.localhost:8088`, porque o navegador entende
`*.localhost` como o próprio computador.

**Só o painel, com recarga**, com a API do Pontual rodando em
`localhost:3333` e o mesmo `PLATFORM_TOKEN` nos dois `.env`:

```bash
yarn install
yarn dev   # painel em http://localhost:4001
```

## Página de divulgação e teste grátis

O domínio principal (`SITE_DOMAIN`, ou o `BASE_DOMAIN` se vazio, e o `www.`)
abre a página de divulgação do Pontual, servida pelo próprio painel:

- o que o sistema faz, para quais ramos, telas de exemplo, preço e dúvidas;
- **cadastro em dois passos**: primeiro a conta (nome, e-mail, WhatsApp e
  senha); depois, na área do cliente (`/conta`), o ramo, o nome e o endereço
  (`<identificador>.BASE_DOMAIN`). O negócio nasce no ar na hora, com os
  serviços de exemplo do ramo, e a pessoa entra nele com o mesmo e-mail e a
  mesma senha da conta. Na área ela acompanha o teste e os links do sistema;
- no painel, o negócio aparece como "cadastro pela página" (com o WhatsApp do
  responsável) e as contas que ainda não criaram o negócio aparecem em
  "Cadastros sem negócio";
- **fim do teste**: sem pagamento registrado até o fim dos dias grátis, o
  negócio é suspenso sozinho (os dados ficam). Registrar o pagamento e
  reativar no painel devolve o acesso.

Ajustes no `.env`: `SIGNUP_ENABLED`, `SIGNUP_TRIAL_DAYS`, `SIGNUP_PRICE_CENTS` e
`TRIAL_AUTO_SUSPEND`. Contra abuso: limite de cadastros por IP e por hora e um
campo escondido para robôs. Em desenvolvimento, a página abre em
`http://localhost:4001/divulgacao`.

## Backups e importação

**Gerar backup**, na página da barbearia, cria um `.tar.gz` só daquela
barbearia, guardado no painel. Ele tem:

- os dados;
- as notificações;
- as fotos;
- o segredo das integrações (maquininha, WhatsApp).

**Nova barbearia → Importar de um backup** cria a barbearia com os dados do
arquivo. Os logins e senhas continuam os mesmos. Aceita:

- os backups do painel;
- o backup de uma instalação antiga, de uma barbearia só
  (`node scripts/exportar-backup.mjs` na pasta do backend). As notificações
  antigas não vêm junto.

Barbearias do modelo antigo, com contêineres próprios, aparecem como
**Modelo antigo**. Gere o backup delas e importe-o com o mesmo identificador.

**Guarde os backups como uma senha:** eles têm todos os dados da barbearia.

O que precisa de backup no servidor:

- os volumes `postgres-data`, `mongo-data` e `files` (todas as barbearias);
- o volume `panel-data` (cobrança e os backups gerados).

Por exemplo, o banco inteiro:

```bash
docker compose -f infra/docker-compose.yml exec postgres pg_dump -U postgres gostack_gobarber > pontual.sql
```

## Limites desta versão

- **Fuso horário:** todas as barbearias da instalação usam o mesmo fuso
  (`TZ`).
- **Login com Google:** o Google exige cadastrar cada endereço (origem) no
  client id. Com muitos subdomínios, só vale para quem você cadastrar lá.

## Segurança

- O painel só fala com a API (token da plataforma): não tem acesso ao Docker
  nem ao servidor. Use uma senha forte e deixe o painel só no seu domínio.
- O login trava por alguns minutos depois de 5 tentativas erradas.
- As rotas da plataforma não passam pelo site: o nginx dele devolve 404 em
  `/api/internal`.

## Comandos

| Comando | Para quê |
| --- | --- |
| `yarn dev` | Painel (4000) + tela (4001) com recarga |
| `yarn test` | Testes (cobrança, identificador) |
| `yarn build` | Tipos + build da tela |
| `yarn start` | Produção (serve a tela do build) |
