'use strict';

const entradas = require('./entradas');

/** Recompensa opcional: um único cargo, igual para todos, ao atingir X convites válidos. */
function configuracao(ctx) {
  const a = ctx.ajustes;
  return {
    ativa: a.get('recompensa_ativa') === true && Boolean(a.get('recompensa_cargo')),
    cargoId: a.get('recompensa_cargo'),
    minimo: a.get('recompensa_min'),
    remover: a.get('recompensa_remover') === true,
  };
}

function definir(ctx, { cargoId, minimo, remover }) {
  ctx.ajustes.set('recompensa_cargo', cargoId);
  ctx.ajustes.set('recompensa_min', minimo);
  ctx.ajustes.set('recompensa_remover', Boolean(remover));
  ctx.ajustes.set('recompensa_ativa', true);
}

function desativar(ctx) {
  ctx.ajustes.set('recompensa_ativa', false);
}

function foiConcedida(ctx, userId) {
  return Boolean(
    ctx.db.prepare('SELECT 1 FROM recompensa_concedida WHERE guild_id = ? AND user_id = ?').get(ctx.guildId, userId),
  );
}

function marcarConcedida(ctx, userId) {
  ctx.db
    .prepare('INSERT OR REPLACE INTO recompensa_concedida (guild_id, user_id, concedida_em) VALUES (?, ?, ?)')
    .run(ctx.guildId, userId, Date.now());
}

function limparConcedida(ctx, userId) {
  ctx.db.prepare('DELETE FROM recompensa_concedida WHERE guild_id = ? AND user_id = ?').run(ctx.guildId, userId);
}

/**
 * Concede (ou, se configurado, remove) o cargo de recompensa de um convidador.
 * O cargo só é concedido uma vez por pessoa: se um admin tirar à mão, o bot não devolve.
 * Devolve { acao: 'concedido' | 'removido' | null, validos, motivoFalha? }.
 */
async function avaliar(ctx, guild, userId) {
  const cfg = configuracao(ctx);
  if (!cfg.ativa || !userId) return { acao: null };
  const { validos } = entradas.contagemConvites(ctx, userId);
  const membro = await guild.members.fetch(userId).catch(() => null);
  if (!membro) return { acao: null, validos };
  const role = guild.roles.cache.get(cfg.cargoId) || (await guild.roles.fetch(cfg.cargoId).catch(() => null));
  if (!role) return { acao: null, validos, motivoFalha: 'cargo de recompensa não existe mais' };

  const tem = membro.roles.cache.has(role.id);
  if (validos >= cfg.minimo && !tem && !foiConcedida(ctx, userId)) {
    try {
      await membro.roles.add(role, `InViewte: ${validos} convites válidos`);
      marcarConcedida(ctx, userId);
      return { acao: 'concedido', validos, role };
    } catch (e) {
      return { acao: null, validos, motivoFalha: `não consegui dar o cargo (${e.message})` };
    }
  }
  if (validos < cfg.minimo && cfg.remover && tem) {
    try {
      await membro.roles.remove(role, 'InViewte: abaixo do mínimo de convites válidos');
      limparConcedida(ctx, userId);
      return { acao: 'removido', validos, role };
    } catch (e) {
      return { acao: null, validos, motivoFalha: `não consegui tirar o cargo (${e.message})` };
    }
  }
  return { acao: null, validos };
}

async function avaliarTodos(ctx, guild) {
  const resultados = [];
  for (const id of entradas.convidadores(ctx)) {
    const r = await avaliar(ctx, guild, id);
    if (r.acao) resultados.push({ userId: id, ...r });
  }
  return resultados;
}

module.exports = { configuracao, definir, desativar, avaliar, avaliarTodos, foiConcedida };
