const createTcpSink = require('./datadog-tcp')

// Log de rota: uma linha JSON por request (exceto /health) com o verbo, a URL, o status, a duração, os headers e o
// payload do request e da resposta. É o ÚNICO log que vai ao Datadog: com ACCESS_LOG_TCP_PORT definido, a linha
// segue direto para a porta TCP do agente; o stdout (start do CAP, npm, buildpack) fica só no cf logs.
// Nomes nos atributos padrão do Datadog (http.method, http.status_code, http.url_details.path, http.useragent,
// network.client.ip, duration em ns), que já viram facetas. LOG_HTTP_PAYLOAD=false tira os corpos.
const MAX_BODY = 4096
const SKIP = new Set(['/health'])
const SENSITIVE = /pass|secret|token|authorization|api[-_]?key|cookie|session/i
const withBodies = () => process.env.LOG_HTTP_PAYLOAD !== 'false'

let sink
const toDatadog = () => {
  const port = Number(process.env.ACCESS_LOG_TCP_PORT)
  if (port && !sink) sink = createTcpSink(port)
  return sink
}

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

const clientIp = req =>
  req.headers['x-cf-true-client-ip'] ?? req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress

const routeLog = (req, res, { startedAt, path, query }, responseChunks) => {
  const status = res.statusCode
  const duration = Number(process.hrtime.bigint() - startedAt)
  const bodies = withBodies()
  const sentBody = Number(req.headers['content-length']) > 0 || 'transfer-encoding' in req.headers
  return {
    timestamp: new Date().toISOString(),
    status: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    logger: 'http',
    message: `${req.method} ${req.originalUrl} ${status} ${Math.round(duration / 1e6)} ms`,
    correlation_id: req.headers['x-correlation-id'] ?? req.headers['x-vcap-request-id'],
    duration,
    http: {
      method: req.method,
      url: req.originalUrl,
      url_details: { path, queryString: query },
      status_code: status,
      useragent: req.headers['user-agent'],
      request: {
        headers: redact(req.headers),
        body: bodies && sentBody ? readBody(req.body, req.headers['content-type']) : undefined
      },
      response: {
        headers: redact(res.getHeaders()),
        body: bodies ? readBody(Buffer.concat(responseChunks), res.getHeader('content-type')) : undefined
      }
    },
    network: { client: { ip: clientIp(req) } }
  }
}

module.exports = function httpAccessLog(req, res, next) {
  if (SKIP.has(req.path)) return next()
  // Caminho e query agora: depois do roteamento o Express encurta o req.path (tira o /odata/v4/catalog).
  const entry = { startedAt: process.hrtime.bigint(), path: req.path, query: { ...req.query } }
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
    const line = JSON.stringify(routeLog(req, res, entry, chunks))
    console.log(line)
    toDatadog()?.(line)
  })
  next()
}

module.exports.readBody = readBody
