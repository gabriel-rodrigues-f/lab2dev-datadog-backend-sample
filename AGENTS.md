# lab2dev-datadog-backend-sample

Sample: app CAP (Node.js) no SAP BTP Cloud Foundry **trial** com os logs enviados ao Datadog pelo buildpack oficial
(`datadog-cloudfoundry-buildpack`, supply, antes do `nodejs_buildpack`). Leia o `README.md`.

## Comandos

```sh
npm install && npm test          # Node 22 (nvm use 22); testes com cds.test, gate de toda mudança em srv/
npm run watch                    # local, http://localhost:4004
npm run deploy:trial             # scripts/deploy.sh — só no trial (trava pela org *trial), CF_HOME=~/.cf-trial
npm run traffic                  # gera logs de todos os níveis no app publicado
npm run check:datadog            # confere pela API do Datadog se as linhas chegaram (precisa de DD_APP_KEY)
```

## Regras

- 🚫 Nunca imprimir o `.env`, a API/application key do Datadog, `cf env`, `VCAP_SERVICES` ou service keys. Os
  scripts leem o `.env` dentro do processo e mostram só nomes, tamanhos e status.
- O `.env` é preenchido com os valores que o dono passa; ele fica fora do git (`.gitignore`) e do pacote do
  `cf push` (`.cfignore`). Toda mudança no `.cfignore` mantém `.env` e `.env.*` de fora.
- O login do CF do trial fica em `CF_HOME=~/.cf-trial`, separado do login do DEV (`~/.cf`). Senha só a pessoa digita.
- No trial, nada se apaga sem pedido do dono (`cf delete`, `delete-service`, `undeploy`).
- Campo de negócio novo nos logs: acrescente a chave em `srv/log-fields.js` (senão ele vira texto no `msg`).
- Nada de commit em `main`, push ou remoto sem pedido do dono.
