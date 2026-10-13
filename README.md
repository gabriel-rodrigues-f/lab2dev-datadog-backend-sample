# lab2dev-datadog-backend-sample

Sample: um app **CAP** (Node.js) no **SAP BTP Cloud Foundry** com os logs chegando ao **Datadog** pelo buildpack
oficial do Datadog. Nenhuma linha de código fala com o Datadog: o app escreve JSON no stdout (o `cds.log` já faz
isso em produção), e o agente que o buildpack instala no container lê esse stdout e envia.

```text
CAP (cds.log em JSON) ─ stdout/stderr ─┬─► cf logs (Loggregator), como sempre
                                       └─► 127.0.0.1:10514 ─► Datadog Agent (no container) ─► Datadog Logs
                                                                                              service:datadog-backend-sample
                                                                                              source:nodejs · env:trial
```

## Por que o buildpack

No BTP a SAP opera o Cloud Foundry, então as integrações de **plataforma** do Datadog (nozzle do Firehose, Cluster
Agent, tile do Tanzu) não se aplicam. Sobra o nível do app, onde há três caminhos:

| Caminho | Mudança no app | Observação |
| --- | --- | --- |
| **Buildpack do Datadog** (este sample) | só manifest | oficial; logs + APM + métricas; agente dentro do container |
| OpenTelemetry (`@cap-js/telemetry`) | dependências e config cds | logs ainda experimentais no CAP e no SDK JS |
| Syslog drain (`cf cups -l`) + Vector | nenhuma | precisa de coletor com URL pública no meio |

## O que o app faz

`CatalogService` em `/odata/v4/catalog`, banco SQLite em memória com três produtos (`db/data`):

| Chamada | Log gerado |
| --- | --- |
| `GET Products` | info (`odata`) |
| `POST placeOrder {product, quantity}` | info `pedido criado`; warn `estoque baixo`; warn + 409 sem estoque; 404; 400 |
| `POST emitLog {level, message}` | a linha no nível pedido (`debug`, `info`, `warn`, `error`) |
| `POST fail` | error + 500 com stack trace |
| `GET /health` | health check do CF (`{"status":"UP"}`) |

Cada linha sai em JSON com `level`, `logger`, `msg`, `correlation_id` e os cabeçalhos do request; no CF o CAP
acrescenta `component_name`, `organization_name` e `space_name`. Os campos de negócio (`orderId`, `product`,
`quantity`, `remainingStock`, `stock`) saem como atributos próprios, porque estão em `srv/log-fields.js`.

## Local

```sh
nvm use 22
npm install
npm test                                   # 8 testes (cds.test)
npm run watch                              # http://localhost:4004
NODE_ENV=production npm start             # o mesmo JSON que vai para o Datadog
scripts/traffic.sh http://localhost:4004 1
```

## No BTP trial

1. **Segredos.** `cp .env.example .env` e preencha `DD_API_KEY`, `DD_SITE` (host do Datadog sem o `app.`, por
   exemplo `us5.datadoghq.com`) e, para conferir pela API, `DD_APP_KEY` (escopo `logs_read_data`). O `.env` fica
   fora do git e do pacote do `cf push`.
2. **Login no trial (pessoa), num CF_HOME separado** para não trocar o alvo do login do DEV:

   ```sh
   CF_HOME=~/.cf-trial cf login -a https://api.cf.us10-001.hana.ondemand.com -u <seu-email>
   ```

   O endpoint está em Cockpit → subaccount do trial → Overview → Cloud Foundry Environment. Escolha a org `…trial`
   e o space `dev`.
3. **Deploy.** `npm run deploy:trial`: recusa qualquer org que não seja do trial, grava a API key com
   `cf set-env` (sem mostrá-la) e faz o `cf push` com o manifest.
4. **Tráfego.** `npm run traffic` (3 rodadas por padrão).
5. **Conferir.** No Datadog, Logs → `service:datadog-backend-sample`. Ou `npm run check:datadog`, que lista quantas
   linhas chegaram, por status, com tags e atributos.

## Pontos de atenção

- **Buildpack de terceiro.** A SAP não dá suporte a ele; o zip é baixado do GitHub no staging (versão fixa no
  manifest, 4.48.1). Para cliente sem saída para o GitHub: `cf create-buildpack` com o zip, se o cliente permitir.
- **Memória.** O agente divide o container com o app; 512 MB folgam para este sample.
- **Tags.** `DD_ENV`/`DD_SERVICE`/`DD_VERSION` com labels e a coleta de metadados do CF dependem do Datadog Cluster
  Agent, que não existe no BTP. As tags vêm de `DD_TAGS` mais as que o buildpack tira do `VCAP_APPLICATION`
  (`application_name`, `space_name`, `instance_index`, `uri`, `container_id`).
- **Este sample é aberto.** `auth: dummy` (sem XSUAA) e banco em memória (zera a cada restart): só para o trial.
- **Chave.** A API key fica como variável do app (`cf set-env`). Quem tem `SpaceDeveloper` no space consegue lê-la
  com `cf env`.

## Próximos passos

- APM: `DD_APM_INSTRUMENTATION_ENABLED: true` no manifest liga o rastreamento de Node sem código (single step).
  Depois, `dd.trace_id` nas linhas do `cds.log` para ligar log e trace.
- XSUAA + approuter, como nos produtos, para ver `remote_user`/`tenant_id` nos logs.
- Comparar com os outros dois caminhos (OTel e syslog drain → Vector da POC da CPI).
