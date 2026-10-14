FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS base
WORKDIR /workspace
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TEAM_CONTAINER=1

FROM base AS inspect-proxy
COPY etl/team_inspect_proxy.py /workspace/etl/team_inspect_proxy.py
ENTRYPOINT ["python", "/workspace/etl/team_inspect_proxy.py"]

FROM base AS worker
COPY etl/requirements.txt /workspace/etl/requirements.txt
RUN pip install --no-cache-dir -r /workspace/etl/requirements.txt
COPY etl/app /workspace/etl/app
COPY etl/demo_worker.py etl/demo_safety.py etl/team_data.py etl/team_guard.py etl/team_db.py etl/team_checks.py /workspace/etl/
COPY data/manifest.json data/release.json /workspace/data/
COPY backend/src/main/resources/db/migration /workspace/backend/src/main/resources/db/migration
ENTRYPOINT ["python", "/workspace/etl/team_db.py"]
