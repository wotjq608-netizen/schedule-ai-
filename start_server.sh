#!/usr/bin/env bash
set -euo pipefail
umask 077
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$SCRIPT_DIR"
if (( $# > 1 )) || [[ "${1:-}" != "" && "$1" != "--restart" ]]; then
    printf '사용법: %s [--restart]\n' "$0" >&2
    exit 2
fi
PORT=8000
HOST=127.0.0.1
DOMAIN=narnialab.duckdns.org
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
URL="https://$DOMAIN:$PORT"
PYTHON=python3
if [[ -x .venv/bin/python ]]; then PYTHON="$SCRIPT_DIR/.venv/bin/python"; fi
MODE=$("$PYTHON" -B -c 'import os; from dotenv import load_dotenv; load_dotenv(".env"); print(os.getenv("DASHBOARD_BIND", "local"))')
case "$MODE" in
    local) printf 'HTTPS 주소 %s (로컬 접속만)\n' "$URL" ;;
    public)
        HOST=0.0.0.0
        printf '공개 HTTPS 주소 %s\n' "$URL"
        ;;
    *) printf 'DASHBOARD_BIND에는 local 또는 public을 설정하세요.\n' >&2; exit 1 ;;
esac

exec 9>server.lock
flock -x 9
is_ours() {
    [[ "$1" =~ ^[0-9]+$ ]] &&
        [[ -O "/proc/$1" && "$(readlink "/proc/$1/cwd")" == "$SCRIPT_DIR" ]] &&
        grep -Fqx 'main:app' <(tr '\0' '\n' < "/proc/$1/cmdline") &&
        grep -Fqx 'uvicorn' <(tr '\0' '\n' < "/proc/$1/cmdline")
}
pid=""
if [[ -r server.pid ]]; then read -r pid < server.pid || true; fi
if [[ "${1:-}" == "--restart" ]] && is_ours "$pid"; then
    kill -TERM "$pid"
    for ((wait_attempt=0; wait_attempt<50; wait_attempt++)); do
        if ! is_ours "$pid"; then break; fi
        sleep 0.2
    done
    if is_ours "$pid"; then
        printf '기존 프로젝트 서버가 종료되지 않았습니다.\n' >&2
        exit 1
    fi
    pid=""
fi
if is_ours "$pid"; then
    if ! grep -FxA1 -- '--host' <(tr '\0' '\n' < "/proc/$pid/cmdline") | grep -Fqx "$HOST"; then
        printf '이미 실행 중인 서버의 접속 범위가 설정과 다릅니다.\n' >&2
        exit 1
    fi
    printf '실행 중 (PID %s)\n' "$pid"
elif [[ -n "$pid" && -d "/proc/$pid" ]]; then
    printf '기록된 PID가 이 프로젝트 서버인지 확인할 수 없습니다.\n' >&2
    exit 1
else
    nohup setsid "$PYTHON" -B -m uvicorn main:app --host "$HOST" --port "$PORT" --no-proxy-headers --no-access-log \
        --ssl-certfile "$CERT_DIR/fullchain.pem" --ssl-keyfile "$CERT_DIR/privkey.pem" \
        </dev/null >>server.log 2>&1 9>&- &
    pid=$!
    printf '%s\n' "$pid" > server.pid
fi

for ((attempt=0; attempt<20; attempt++)); do
    status=$(curl -sS --noproxy '*' --resolve "$DOMAIN:$PORT:127.0.0.1" --connect-timeout 1 --max-time 2 \
        -o /dev/null -w '%{http_code} %{redirect_url}' "$URL/" 2>/dev/null) || status=""
    if [[ "$status" == "401 " || "$status" == "303 $URL/login" ]] && is_ours "$pid"; then
        printf '로컬 HTTPS 확인 (PID %s, 미인증 HTTP %s)\n' "$pid" "${status%% *}"
        if [[ "$MODE" == "public" ]]; then
            for ((public_attempt=0; public_attempt<3; public_attempt++)); do
                public_status=$(curl -sS --noproxy '*' --connect-timeout 2 --max-time 4 -o /dev/null \
                    -w '%{http_code} %{redirect_url}' "$URL/" 2>/dev/null) || public_status=""
                if [[ "$public_status" == "401 " || "$public_status" == "303 $URL/login" ]]; then
                    printf '공개 HTTPS 확인 (미인증 HTTP %s)\n' "${public_status%% *}"
                    exit 0
                fi
            done
            printf '공개 HTTPS 응답 확인 실패. 본 서버의 로컬 인증 응답은 확인했습니다.\n' >&2
            exit 1
        fi
        exit 0
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
done
printf '로컬 HTTPS 응답 확인 실패. server.log를 확인하세요.\n' >&2
exit 1
