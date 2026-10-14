// Aspect do formatter JSON do cds.log: um objeto passado ao log cujas chaves estão TODAS nesta lista vira campos de
// primeiro nível na linha (no cf logs), em vez de texto no `msg`. O log de rota não passa por aqui
// (srv/http-access-log.js monta a própria linha).
function logFields() {}

logFields.cf = () => ['orderId', 'product', 'quantity', 'remainingStock', 'stock', 'origin']

module.exports = logFields
