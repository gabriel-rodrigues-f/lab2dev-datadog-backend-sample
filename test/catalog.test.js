const cds = require('@sap/cds')
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { GET, POST } = cds.test(__dirname + '/..')
const log = cds.test.log()
const api = '/odata/v4/catalog'
const { readBody } = require('../srv/http-access-log')

describe('CatalogService', () => {
  test('lista os produtos de exemplo', async () => {
    const { data } = await GET(`${api}/Products`)
    assert.equal(data.value.length, 3)
  })

  test('placeOrder baixa o estoque e devolve o id do pedido', async () => {
    const { data } = await POST(`${api}/placeOrder`, { product: 1, quantity: 2 })
    assert.equal(data.remainingStock, 18)
    assert.match(data.orderId, /^[0-9a-f-]{36}$/)
  })

  test('placeOrder sem estoque devolve 409', async () => {
    await assert.rejects(POST(`${api}/placeOrder`, { product: 3, quantity: 99 }), { status: 409 })
  })

  test('placeOrder de produto inexistente devolve 404', async () => {
    await assert.rejects(POST(`${api}/placeOrder`, { product: 999, quantity: 1 }), { status: 404 })
  })

  test('placeOrder com quantidade inválida devolve 400', async () => {
    await assert.rejects(POST(`${api}/placeOrder`, { product: 1, quantity: 0 }), { status: 400 })
  })

  test('emitLog aceita só os níveis conhecidos', async () => {
    const { data } = await POST(`${api}/emitLog`, { level: 'warn', message: 'teste' })
    assert.equal(data.value, 'log warn emitido')
    await assert.rejects(POST(`${api}/emitLog`, { level: 'fatal', message: 'teste' }), { status: 400 })
  })

  test('fail devolve 500', async () => {
    await assert.rejects(POST(`${api}/fail`, {}), { status: 500 })
  })

  test('health responde UP', async () => {
    const { data } = await GET('/health')
    assert.equal(data.status, 'UP')
  })
})

describe('log de acesso', () => {
  test('registra método, status e o payload do request e da resposta', async () => {
    await POST(`${api}/placeOrder`, { product: 2, quantity: 1 })
    assert.match(log.output, /POST \/odata\/v4\/catalog\/placeOrder 200/)
    assert.match(log.output, /request_body: \{ product: 2, quantity: 1 \}/)
    assert.match(log.output, /response_body: \{[^}]*remainingStock: 7/)
  })

  test('GET sem corpo não registra request_body', async () => {
    await GET(`${api}/Products`)
    assert.match(log.output, /GET \/odata\/v4\/catalog\/Products 200/)
    assert.match(log.output, /request_body: undefined/)
  })

  test('o health check não gera log de acesso', async () => {
    await GET('/health')
    assert.doesNotMatch(log.output, /GET \/health/)
  })

  test('mascara chaves sensíveis e corta corpos grandes', () => {
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
