'use strict';

function registrar(ctx, userId, acao, detalhes = null) {
  ctx.db
    .prepare('INSERT INTO auditoria (guild_id, user_id, acao, detalhes, quando) VALUES (?, ?, ?, ?, ?)')
    .run(ctx.guildId, userId ?? null, acao, detalhes ? String(detalhes) : null, Date.now());
}

function recentes(ctx, limite = 50) {
  return ctx.db
    .prepare('SELECT * FROM auditoria WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(ctx.guildId, limite);
}

module.exports = { registrar, recentes };
