# Painel do SaaS Pontual: API + tela. Só conversa com a API do Pontual
# (rotas da plataforma); não precisa de acesso ao Docker do servidor
FROM node:22-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY . .
RUN yarn build

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data

EXPOSE 4000

CMD ["yarn", "-s", "start"]
