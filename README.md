# lab2dev-datadog-backend-sample

Sample: um app **CAP** (Node.js) no **SAP BTP Cloud Foundry** mandando ao **Datadog** só o **log de rota**: uma
linha por chamada ao endpoint, com o verbo, a URL, o status, a duração, os **headers** e o **payload** do request e
da resposta. O agente vem do buildpack oficial do Datadog; logs de infraestrutura (start do CAP, npm, buildpack,
saída do agente) ficam só no `cf logs`.

```text
request ─► CAP ─► srv/http-access-log.js ─┬─► 127.0.0.1:10514 (TCP) ─► Datadog Agent (no container) ─► Datadog Logs
                                           │                                     service:datadog-backend-sample
                                           │                                     source:nodejs · env:trial
                                           └─► stdout ─► cf logs (junto com os logs de infraestrutura)
```

## Por que o buildpack

No BTP a SAP opera o Cloud Foundry, então as integrações de **plataforma** do Datadog (nozzle do Firehose, Cluster
Agent, tile do Tanzu) não se aplicam. Sobra o nível do app, onde há três caminhos:

| Caminho | Mudança no app | Observação |
| --- | --- | --- |
| **Buildpack do Datadog** (este sample) | manifest + log de rota | oficial; logs + APM + métricas; agente dentro do container |
| OpenTelemetry (`@cap-js/telemetry`) | dependências e config cds | logs ainda experimentais no CAP e no SDK JS |
| Syslog drain (`cf cups -l`) + Vector | nenhuma | precisa de coletor com URL pública no meio |

## O log de rota

`srv/http-access-log.js` registra toda chamada, exceto o `/health` (o health check do CF). O status do log segue o
HTTP: 5xx `error`, 4xx `warn`, o resto `info`. Exemplo real do trial:

```json
{
  "timestamp": "2026-10-14T14:01:08.428Z",
  "status": "info",
  "logger": "http",
  "message": "POST /odata/v4/catalog/restock 200 1 ms",
  "correlation_id": "stress-20261014T140108-12",
  "duration": 1394542,
  "http": {
    "method": "POST",
    "url": "/odata/v4/catalog/restock",
    "url_details": { "path": "/odata/v4/catalog/restock", "queryString": {} },
    "status_code": 200,
    "useragent": "lab2dev-stress/1.0",
    "request": {
      "headers": { "content-type": "application/json", "x-scenario": "reposicao", "x-correlation-id": "…", "…": "…" },
      "body": { "product": 3, "quantity": 10 }
    },
    "response": {
      "headers": { "content-type": "application/json; charset=utf-8", "odata-version": "4.0", "…": "…" },
      "body": { "@odata.context": "$metadata#Edm.Int32", "value": 12 }
    }
  },
  "network": { "client": { "ip": "…" } }
}
```

- `http.method`, `http.status_code`, `http.url_details.path`, `http.useragent`, `network.client.ip` e `duration`
  (ns) são atributos padrão do Datadog e já viram facetas.
- Os corpos JSON viram objetos (`@http.request.body.product`, `@http.response.body.value`), cortados em 4 KB.
- Headers e chaves de corpo sensíveis saem como `***`: `authorization`, `cookie`, `password`, `token`,
  `secret`, `apiKey`, `session`. `LOG_HTTP_PAYLOAD=false` tira os corpos.

**Como chega ao Datadog.** Com `ACCESS_LOG_TCP_PORT` (manifest), a linha vai direto para a porta TCP que o agente
abre pelo `LOGS_CONFIG` (`srv/datadog-tcp.js`: uma conexão, reconexão quando o agente a fecha, fila de até 10 mil
linhas enquanto conecta e descarte acima disso). O manifest **não** usa `STD_LOG_COLLECTION_PORT`, então o stdout
não vai ao Datadog. A mesma linha também sai no stdout, para o `cf logs`.

**Buscas no Datadog (Logs):**

| O quê | Busca |
| --- | --- |
| Todas as chamadas | `service:datadog-backend-sample` |
| Só POST | `service:datadog-backend-sample @http.method:POST` |
| Erros e avisos | `service:datadog-backend-sample status:(error OR warn)` |
| Uma rota | `service:datadog-backend-sample @http.url_details.path:"/odata/v4/catalog/placeOrder"` |
| Uma rodada do stress test | `service:datadog-backend-sample @http.request.headers.x-stress-run:<id>` |
| Um cenário do stress test | `@http.request.headers.x-scenario:pedido` |

Os logs de negócio do `cds.log` (`pedido criado`, `estoque baixo`) continuam no stdout, só no `cf logs`.

## O app

`CatalogService` em `/odata/v4/catalog`, banco SQLite em memória com três produtos (`db/data`):

| Chamada | Resposta |
| --- | --- |
| `GET Products` (com `$top`, `$filter`, `$orderby`, `$select`) e `GET Products(<ID>)` | 200 |
| `POST placeOrder {product, quantity}` | 200; 409 sem estoque; 404 produto inexistente; 400 quantidade inválida |
| `POST restock {product, quantity}` | 200 com o novo saldo; 404; 400 |
| `POST emitLog {level, message}` | 200 (escreve no `cds.log`, no nível pedido) |
| `POST fail` | 500 |
| `GET /health` | 200, sem log de rota |

