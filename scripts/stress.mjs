// Stress test do app publicado: N conexões concorrentes durante D segundos, com um mix de rotas (GET com OData,
// POST com payload, 400, 404, 409, 500). Cada request leva headers próprios para filtrar no Datadog:
// x-stress-run (a rodada), x-scenario (o cenário) e x-correlation-id (rodada + número).
// Uso: node scripts/stress.mjs [URL-base] [segundos=60] [concorrência=20]   (sem URL, usa a rota do app no trial)
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const routeFromCf = () => {
  const env = { ...process.env, CF_HOME: process.env.CF_HOME ?? `${homedir()}/.cf-trial` }
  const out = execFileSync('cf', ['app', 'datadog-backend-sample'], { env, encoding: 'utf8' })
  const route = out.match(/^routes:\s+([^,\s]+)/m)?.[1]
  if (!route) throw new Error('rota não encontrada; passe a URL: node scripts/stress.mjs https://...')
  return `https://${route}`
}

const base = (process.argv[2] || routeFromCf()).replace(/\/$/, '')
const seconds = Number(process.argv[3] ?? 60)
const concurrency = Number(process.argv[4] ?? 20)
const api = `${base}/odata/v4/catalog`
const run = `stress-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`
const pick = list => list[Math.floor(Math.random() * list.length)]
const product = () => pick([1, 2, 3])

// [cenário, peso, () => [método, caminho, corpo]]
const SCENARIOS = [
  ['lista-produtos', 25, () => ['GET', '/Products']],
  ['produto-por-id', 15, () => ['GET', `/Products(${product()})`]],
  ['top-ordenado', 8, () => ['GET', '/Products?$top=2&$orderby=price%20desc']],
  ['filtro-estoque', 7, () => ['GET', '/Products?$filter=stock%20gt%205&$select=ID,name,stock']],
  ['pedido', 20, () => ['POST', '/placeOrder', { product: product(), quantity: pick([1, 1, 2, 3]) }]],
  ['reposicao', 10, () => ['POST', '/restock', { product: product(), quantity: pick([5, 10]) }]],
  ['produto-inexistente', 4, () => ['POST', '/placeOrder', { product: 999, quantity: 1 }]],
  ['quantidade-invalida', 4, () => ['POST', '/placeOrder', { product: product(), quantity: 0 }]],
  ['log-de-negocio', 4, () => ['POST', '/emitLog', { level: pick(['info', 'warn']), message: 'stress test' }]],
  ['falha-simulada', 3, () => ['POST', '/fail', {}]]
]
const total = SCENARIOS.reduce((sum, [, weight]) => sum + weight, 0)
const nextScenario = () => {
  let r = Math.random() * total
  for (const scenario of SCENARIOS) if ((r -= scenario[1]) < 0) return scenario
  return SCENARIOS[0]
}

const latencies = []
const byStatus = {}
const byScenario = {}
let sent = 0
let networkErrors = 0

const worker = async deadline => {
  while (Date.now() < deadline) {
    const [name, , build] = nextScenario()
    const [method, path, body] = build()
    const n = ++sent
    const started = performance.now()
    try {
      const res = await fetch(api + path, {
        method,
        headers: {
          'user-agent': 'lab2dev-stress/1.0',
          'x-stress-run': run,
          'x-scenario': name,
          'x-correlation-id': `${run}-${n}`,
          ...(body && { 'content-type': 'application/json' })
        },
        body: body && JSON.stringify(body)
      })
      await res.arrayBuffer()
      latencies.push(performance.now() - started)
      byStatus[res.status] = (byStatus[res.status] ?? 0) + 1
      byScenario[name] = (byScenario[name] ?? 0) + 1
    } catch {
      networkErrors++
    }
  }
}

console.log(`${run}: ${concurrency} conexões por ${seconds}s contra ${base}`)
const startedAt = Date.now()
await Promise.all(Array.from({ length: concurrency }, () => worker(startedAt + seconds * 1000)))
const elapsed = (Date.now() - startedAt) / 1000

latencies.sort((a, b) => a - b)
const pct = p => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]?.toFixed(0)
console.log(`\n${latencies.length} respostas em ${elapsed.toFixed(1)}s = ${(latencies.length / elapsed).toFixed(1)} req/s` +
  (networkErrors ? ` · ${networkErrors} erro(s) de rede` : ''))
console.log(`latência (ms): p50 ${pct(50)} · p95 ${pct(95)} · p99 ${pct(99)} · máx ${latencies.at(-1)?.toFixed(0)}`)
console.log('por status:', byStatus)
console.log('por cenário:', byScenario)
console.log(`\nNo Datadog (Logs): service:datadog-backend-sample @http.request.headers.x-stress-run:${run}`)
