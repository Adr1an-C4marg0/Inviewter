'use strict';

const { criarAjustes } = require('./services/ajustes');

/** Contexto compartilhado pelos serviços: banco, servidor e ajustes. */
function criarContexto(db, guildId) {
  return { db, guildId, ajustes: criarAjustes(db, guildId) };
}

module.exports = { criarContexto };
