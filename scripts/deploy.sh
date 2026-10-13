#!/usr/bin/env bash
# Publica o sample no Cloud Foundry do BTP trial (cf push com o buildpack do Datadog).
# Precisa do login do trial em CF_HOME (padrão ~/.cf-trial, separado do login do DEV) e do .env preenchido.
# A API key do Datadog vai por cf set-env, nunca no manifest nem na saída.
set -euo pipefail

cd "$(dirname "$0")/.."
export CF_HOME="${CF_HOME:-$HOME/.cf-trial}"
APP=datadog-backend-sample

if ! target=$(cf target 2>&1); then
  echo "cf sem sessão em CF_HOME=$CF_HOME: faça o login do trial (README, passo 2)"
  exit 1
fi
org=$(awk -F': +' '/^org:/{print $2}' <<<"$target")
space=$(awk -F': +' '/^space:/{print $2}' <<<"$target")
# Trava: este sample só vai para o trial.
if [[ "$org" != *trial ]] || [ -z "$space" ]; then
  echo "alvo recusado: org='$org' space='$space' (esperado org do trial, com space)"
  exit 1
fi

[ -f .env ] || { echo "falta o .env: cp .env.example .env e preencha"; exit 1; }
env_value() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r"'; }
DD_API_KEY=$(env_value DD_API_KEY)
DD_SITE=$(env_value DD_SITE)
DD_ENV=$(env_value DD_ENV)
if [ -z "$DD_API_KEY" ] || [[ "$DD_API_KEY" == \<* ]]; then
  echo "DD_API_KEY vazia no .env"
  exit 1
fi
DD_SITE=${DD_SITE:-us5.datadoghq.com}
DD_ENV=${DD_ENV:-trial}

echo "alvo: org=$org space=$space app=$APP site=$DD_SITE env=$DD_ENV"

cf app "$APP" >/dev/null 2>&1 || cf create-app "$APP" >/dev/null
cf set-env "$APP" DD_API_KEY "$DD_API_KEY" >/dev/null
echo "DD_API_KEY gravada no app (${#DD_API_KEY} caracteres)"

cf push -f manifest.yml --var dd_site="$DD_SITE" --var dd_env="$DD_ENV"