## Local

```sh
nvm use 22
npm install
npm test                                   # 17 testes (cds.test + agente TCP falso)
NODE_ENV=production npm start             # http://localhost:4004; o log de rota sai no stdout
npm run stress -- http://localhost:4004 10 10
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
   `cf set-env` (sem mostrá-la), remove variáveis que saíram do manifest e faz o `cf push`.
4. **Tráfego.** `npm run traffic` (3 rodadas de 8 chamadas) ou o stress test:
   `npm run stress -- "" 60 20` (URL vazia = rota do app no trial; 60 s; 20 conexões). Ele imprime req/s,
   latência, contagem por status e por cenário, e a busca do Datadog daquela rodada.
5. **Conferir.** No Datadog, Logs → as buscas acima. Ou `npm run check:datadog`, se houver `DD_APP_KEY`.

**Stress test de 14/10/2026** (do Brasil para o us10, 20 conexões, 60 s): 7.409 requests, 123 req/s, latência
p50 157 ms / p95 185 ms / p99 229 ms (o teto é a ida e volta até os EUA, não o app); 6.616 × 200, 306 × 400,
295 × 404, 191 × 500. O app ficou em ~94 MB dos 256 MB, sem reinício, e o agente não registrou erro de envio. Local,
o mesmo script passa de 1.900 req/s.

## Pontos de atenção

- **Trial para os apps toda noite.** A SAP para os apps do trial à meia-noite UTC (`audit.app.stop` de um usuário
  da plataforma). `cf start datadog-backend-sample` ou um novo deploy sobem de novo.
- **Buildpack de terceiro.** A SAP não dá suporte a ele; o zip é baixado do GitHub no staging (versão fixa no
  manifest, 4.48.1). Para cliente sem saída para o GitHub: `cf create-buildpack` com o zip, se o cliente permitir.
- **Memória e disco.** O agente divide o container com o app. No trial o conjunto usou ~96 MB de memória e
  315 MB de disco (o droplet traz Node e os binários do agente): o manifest pede 256 MB e 512 MB. Disco abaixo de
  ~350 MB não comporta o droplet e o app não sobe.
- **Ruby 3.0 do `cflinuxfs4` (BTP).** Os scripts Ruby do buildpack não batem com ele: o `update_datadog_config.rb`
  falha com `unknown keyword: :aliases` (só as tags do `datadog.yaml`; os logs não dependem dele). Se um dia o
  stdout voltar a ir ao Datadog (`STD_LOG_COLLECTION_PORT`), **não** use `DD_SPARSE_APP_LOGS`: ele troca o `nc`
  pelo `scripts/nc.rb`, que quebra (`must be called with a block (ThreadError)`) e nenhuma linha chega ao agente.
- **Como ver que funciona.** `SUPPRESS_DD_AGENT_OUTPUT: false` põe a saída do agente no `cf logs`: procure
  `HTTP connectivity successful`, `logs-agent started`, `Starting TCP forwarder on port 10514` e, na primeira
  chamada, `Start tailing stream from 127.0.0.1` (é o app conectando).
- **Stack.** O BTP marcou o `cflinuxfs4` como deprecated (novos pushes até 12/04/2027). O `cflinuxfs5` ainda
  não foi testado com este buildpack.
- **Headers e payload são dados do cliente.** Os headers trazem o IP de quem chamou (`x-forwarded-for`,
  `x-cf-true-client-ip`) e os corpos podem ter dado pessoal ou de negócio: a máscara por nome não basta. Num
  produto, ligue os corpos só por ambiente (`LOG_HTTP_PAYLOAD`) e combine retenção e acesso no Datadog.
- **Tags.** `DD_ENV`/`DD_SERVICE`/`DD_VERSION` com labels e a coleta de metadados do CF dependem do Datadog Cluster
  Agent, que não existe no BTP. As tags vêm de `DD_TAGS` mais as que o buildpack tira do `VCAP_APPLICATION`
  (`application_name`, `space_name`, `instance_index`, `uri`, `container_id`).
- **Este sample é aberto.** `auth: dummy` (sem XSUAA) e banco em memória (zera a cada restart): só para o trial.
- **Chave.** A API key fica como variável do app (`cf set-env`). Quem tem `SpaceDeveloper` no space consegue lê-la
  com `cf env`.

## Próximos passos

- APM: `DD_APM_INSTRUMENTATION_ENABLED: true` no manifest liga o rastreamento de Node sem código (single step).
  Depois, `dd.trace_id` no log de rota para ligar log e trace.
- Logs de infraestrutura no Datadog, quando fizer sentido: um segundo `LOGS_CONFIG` (outra porta) para o stdout,
  com `source` diferente.
- XSUAA + approuter, como nos produtos, para ver usuário e tenant no log de rota.
