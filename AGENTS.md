# lab2dev-datadog-backend-sample

Sample: app CAP (Node.js) no SAP BTP Cloud Foundry **trial** que manda ao Datadog só o **log de rota** (verbo,
headers, payload) pelo buildpack oficial (`datadog-cloudfoundry-buildpack`, supply, antes do `nodejs_buildpack`).
Leia o `README.md`.

## Comandos

```sh
npm install && npm test          # Node 22 (nvm use 22); testes com cds.test, gate de toda mudança em srv/
npm run watch                    # local, http://localhost:4004
npm run deploy:trial             # scripts/deploy.sh — só no trial (trava pela org *trial), CF_HOME=~/.cf-trial
npm run traffic                  # gera logs de todos os níveis no app publicado
npm run stress -- "" 60 20       # stress test (URL vazia = rota do trial, segundos, conexões)
npm run check:datadog            # confere pela API do Datadog se as linhas chegaram (precisa de DD_APP_KEY)
```

## Regras

- 🚫 Nunca imprimir o `.env`, a API/application key do Datadog, `cf env`, `VCAP_SERVICES` ou service keys. Os
  scripts leem o `.env` dentro do processo e mostram só nomes, tamanhos e status.
- O `.env` é preenchido com os valores que o dono passa; ele fica fora do git (`.gitignore`) e do pacote do
  `cf push` (`.cfignore`). Toda mudança no `.cfignore` mantém `.env` e `.env.*` de fora.
- O login do CF do trial fica em `CF_HOME=~/.cf-trial`, separado do login do DEV (`~/.cf`). Senha só a pessoa digita.
- No trial, nada se apaga sem pedido do dono (`cf delete`, `delete-service`, `undeploy`).
- Só o log de rota (`srv/http-access-log.js`) vai ao Datadog, pela porta TCP do agente (`ACCESS_LOG_TCP_PORT`).
  Não religue `STD_LOG_COLLECTION_PORT` sem pedido do dono: ele manda também os logs de infraestrutura.
- Campo de negócio novo no `cds.log` (só `cf logs`): acrescente a chave em `srv/log-fields.js`.
- Nada de commit em `main`, push ou remoto sem pedido do dono.
