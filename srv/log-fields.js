// Aspect do formatter JSON do cds.log: um objeto passado ao log cujas chaves estão TODAS nesta lista vira campos de
// primeiro nível na linha (o Datadog os mostra como atributos e permite criar facetas), em vez de texto no `msg`.
function logFields() {}

logFields.cf = () => ['orderId', 'product', 'quantity', 'remainingStock', 'stock', 'origin']

module.exports = logFields
