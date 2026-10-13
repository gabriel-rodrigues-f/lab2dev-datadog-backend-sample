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

**Log de acesso com o payload** (`srv/http-access-log.js`, logger `http`): uma linha por request, exceto o
`/health`, no nível do status (5xx error, 4xx warn, o resto info):

```json
{"level":"info","logger":"http","msg":"POST /odata/v4/catalog/placeOrder 200",
 "http":{"method":"POST","url":"/odata/v4/catalog/placeOrder","status_code":200},"duration":22522292,
 "correlation_id":"213872a1-…","request_body":{"product":1,"quantity":2},
 "response_body":{"@odata.context":"$metadata#CatalogService.OrderResult","orderId":"db7aee8d-…","remainingStock":18}}
```

`http.method`, `http.status_code` e `duration` (ns) são atributos padrão do Datadog. Os corpos JSON viram objetos
(`@request_body.product`, `@response_body.remainingStock`), com chaves sensíveis mascaradas (`password`,
`token`, `secret`, `apiKey`, `authorization`, `cookie` → `***`) e corte em 4 KB. `LOG_HTTP_PAYLOAD=false`
desliga os corpos.

No Datadog, Logs → `service:datadog-backend-sample @logger:http` mostra o tráfego. Clique numa linha e abra o
`correlation_id` para ver as outras linhas do mesmo request (`catalog`, `odata`).

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
- **Memória e disco.** O agente divide o container com o app. No trial o conjunto usou ~96 MB de memória e
  315 MB de disco (o droplet traz Node e os binários do agente): o manifest pede 256 MB e 512 MB. Disco abaixo de
  ~350 MB não comporta o droplet e o app não sobe.
- **Ruby 3.0 do `cflinuxfs4` (BTP).** Os scripts Ruby do buildpack não batem com ele em dois pontos:
  `DD_SPARSE_APP_LOGS` troca o `nc` pelo `scripts/nc.rb`, que quebra (`must be called with a block
  (ThreadError)`) e **nenhuma linha chega ao agente**: não use. E o `update_datadog_config.rb` falha com
  `unknown keyword: :aliases` (só as tags do `datadog.yaml`; os logs não dependem dele).
- **Como ver que funciona.** `SUPPRESS_DD_AGENT_OUTPUT: false` põe a saída do agente no `cf logs`: procure
  `HTTP connectivity successful`, `logs-agent started`, `Starting TCP forwarder on port 10514` e
  `Start tailing stream from 127.0.0.1`. Um `Resetting buildpack log redirection` logo no start é normal (o
  agente ainda não escutava); se ele se repetir, a ponte stdout → agente está caindo.
- **Stack.** O BTP marcou o `cflinuxfs4` como deprecated (novos pushes até 12/04/2027). O `cflinuxfs5` ainda
  não foi testado com este buildpack.
- **Cabeçalhos nos logs.** O formatter JSON do CAP grava todos os cabeçalhos do request, inclusive
  `x_forwarded_for` e `x_cf_true_client_ip` (IP de quem chamou). Para tirar, use `cds.log.mask_headers`.
- **Payload é dado do cliente.** Num produto, o corpo do request e da resposta pode ter dado pessoal ou de negócio:
  a máscara por nome de chave não basta. Lá, ligue os corpos só por ambiente (`LOG_HTTP_PAYLOAD`) e combine a
  retenção e o acesso no Datadog.
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
