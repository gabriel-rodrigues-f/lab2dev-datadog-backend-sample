// Aspect do formatter JSON do cds.log: um objeto passado ao log cujas chaves estão TODAS nesta lista vira campos de
// primeiro nível na linha (o Datadog os mostra como atributos e permite criar facetas), em vez de texto no `msg`.
function logFields() {}

logFields.cf = () => [
  // catálogo (srv/catalog-service.js)
  'orderId', 'product', 'quantity', 'remainingStock', 'stock', 'origin',
  // log de acesso (srv/http-access-log.js)
  'http', 'duration', 'correlation_id', 'request_body', 'response_body'
]

module.exports = logFields
