// Confere pela API de logs do Datadog se as linhas do sample chegaram, e com quais atributos e tags.
// Lê DD_API_KEY, DD_APP_KEY e DD_SITE do .env sem imprimi-los. Uso: node scripts/check-datadog.mjs [minutos=15]
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map(line => line.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.trim().replace(/^"|"$/g, '')])
)
const { DD_API_KEY, DD_APP_KEY } = env
const DD_SITE = env.DD_SITE || 'us5.datadoghq.com'
if (!DD_API_KEY || !DD_APP_KEY) {
  console.error('faltam DD_API_KEY e/ou DD_APP_KEY no .env')
  process.exit(1)
}

const minutes = Number(process.argv[2] ?? 15)
const res = await fetch(`https://api.${DD_SITE}/api/v2/logs/events/search`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'DD-API-KEY': DD_API_KEY, 'DD-APPLICATION-KEY': DD_APP_KEY },
  body: JSON.stringify({
    filter: { query: 'service:datadog-backend-sample', from: `now-${minutes}m`, to: 'now' },
    sort: '-timestamp',
    page: { limit: 100 }
  })
})
if (!res.ok) {
  console.error(`Datadog respondeu ${res.status} ${res.statusText}`)
  process.exit(1)
}

const { data = [] } = await res.json()
console.log(`${data.length} log(s) de service:datadog-backend-sample nos últimos ${minutes} min em ${DD_SITE}`)
if (!data.length) process.exit(2)

const byStatus = {}
for (const { attributes: a } of data) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
console.log('por status:', byStatus)

const TAGS = /^(env|application_name|space_name|instance_index|platform|source):/
const FIELDS = ['logger', 'correlation_id', 'orderId', 'product', 'quantity', 'remainingStock', 'stock', 'origin']
const first = data[0].attributes
console.log('tags do mais recente:', (first.tags ?? []).filter(t => TAGS.test(t)).join(' '))
console.log('\nmais recentes:')
for (const { attributes: a } of data.slice(0, 12)) {
  const fields = FIELDS.filter(f => a.attributes?.[f] !== undefined).map(f => `${f}=${a.attributes[f]}`)
  console.log(`  ${a.timestamp} ${String(a.status).padEnd(5)} ${(a.message ?? '').split('\n')[0].slice(0, 70)}  ${fields.join(' ')}`)
}
