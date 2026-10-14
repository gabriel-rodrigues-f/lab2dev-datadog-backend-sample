const net = require('node:net')

// Envia linhas ao agente do Datadog pela porta TCP do LOGS_CONFIG (uma linha = um log). Mantém uma conexão,
// reconecta quando o agente a fecha (ele derruba conexões ociosas) e guarda até MAX_QUEUE linhas enquanto conecta;
// acima disso descarta, para o app nunca travar por causa do log.
const MAX_QUEUE = 10000
const RETRY_MS = 500

module.exports = function createTcpSink(port, host = '127.0.0.1') {
  const queue = []
  let socket
  let connected = false
  let retry

  const flush = () => {
    while (connected && queue.length) socket.write(queue.shift())
  }

  const connect = () => {
    retry = undefined
    socket = net.createConnection({ port, host })
    socket.setNoDelay(true)
    socket.unref()
    socket.on('connect', () => {
      connected = true
      flush()
    })
    // O agente fechou a conexão: as próximas linhas esperam a reconexão.
    socket.on('end', () => (connected = false))
    socket.on('error', () => {})
    socket.on('close', () => {
      connected = false
      socket = undefined
      if (queue.length && !retry) retry = setTimeout(connect, RETRY_MS).unref()
    })
  }

  const send = line => {
    if (queue.length >= MAX_QUEUE) return
    queue.push(`${line}\n`)
    if (connected) flush()
    else if (!socket && !retry) connect()
  }
  send.close = () => {
    clearTimeout(retry)
    socket?.destroy()
  }
  return send
}
