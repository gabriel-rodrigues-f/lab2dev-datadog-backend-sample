#!/usr/bin/env bash
# Gera tráfego que produz logs de todos os níveis (info, warn, error, debug, 4xx e 500).
# Uso: scripts/traffic.sh [URL-base] [rodadas]   (sem URL, usa a rota do app no trial)
set -euo pipefail

cd "$(dirname "$0")/.."
export CF_HOME="${CF_HOME:-$HOME/.cf-trial}"
BASE="${1:-}"
ROUNDS="${2:-3}"

if [ -z "$BASE" ]; then
  route=$(cf app datadog-backend-sample | awk -F': +' '/^routes:/{print $2}' | cut -d, -f1)
  [ -n "$route" ] || { echo "rota não encontrada; passe a URL: scripts/traffic.sh https://..."; exit 1; }
  BASE="https://$route"
fi
API="$BASE/odata/v4/catalog"

call() { # rótulo método caminho [corpo json]
  local code
  if [ "$2" = POST ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' "$API/$3" -d "$4")
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' "$API/$3")
  fi
  printf '  %-30s %s\n' "$1" "$code"
}

for i in $(seq 1 "$ROUNDS"); do
  echo "rodada $i — $BASE"
  call 'lista produtos' GET Products
  call 'pedido ok (info)' POST placeOrder '{"product":1,"quantity":1}'
  call 'estoque baixo (warn)' POST placeOrder '{"product":3,"quantity":1}'
  call 'sem estoque (409)' POST placeOrder '{"product":2,"quantity":999}'
  call 'produto inexistente (404)' POST placeOrder '{"product":999,"quantity":1}'
  call 'emitLog debug' POST emitLog '{"level":"debug","message":"log debug de teste"}'
  call 'emitLog error' POST emitLog '{"level":"error","message":"log error de teste"}'
  call 'falha simulada (500)' POST fail '{}'
done
