const cds = require('@sap/cds')

// Registra os campos de negócio no formatter JSON antes da primeira linha de log (ver srv/log-fields.js).
cds.env.log.aspects = [...cds.env.log.aspects, require.resolve('./log-fields')]

module.exports = cds.server
