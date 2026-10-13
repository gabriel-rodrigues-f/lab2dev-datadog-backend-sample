const cds = require('@sap/cds')
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { GET, POST } = cds.test(__dirname + '/..')
const api = '/odata/v4/catalog'

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
