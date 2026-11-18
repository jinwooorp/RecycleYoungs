#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# 실제 .env와 실행 셸의 DB·지도 설정을 Demo에 전달하지 않습니다.
export DB_NAME=recycleyoungs_demo DB_USER=recycleyoungs_demo DB_PASSWORD=demo_local_only
export VITE_KAKAO_MAP_APP_KEY=

# 같은 호스트에서 별도 Demo 볼륨과 루프백 포트를 사용할 수 있습니다.
slot=${DEMO_SLOT:-0}
case "$slot" in
    [0-9]) ;;
    *)
        printf '%s\n' 'DEMO_SLOT은 한 자리 숫자(0~9)여야 합니다.' >&2
        exit 2
        ;;
esac

project=recycleyoungs-demo
if [ "$slot" != 0 ]; then
    project="$project-$slot"
fi
export DB_PORT=$((35432 + slot)) FRONTEND_PORT=$((38081 + slot))
volume=${project}_postgres_data

compose() {
    docker compose --env-file .env.example -f docker-compose.yml -f demo/compose.yml \
        --project-name "$project" --profile full "$@"
}

check_demo_volume() {
    listed=$(docker volume ls --filter "name=^${volume}$" --format '{{.Name}}') || return 1
    if [ -z "$listed" ]; then
        return 0
    fi
    actual=$(docker volume inspect --format \
        '{{.Driver}} {{index .Labels "com.docker.compose.project"}} {{index .Labels "com.docker.compose.volume"}} {{if .Options}}custom{{else}}default{{end}}' "$volume") || return 1
    if [ "$actual" != "local $project postgres_data default" ]; then
        printf '%s\n' 'Demo 전용 볼륨의 소유 또는 마운트 설정이 예상과 달라 중단합니다.' >&2
        return 1
    fi
}

demo_container() {
    container=$(compose ps -q db) || return 1
    if [ -z "$container" ]; then
        printf '%s\n' 'Demo DB가 실행 중이어야 합니다. 먼저 demo/run.sh up을 실행하세요.' >&2
        return 1
    fi

    actual=$(docker inspect --type container --format \
        '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{range .Mounts}}{{.Type}} {{.Name}} {{.Destination}}{{end}}' "$container") || return 1
    if [ "$actual" != "$project db volume $volume /var/lib/postgresql/data" ]; then
        printf '%s\n' 'Demo 컨테이너 또는 볼륨이 예상과 달라 중단합니다.' >&2
        return 1
    fi
    printf '%s\n' "$container"
}

demo_psql() {
    docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 \
        -h /var/run/postgresql -U "$DB_USER" -d "$DB_NAME" "$@"
}

# 원격 Docker 엔진에서 Demo를 기동하거나 seed를 실행하지 않습니다.
context_endpoint=$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')
case "$context_endpoint|${DOCKER_HOST:-$context_endpoint}" in
    unix://*'|'unix://*) ;;
    *)
        printf '%s\n' 'Demo는 로컬 Unix 소켓 Docker 엔진에서만 실행합니다.' >&2
        exit 1
        ;;
esac

case "${1:-}" in
    up)
        check_demo_volume
        compose up -d --build --wait
        container=$(demo_container)
        attempts=0
        until [ "$(demo_psql -Atqc 'SELECT count(*) FROM public.flyway_schema_history WHERE success' 2>/dev/null)" = 7 ]; do
            attempts=$((attempts + 1))
            if [ "$attempts" -ge 30 ]; then
                printf '%s\n' 'Demo Flyway V1~V7 적용을 확인하지 못했습니다. demo/run.sh logs로 확인하세요.' >&2
                exit 1
            fi
            sleep 1
        done
        printf '%s\n' 'Demo 스택이 준비됐습니다. 합성 데이터를 넣으려면 demo/run.sh seed를 실행하세요.'
        ;;
    seed)
        check_demo_volume
        container=$(demo_container)
        demo_psql < demo/seed.sql
        ;;
    logs)
        compose logs --tail=80 backend
        ;;
    stop)
        compose stop
        ;;
    *)
        printf '%s\n' '사용법: demo/run.sh up|seed|logs|stop' >&2
        exit 2
        ;;
esac
