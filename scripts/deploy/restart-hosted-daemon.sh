#!/usr/bin/env sh
set -eu

: "${BINARY_PATH:?BINARY_PATH is required}"
: "${ENV_FILE:?ENV_FILE is required}"
: "${PID_FILE:?PID_FILE is required}"
: "${LOG_FILE:?LOG_FILE is required}"

mode="${1:-restart}"

if [ ! -r "$ENV_FILE" ]; then
  echo "Env file is missing or unreadable: $ENV_FILE" >&2
  exit 1
fi

if [ ! -x "$BINARY_PATH" ]; then
  echo "Binary is missing or not executable: $BINARY_PATH" >&2
  exit 1
fi

(set -a; . "$ENV_FILE"; : )

if [ "$mode" = "--check" ]; then
  exit 0
fi

mkdir -p "$(dirname "$PID_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE")"
  if [ -n "$old_pid" ] && [ "$old_pid" != "0" ] && kill -0 "$old_pid" 2>/dev/null; then
    old_exe="$(readlink "/proc/$old_pid/exe" 2>/dev/null || true)"
    if [ "$old_exe" = "$BINARY_PATH" ]; then
      kill "$old_pid" 2>/dev/null || true
    fi
  fi
fi

pgrep -u "$(id -un)" -f "^$BINARY_PATH$" | while read -r old_pid; do
  kill "$old_pid" 2>/dev/null || true
done

for _ in 1 2 3 4 5; do
  if pgrep -u "$(id -un)" -f "^$BINARY_PATH$" >/dev/null 2>&1; then
    sleep 1
  else
    break
  fi
done

pgrep -u "$(id -un)" -f "^$BINARY_PATH$" | while read -r old_pid; do
  kill -KILL "$old_pid" 2>/dev/null || true
done

set -a
. "$ENV_FILE"
MCP2CLI_DAEMON=1
MCP2CLI_LISTEN_HOST="${MCP2CLI_LISTEN_HOST:-0.0.0.0}"
MCP2CLI_LISTEN_PORT="${MCP2CLI_LISTEN_PORT:-9500}"
MCP2CLI_VAULTWARDEN_REMOTE_URL="${VAULTWARDEN_REMOTE_URL:-${MCP2CLI_VAULTWARDEN_REMOTE_URL:-http://127.0.0.1:9500}}"
set +a

nohup "$BINARY_PATH" < /dev/null > "$LOG_FILE" 2>&1 &
pid="$!"
echo "$pid" > "$PID_FILE"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if kill -0 "$pid" 2>/dev/null && curl -sf --max-time 2 "http://127.0.0.1:${MCP2CLI_LISTEN_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! kill -0 "$pid" 2>/dev/null; then
  tail -n 80 "$LOG_FILE" || true
  exit 1
fi

actual_exe="$(readlink "/proc/$pid/exe")"
if [ "$actual_exe" != "$BINARY_PATH" ]; then
  echo "Service started unexpected binary: $actual_exe" >&2
  exit 1
fi

curl -sf --max-time 5 "http://127.0.0.1:${MCP2CLI_LISTEN_PORT}/health" >/dev/null
