'use strict';

const { abrirMemoria } = require('../src/db');
const { criarContexto } = require('../src/contexto');

function novoCtx() {
  const db = abrirMemoria();
  return criarContexto(db, 'g1');
}

/** Servidor falso com a mesma forma que o discord.js usa nos trechos que o bot toca. */
function guildFalsa({ convites = [], vanity = null } = {}) {
  const estado = { convites: new Map(convites.map((c) => [c.code, { ...c }])), vanity };
  const guild = {
    id: 'g1',
    invites: {
      fetch: async () => new Map([...estado.convites].map(([k, v]) => [k, { ...v }])),
    },
    fetchVanityData: async () => {
      if (!estado.vanity) throw new Error('sem vanity');
      return { ...estado.vanity };
    },
    _estado: estado,
  };
  guild.invites.fetch = async () => {
    const m = new Map([...estado.convites].map(([k, v]) => [k, { ...v }]));
    return { values: () => m.values(), size: m.size };
  };
  return guild;
}

function membroFalso({ admin = false, cargos = [] } = {}) {
  return {
    permissions: { has: (p) => admin && (p === 'Administrator' || p === 'ManageGuild') },
    roles: { cache: new Map(cargos.map((c) => [c, { id: c }])) },
  };
}

module.exports = { novoCtx, guildFalsa, membroFalso };
