const cds = require('@sap/cds')
const net = require('node:net')
const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const createTcpSink = require('../srv/datadog-tcp')
const { readBody } = require('../srv/http-access-log')

// Um "agente" falso na porta TCP: recebe as linhas como o agente do Datadog receberia.
const received = []
const connections = new Set()
const agent = net.createServer(socket => {
  connections.add(socket)
  let pending = ''
  socket.on('data', data => {
    const parts = (pending + data.toString()).split('\n')
    pending = parts.pop() // a última parte pode ser uma linha incompleta
    received.push(...parts.filter(Boolean))
  })
  socket.on('close', () => connections.delete(socket))
})
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const waitFor = async (check, ms = 2000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 20))) if (check()) return
  assert.fail('tempo esgotado')
}

before(async () => (process.env.ACCESS_LOG_TCP_PORT = await listen(agent)))
after(() => {
  for (const socket of connections) socket.destroy()
  agent.close()
})

const { GET, POST } = cds.test(__dirname + '/..')
const api = '/odata/v4/catalog'
const routeLogs = () => received.map(line => JSON.parse(line))
// Faz a chamada e devolve a linha de rota que ELA gerou (as anteriores ficam de fora).
const routeLogOf = async (request, method, path) => {
  const from = received.length
  await request().catch(() => {})
  const match = () => routeLogs().slice(from).find(l => l.http.method === method && l.http.url_details.path === path)
  await waitFor(match)
  return match()
}

describe('log de rota', () => {
  test('POST: verbo, status, headers e payload do request e da resposta', async () => {
    const order = () => POST(`${api}/placeOrder`, { product: 2, quantity: 1 }, { headers: { 'x-scenario': 'teste' } })
    const l = await routeLogOf(order, 'POST', `${api}/placeOrder`)
    assert.equal(l.status, 'info')
    assert.equal(l.logger, 'http')
    assert.match(l.message, /^POST \/odata\/v4\/catalog\/placeOrder 200 \d+ ms$/)
    assert.equal(l.http.status_code, 200)
    assert.equal(l.http.request.headers['x-scenario'], 'teste')
    assert.match(l.http.request.headers['content-type'], /json/)
    assert.deepEqual(l.http.request.body, { product: 2, quantity: 1 })
    assert.equal(l.http.response.body.remainingStock, 7)
    assert.match(l.http.response.headers['content-type'], /json/)
    assert.ok(l.duration > 0)
    assert.ok(l.correlation_id)
  })

  test('GET: sem corpo de request e com a query string separada', async () => {
    const l = await routeLogOf(() => GET(`${api}/Products?$top=1`), 'GET', `${api}/Products`)
    assert.equal('body' in l.http.request, false)
    assert.deepEqual(l.http.url_details.queryString, { $top: '1' })
    assert.equal(l.http.response.body.value.length, 1)
  })

  test('status do log segue o HTTP: 4xx warn, 5xx error', async () => {
    const notFound = await routeLogOf(() => POST(`${api}/placeOrder`, { product: 999, quantity: 1 }), 'POST', `${api}/placeOrder`)
    assert.equal(notFound.http.status_code, 404)
    assert.equal(notFound.status, 'warn')
    const failed = await routeLogOf(() => POST(`${api}/fail`, {}), 'POST', `${api}/fail`)
    assert.equal(failed.http.status_code, 500)
    assert.equal(failed.status, 'error')
  })

  test('mascara headers sensíveis', async () => {
    const request = () => GET(`${api}/Products`, { headers: { 'x-api-key': 'segredo', cookie: 'sid=1', 'x-ok': 'visivel' } })
    const { headers } = (await routeLogOf(request, 'GET', `${api}/Products`)).http.request
    assert.equal(headers['x-api-key'], '***')
    assert.equal(headers.cookie, '***')
    assert.equal(headers['x-ok'], 'visivel')
  })

  test('o health check não gera log de rota', async () => {
    const from = received.length
    await GET('/health')
    await routeLogOf(() => GET(`${api}/Products`), 'GET', `${api}/Products`)
    assert.equal(routeLogs().slice(from).length, 1)
    assert.equal(routeLogs().some(l => l.http.url_details.path === '/health'), false)
  })

  test('mascara chaves sensíveis no corpo e corta corpos grandes', () => {
    const json = 'application/json'
    assert.deepEqual(readBody('{"user":"ana","password":"x","nested":{"apiKey":"y"}}', json), {
      user: 'ana',
      password: '***',
      nested: { apiKey: '***' }
    })
    assert.match(readBody('a'.repeat(5000), 'text/plain'), /… \(5000 caracteres\)$/)
    assert.equal(readBody(Buffer.alloc(0), json), undefined)
  })
})

describe('envio ao agente por TCP', () => {
  test('reconecta quando o agente fecha a conexão', async () => {
    const lines = []
    const server = net.createServer(socket => {
      socket.on('data', data => {
        lines.push(...data.toString().split('\n').filter(Boolean))
        socket.end() // o agente derruba a conexão (como faz com as ociosas)
      })
    })
    const send = createTcpSink(await listen(server))
    send('primeira')
    await waitFor(() => lines.includes('primeira'))
    await new Promise(r => setTimeout(r, 50))
    send('segunda')
    await waitFor(() => lines.includes('segunda'))
    send.close()
    server.close()
  })

  test('guarda as linhas até o agente subir', async () => {
    const probe = net.createServer()
    const port = await listen(probe)
    await new Promise(r => probe.close(r)) // porta livre e sem ninguém escutando
    const lines = []
    const send = createTcpSink(port)
    send('antes do agente') // conexão recusada: a linha fica na fila
    await new Promise(r => setTimeout(r, 100))
    const late = net.createServer(socket => socket.on('data', d => lines.push(...d.toString().split('\n').filter(Boolean))))
    await new Promise(resolve => late.listen(port, '127.0.0.1', resolve))
    await waitFor(() => lines.includes('antes do agente'), 3000)
    send.close()
    late.close()
  })
})
