const cds = require('@sap/cds')

// Log de acesso: uma linha por request com método, rota, status, duração e o payload (corpo do request e da
// resposta). Os nomes seguem os atributos padrão do Datadog (http.method, http.status_code, duration em ns), que
// já viram facetas. LOG_HTTP_PAYLOAD=false desliga os corpos e mantém o resto.
const LOG = cds.log('http')
const MAX_BODY = 4096
const SKIP = new Set(['/health'])
const SENSITIVE = /pass|secret|token|authorization|api[-_]?key|cookie/i
const withBodies = () => process.env.LOG_HTTP_PAYLOAD !== 'false'

const redact = (value, depth = 0) => {
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1))
  if (!value || typeof value !== 'object' || depth > 5) return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '***' : redact(v, depth + 1)]))
}

const readBody = (raw, contentType) => {
  if (raw === undefined || raw === null) return undefined
  const parsed = typeof raw === 'object' && !Buffer.isBuffer(raw)
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : parsed ? JSON.stringify(raw) : String(raw)
  if (!text) return undefined
  if (text.length > MAX_BODY) return `${text.slice(0, MAX_BODY)}… (${text.length} caracteres)`
  if (parsed || /json/i.test(contentType ?? '')) {
    try {
      return redact(JSON.parse(text))
    } catch {
      // corpo inválido: segue como texto
    }
  }
  return text
}

const toBuffer = (chunk, encoding) =>
  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8')

module.exports = function httpAccessLog(req, res, next) {
  if (SKIP.has(req.path)) return next()
  const start = process.hrtime.bigint()
  const chunks = []
  const { write, end } = res
  res.write = function (chunk, encoding, ...rest) {
    if (chunk) chunks.push(toBuffer(chunk, encoding))
    return write.call(this, chunk, encoding, ...rest)
  }
  res.end = function (chunk, encoding, ...rest) {
    if (chunk && typeof chunk !== 'function') chunks.push(toBuffer(chunk, encoding))
    return end.call(this, chunk, encoding, ...rest)
  }

  res.on('finish', () => {
    const status = res.statusCode
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    const bodies = withBodies()
    const sentBody = Number(req.headers['content-length']) > 0 || 'transfer-encoding' in req.headers
    LOG[level](`${req.method} ${req.originalUrl} ${status}`, {
      http: { method: req.method, url: req.originalUrl, status_code: status },
      duration: Number(process.hrtime.bigint() - start),
      correlation_id: req.headers['x-correlation-id'] ?? req.headers['x-vcap-request-id'],
      request_body: bodies && sentBody ? readBody(req.body, req.headers['content-type']) : undefined,
      response_body: bodies ? readBody(Buffer.concat(chunks), res.getHeader('content-type')) : undefined
    })
  })
  next()
}

module.exports.readBody = readBody
