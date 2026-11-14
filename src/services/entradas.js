'use strict';

const { diaLocal } = require('../util');
const antiabuso = require('./antiabuso');

function obter(ctx, userId) {
  return (
    ctx.db.prepare('SELECT * FROM entradas WHERE guild_id = ? AND user_id = ?').get(ctx.guildId, userId) || null
  );
}

/**
 * Registra a entrada de um membro. Cada membro tem UMA linha: a origem é a do primeiro
 * convite. Se ele sai e volta, a linha é reaberta e `retornos` aumenta (não infla as entradas).
 */
function registrarEntrada(ctx, d) {
  const existente = obter(ctx, d.userId);
  if (existente) {
    ctx.db
      .prepare(
        `UPDATE entradas SET saiu_em = NULL, saiu_dia = NULL, retornos = retornos + 1,
         user_tag = COALESCE(?, user_tag) WHERE id = ?`,
      )
      .run(d.userTag ?? null, existente.id);
    return { entrada: obter(ctx, d.userId), retorno: true };
  }
  const agora = d.agora ?? Date.now();
  ctx.db
    .prepare(
      `INSERT INTO entradas (guild_id, user_id, user_tag, entrou_em, entrou_dia, tipo_origem, link_id,
         convidador_id, codigo, conta_criada_em, fake, motivo_fake)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.guildId,
      d.userId,
      d.userTag ?? null,
      agora,
      diaLocal(agora, ctx.ajustes.get('fuso')),
      d.tipoOrigem,
      d.linkId ?? null,
      d.convidadorId ?? null,
      d.codigo ?? null,
      d.contaCriadaEm ?? null,
      d.fake ? 1 : 0,
      d.motivoFake ?? null,
    );
  return { entrada: obter(ctx, d.userId), retorno: false };
}

/** Registra a saída. Saída rápida (antes do limite configurado) reclassifica a entrada como fake. */
function registrarSaida(ctx, userId, agora = Date.now()) {
  const e = obter(ctx, userId);
  if (!e || e.saiu_em) return null;
  const motivo = antiabuso.avaliarSaida(antiabuso.cfgDe(ctx), e, agora);
  ctx.db
    .prepare(
      `UPDATE entradas SET saiu_em = ?, saiu_dia = ?,
         fake = CASE WHEN ? IS NOT NULL THEN 1 ELSE fake END,
         motivo_fake = CASE WHEN ? IS NOT NULL THEN ? ELSE motivo_fake END
       WHERE id = ?`,
    )
    .run(agora, diaLocal(agora, ctx.ajustes.get('fuso')), motivo, motivo, motivo, e.id);
  return { entrada: obter(ctx, userId), viroFake: Boolean(motivo), duracaoMs: agora - e.entrou_em };
}

/** Marcação manual: valor true = fake, false = não é fake. A regra automática não sobrescreve. */
function marcarFake(ctx, userId, valor) {
  const e = obter(ctx, userId);
  if (!e) return null;
  ctx.db
    .prepare(
      `UPDATE entradas SET fake = ?, fake_manual = ?, motivo_fake = ?, revisar = 0 WHERE id = ?`,
    )
    .run(valor ? 1 : 0, valor ? 1 : 2, valor ? 'marcado manualmente' : null, e.id);
  return obter(ctx, userId);
}

function marcarRevisar(ctx, codigo, desde) {
  return ctx.db
    .prepare(
      `UPDATE entradas SET revisar = 1 WHERE guild_id = ? AND codigo = ? AND entrou_em >= ? AND fake_manual = 0`,
    )
    .run(ctx.guildId, codigo, desde).changes;
}

/** entradas = tudo que veio por convites do usuário; válidos = entradas − saídas − fakes. */
function contagemConvites(ctx, userId) {
  const r = ctx.db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(fake), 0) AS fakes,
              COALESCE(SUM(CASE WHEN fake = 0 AND saiu_em IS NOT NULL THEN 1 ELSE 0 END), 0) AS saidas
       FROM entradas
       WHERE guild_id = ? AND tipo_origem = 'usuario' AND convidador_id = ? AND conta_convidador = 1`,
    )
    .get(ctx.guildId, userId);
  return { entradas: r.total, saidas: r.saidas, fakes: r.fakes, validos: r.total - r.saidas - r.fakes };
}

