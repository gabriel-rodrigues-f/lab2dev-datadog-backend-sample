const cds = require('@sap/cds')

// Registra os campos de negócio no formatter JSON antes da primeira linha de log (ver srv/log-fields.js).
cds.env.log.aspects = [...cds.env.log.aspects, require.resolve('./log-fields')]

// Log de acesso com o payload, antes dos adapters do CAP (ver srv/http-access-log.js).
cds.on('bootstrap', app => app.use(require('./http-access-log')))

module.exports = cds.server
