# Painel GoBarber (SaaS)

O painel de controle do GoBarber. Serve para:

- cadastrar cada barbearia;
- subir o ambiente dela com um clique: site, API e bancos próprios, num endereço próprio;
- acompanhar o uso;
- controlar a mensalidade que ela paga a você.

Só o dono do SaaS entra nele.

## Como funciona

```
                 ┌──────────── servidor ─────────────────────────┐
 ze.seu.app ───► │ Caddy (80/443, HTTPS) ─► gb-ze   (site+API+bancos)
 cia.seu.app ──► │                        ─► gb-cia  (site+API+bancos)
 painel.seu.app ►│                        ─► painel ─► Docker (cria/para/atualiza)
                 └───────────────────────────────────────────────┘
```

- **Uma barbearia = um projeto do Docker** (`gb-<identificador>`), com o
  compose de `templates/tenant-compose.yml` e um `.env` gerado:
  - senhas e segredos aleatórios;
  - o primeiro administrador;
  - o fuso;
  - o token de uso.

  Os arquivos ficam em `data/tenants/<identificador>/`.
- O **Caddy** liga cada domínio ao site da barbearia, pela rede
  `gobarber-edge`, e emite os certificados HTTPS sozinho. A barbearia
  suspensa ou em preparação mostra um aviso no lugar do site.
- O **uso** (agendamentos, clientes, faturamento dos últimos 30 dias) vem
  da rota interna `/internal/metrics` do GoBarber, protegida por um token
  que só este painel conhece.
- **Operações:** criar, suspender, reativar, atualizar versão, tentar de
  novo e excluir. Rodam em segundo plano, e o registro aparece na página
  da barbearia.
- O banco do painel é um arquivo SQLite (`data/painel.db`).

## Testar no computador

Pré-requisitos: Node 22.13+, Yarn e Docker. As imagens do GoBarber
precisam estar na máquina: publicadas (`docker login ghcr.io`) ou
construídas localmente, por exemplo
`docker build -t gobarber-api:local ../backend-gobarber`.

```bash
yarn install
cp .env.example .env
# no .env: PANEL_EMAIL, PANEL_PASSWORD, SESSION_SECRET; para imagens locais:
#   API_IMAGE=gobarber-api:local  WEB_IMAGE=gobarber-web:local  PULL_IMAGES=false

docker network create gobarber-edge
docker compose -f infra/docker-compose.yml up -d caddy
yarn dev
```

Abra `http://localhost:4001`. Cada barbearia fica em
`http://<identificador>.localhost`, porque o navegador já entende
`*.localhost` como o próprio computador.

## No servidor

1. Aponte o DNS:
   - `*.seudominio.com.br` para o IP do servidor, cobrindo as barbearias;
   - `painel.seudominio.com.br` para o mesmo IP.
2. Configure o `.env`:
   - `BASE_DOMAIN=seudominio.com.br`;
   - `TLS=auto`;
   - `ACME_EMAIL=voce@...`;
   - `PANEL_DOMAIN=painel.seudominio.com.br`;
   - as imagens publicadas (`ghcr.io/...`).
3. Se as imagens forem privadas: `docker login ghcr.io`.
4. Suba tudo:

```bash
docker network create gobarber-edge
docker compose -f infra/docker-compose.yml --profile server up -d --build
```

O painel abre em `https://painel.seudominio.com.br`.

## Segurança

- O painel comanda o Docker do servidor (`/var/run/docker.sock`), o que
  equivale a acesso de administrador à máquina. Use uma senha forte, deixe o
  painel só no seu domínio e mantenha o servidor atualizado.
- O login trava por alguns minutos depois de 5 tentativas erradas.
- Os `.env` das barbearias ficam só no servidor, com permissão restrita.
  A "senha inicial" do admin é a da criação; se o cliente trocou, ela não
  vale mais.

## Backup

O que precisa de backup:

- o volume `panel-data` (banco do painel e `.env` de cada barbearia);
- os volumes `gb-<identificador>_postgres-data`, `_mongo-data` e `_files`
  de cada barbearia.

Por exemplo:

```bash
docker compose -p gb-ze exec postgres pg_dump -U postgres gostack_gobarber > ze.sql
```

## Comandos

| Comando | Para quê |
| --- | --- |
| `yarn dev` | Painel (4000) + tela (4001) com recarga |
| `yarn test` | Testes (cobrança, Caddyfile, textos) |
| `yarn build` | Tipos + build da tela |
| `yarn start` | Produção (serve a tela do build) |
