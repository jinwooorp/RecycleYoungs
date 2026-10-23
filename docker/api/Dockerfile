FROM python:3.12-slim@sha256:cb33f7f771ecec2ef1225cf39b159591a040391bd73e4c01f00fdfc4c47611d2 AS worker
WORKDIR /workspace/etl
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY etl/requirements.txt /workspace/etl/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY etl/app /workspace/etl/app
COPY etl/api_runtime.py etl/api_worker.py etl/api_snapshot.py etl/boundary_data.py etl/demo_worker.py etl/demo_safety.py /workspace/etl/
COPY etl/dev_runtime.py etl/dev_inspect.py etl/inspect_proxy.py etl/control.py /workspace/etl/
COPY data/boundaries/public-reports.json /workspace/data/boundaries/public-reports.json
COPY backend/src/main/resources/db/migration /workspace/backend/src/main/resources/db/migration
COPY backend/src/main/resources/db/api-runtime /api-schema
COPY backend/src/main/resources/db/api-migration /api-migration
ENTRYPOINT ["python", "/workspace/etl/api_worker.py"]

FROM flyway/flyway@sha256:5be18367a9b3979a9f37234c371b80da457a448fb9577bd94d4bf24d923fafac AS migrator
COPY backend/src/main/resources/db/migration /flyway/base
COPY backend/src/main/resources/db/api-migration /flyway/api
COPY docker/api/migrate.sh /migrate.sh
ENTRYPOINT ["/bin/sh", "/migrate.sh"]

FROM eclipse-temurin:21-jdk-jammy@sha256:742daacb9316be4b6fc60258f6e4ac2a11882f6c597373c92290a57bfad0d2e0 AS backend-build
WORKDIR /build
COPY backend/gradlew backend/build.gradle backend/settings.gradle /build/
COPY backend/gradle /build/gradle
COPY backend/src/main /build/src/main
RUN chmod +x gradlew && ./gradlew --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx512m bootJar -x test

FROM eclipse-temurin:21-jre-jammy@sha256:affcab5356e1270ac35d2361ee83135af2f03e8d580eca78a6d5d6fdbf048db0 AS backend
COPY --from=backend-build /build/build/libs/backend-0.0.1-SNAPSHOT.jar /service/backend.jar
ENV SPRING_PROFILES_ACTIVE=api-dev
ENTRYPOINT ["java", "-jar", "/service/backend.jar"]

FROM node:24-bookworm-slim@sha256:8cabefbd444809cf0e319b5831c65da1ea202200ca552a5e75fd7938a6f86658 AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json /build/
RUN npm ci
COPY frontend /build/
ARG PUBLIC_MAP_CONFIG_SHA256=none
# The map's browser key is public in the final JS; do not persist it in build args/history.
# The non-secret hash explicitly invalidates cache when the public configuration changes.
RUN --mount=type=secret,id=kakao_js \
    test -n "$PUBLIC_MAP_CONFIG_SHA256" && \
    if [ -f /run/secrets/kakao_js ]; then export VITE_KAKAO_MAP_APP_KEY="$(cat /run/secrets/kakao_js)"; fi && \
    npm run build

# Static artifacts only. The next nginx task will provide the HTTP entry point.
FROM scratch AS frontend
COPY --from=frontend-build /build/dist /site

FROM frontend-build AS frontend-dev
RUN chown -R 10001:10001 /build
USER 10001:10001
ENV RECYCLEYOUNGS_LOCAL_CONTAINER=1
ENTRYPOINT ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
