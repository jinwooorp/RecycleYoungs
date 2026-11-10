FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --global npm@11.19.1 && npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src ./src
# Vite가 번들에 포함하는 브라우저 공개용 JavaScript 키만 받는다.
ARG VITE_KAKAO_MAP_APP_KEY=""
RUN npm run build

FROM ghcr.io/nginx/nginx-unprivileged:stable-bookworm
COPY --from=build /app/dist/ /usr/share/nginx/html/