function ranking(ctx, { desde = null, limite = 10 } = {}) {
  return ctx.db
    .prepare(
      `SELECT convidador_id AS user_id,
              COUNT(*) AS entradas,
              COALESCE(SUM(fake), 0) AS fakes,
              COALESCE(SUM(CASE WHEN fake = 0 AND saiu_em IS NOT NULL THEN 1 ELSE 0 END), 0) AS saidas,
              COALESCE(SUM(CASE WHEN fake = 0 AND saiu_em IS NULL THEN 1 ELSE 0 END), 0) AS validos
       FROM entradas
       WHERE guild_id = @g AND tipo_origem = 'usuario' AND convidador_id IS NOT NULL
         AND conta_convidador = 1 AND (@desde IS NULL OR entrou_em >= @desde)
       GROUP BY convidador_id
       ORDER BY validos DESC, entradas DESC, convidador_id
       LIMIT @limite`,
    )
    .all({ g: ctx.guildId, desde, limite });
}

function convidadores(ctx) {
  return ctx.db
    .prepare(
      `SELECT DISTINCT convidador_id AS user_id FROM entradas
       WHERE guild_id = ? AND tipo_origem = 'usuario' AND convidador_id IS NOT NULL`,
    )
    .all(ctx.guildId)
    .map((r) => r.user_id);
}

/** Zera a contagem de convites de um usuário (o registro das entradas continua no log). */
function resetarUsuario(ctx, userId, { metricas = false } = {}) {
  const r = ctx.db
    .prepare(
      `UPDATE entradas SET conta_convidador = 0 ${metricas ? ', conta_metricas = 0' : ''}
       WHERE guild_id = ? AND convidador_id = ? AND tipo_origem = 'usuario' AND conta_convidador = 1`,
    )
    .run(ctx.guildId, userId);
  return r.changes;
}

/** Zera as contagens de convites de todo o servidor; com `metricas`, zera também as métricas. */
function resetarServidor(ctx, { metricas = false } = {}) {
  const a = ctx.db
    .prepare(
      `UPDATE entradas SET conta_convidador = 0
       WHERE guild_id = ? AND tipo_origem = 'usuario' AND conta_convidador = 1`,
    )
    .run(ctx.guildId).changes;
  let b = 0;
  if (metricas) {
    b = ctx.db.prepare('UPDATE entradas SET conta_metricas = 0 WHERE guild_id = ?').run(ctx.guildId).changes;
  }
  return { convites: a, metricas: b };
}

function buscar(ctx, { busca = null, apenasRevisar = false, apenasFakes = false, limite = 100 } = {}) {
  const w = ['e.guild_id = @g'];
  const p = { g: ctx.guildId, limite };
  if (busca) {
    w.push('(e.user_id = @b OR e.user_tag LIKE @like)');
    p.b = busca;
    p.like = `%${busca}%`;
  }
  if (apenasRevisar) w.push('e.revisar = 1');
  if (apenasFakes) w.push('e.fake = 1');
  return ctx.db
    .prepare(
      `SELECT e.*, l.nome AS link_nome, l.fonte AS link_fonte, l.excluido_em AS link_excluido_em
       FROM entradas e LEFT JOIN links l ON l.id = e.link_id
       WHERE ${w.join(' AND ')} ORDER BY e.entrou_em DESC LIMIT @limite`,
    )
    .all(p);
}

/** Marca como saídos os membros que o Discord não lista mais (saíram com o bot offline). */
function reconciliarSaidas(ctx, idsPresentes, agora = Date.now()) {
  const presentes = new Set(idsPresentes);
  const abertos = ctx.db
    .prepare('SELECT user_id FROM entradas WHERE guild_id = ? AND saiu_em IS NULL')
    .all(ctx.guildId);
  let n = 0;
  for (const r of abertos) {
    if (!presentes.has(r.user_id)) {
      registrarSaida(ctx, r.user_id, agora);
      n += 1;
    }
  }
  return n;
}

module.exports = {
  obter, registrarEntrada, registrarSaida, marcarFake, marcarRevisar, contagemConvites,
  ranking, convidadores, resetarUsuario, resetarServidor, buscar, reconciliarSaidas,
};
