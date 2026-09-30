# Painel do SaaS GoBarber: API + tela, com o cliente do Docker para criar os
# ambientes das barbearias (o socket do Docker vem do servidor)
FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-compose

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
