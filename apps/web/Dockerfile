FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src/ src/

# 브라우저에 공개되는 JavaScript 키만 Vite 빌드에 전달합니다.
ARG VITE_KAKAO_MAP_APP_KEY
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
# 개발용 Nginx 설정은 Compose가 읽기 전용으로 연결합니다.
COPY --from=build /app/dist/ /usr/share/nginx/html/
