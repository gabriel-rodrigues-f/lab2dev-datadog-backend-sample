const cds = require('@sap/cds')

const LOG = cds.log('catalog')
const LEVELS = ['debug', 'info', 'warn', 'error']
const LOW_STOCK = 5

module.exports = class CatalogService extends cds.ApplicationService {
  init() {
    const { Products } = cds.entities('sample')

    this.on('placeOrder', async req => {
      const { product, quantity } = req.data
      if (!Number.isInteger(quantity) || quantity <= 0) return req.reject(400, 'quantity deve ser um inteiro maior que zero')

      const found = await SELECT.one.from(Products, product)
      if (!found) return req.reject(404, `produto ${product} não existe`)
      if (found.stock < quantity) {
        LOG.warn('pedido recusado por falta de estoque', { product, quantity, stock: found.stock })
        return req.reject(409, `estoque insuficiente para o produto ${product}`)
      }

      await UPDATE(Products, product).with({ stock: { '-=': quantity } })
      const remainingStock = found.stock - quantity
      const orderId = cds.utils.uuid()
      LOG.info('pedido criado', { orderId, product, quantity, remainingStock })
      if (remainingStock < LOW_STOCK) LOG.warn('estoque baixo', { product, remainingStock })
      return { orderId, remainingStock }
    })

    this.on('restock', async req => {
      const { product, quantity } = req.data
      if (!Number.isInteger(quantity) || quantity <= 0) return req.reject(400, 'quantity deve ser um inteiro maior que zero')
      const updated = await UPDATE(Products, product).with({ stock: { '+=': quantity } })
      if (!updated) return req.reject(404, `produto ${product} não existe`)
      const { stock } = await SELECT.one.from(Products, product).columns('stock')
      LOG.info('estoque reposto', { product, quantity, stock })
      return stock
    })

    this.on('emitLog', req => {
      const { level = 'info', message = 'log de teste' } = req.data
      if (!LEVELS.includes(level)) return req.reject(400, `level deve ser um destes: ${LEVELS.join(', ')}`)
      LOG[level](message, { origin: 'emitLog' })
      return `log ${level} emitido`
    })

    this.on('fail', () => {
      throw new Error('falha simulada para testar o log de erro no Datadog')
    })

    return super.init()
  }
}
