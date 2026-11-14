'use strict';

function limpar(txt) {
  const t = String(txt ?? '').trim();
  return t || null;
}

function obter(ctx, id) {
  return ctx.db.prepare('SELECT * FROM links WHERE guild_id = ? AND id = ?').get(ctx.guildId, id) || null;
}

/** Inclui links desativados e removidos (necessário para classificar entradas antigas). */
function porCodigo(ctx, codigo) {
  return ctx.db.prepare('SELECT * FROM links WHERE guild_id = ? AND codigo = ?').get(ctx.guildId, codigo) || null;
}

function nomeExiste(ctx, nome, ignorarId = null) {
  const r = ctx.db
    .prepare(
      `SELECT id FROM links WHERE guild_id = ? AND excluido_em IS NULL
       AND nome = ? COLLATE NOCASE AND id <> ?`,
    )
    .get(ctx.guildId, nome, ignorarId ?? -1);
  return Boolean(r);
}

/** Aceita o id numérico ou o nome do link. Ignora links removidos. */
function porReferencia(ctx, ref) {
  const t = String(ref ?? '').trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) {
    const l = obter(ctx, Number(t));
    if (l && !l.excluido_em) return l;
  }
  return (
    ctx.db
      .prepare('SELECT * FROM links WHERE guild_id = ? AND excluido_em IS NULL AND nome = ? COLLATE NOCASE')
      .get(ctx.guildId, t) || null
  );
}

function registrar(ctx, d) {
  const nome = limpar(d.nome);
  if (!nome) throw new Error('Dê um nome ao link.');
  if (nomeExiste(ctx, nome)) throw new Error(`Já existe um link chamado "${nome}".`);
  if (porCodigo(ctx, d.codigo)) throw new Error('Esse convite já está registrado como link.');
  const info = ctx.db
    .prepare(
      `INSERT INTO links (guild_id, codigo, nome, fonte, canal_id, criado_por, expira_em, max_usos, ativo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      ctx.guildId,
      d.codigo,
      nome,
      limpar(d.fonte),
      d.canalId ?? null,
      d.criadoPor ?? null,
      d.expiraEm ?? null,
      d.maxUsos ?? 0,
      d.criadoEm ?? Date.now(),
    );
  return obter(ctx, Number(info.lastInsertRowid));
}

function statusDe(link, agora = Date.now()) {
  if (link.excluido_em) return 'removido';
  if (!link.ativo) return link.expira_em && link.expira_em <= agora ? 'expirado' : 'desativado';
  if (link.expira_em && link.expira_em <= agora) return 'expirado';
  return 'ativo';
}

function listar(ctx, { incluirExcluidos = false, busca = null } = {}) {
  const linhas = ctx.db
    .prepare(
      `SELECT l.*,
         (SELECT COUNT(*) FROM entradas e WHERE e.link_id = l.id AND e.fake = 0) AS entradas,
         (SELECT COUNT(*) FROM entradas e WHERE e.link_id = l.id AND e.fake = 1) AS fakes
       FROM links l
       WHERE l.guild_id = ? ${incluirExcluidos ? '' : 'AND l.excluido_em IS NULL'}
       ORDER BY l.criado_em DESC, l.id DESC`,
    )
    .all(ctx.guildId);
  const b = busca ? String(busca).toLowerCase() : null;
  return linhas.filter(
    (l) => !b || l.nome.toLowerCase().includes(b) || (l.fonte || '').toLowerCase().includes(b),
  );
}

function renomear(ctx, id, nome, fonte) {
  const l = obter(ctx, id);
  if (!l || l.excluido_em) throw new Error('Link não encontrado.');
  const novo = limpar(nome) ?? l.nome;
  if (nomeExiste(ctx, novo, id)) throw new Error(`Já existe um link chamado "${novo}".`);
  const novaFonte = fonte === undefined ? l.fonte : limpar(fonte);
  ctx.db.prepare('UPDATE links SET nome = ?, fonte = ? WHERE id = ?').run(novo, novaFonte, id);
  return obter(ctx, id);
}

function desativar(ctx, id) {
  ctx.db.prepare('UPDATE links SET ativo = 0 WHERE guild_id = ? AND id = ?').run(ctx.guildId, id);
  return obter(ctx, id);
}

/**
 * Exclui o link. O registro permanece (marcado como removido) para que as entradas
 * antigas continuem classificadas. Com apagarDados, as entradas também são apagadas.
 */
function excluir(ctx, id, apagarDados = false) {
  const l = obter(ctx, id);
  if (!l || l.excluido_em) throw new Error('Link não encontrado.');
  const tx = ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE links SET ativo = 0, excluido_em = ? WHERE id = ?').run(Date.now(), id);
    if (apagarDados) {
      return ctx.db.prepare('DELETE FROM entradas WHERE guild_id = ? AND link_id = ?').run(ctx.guildId, id).changes;
    }
    return 0;
  });
  return { link: l, entradasApagadas: tx() };
}

/** Marca como inativos os links vencidos e devolve a lista para revogar no Discord. */
function expirados(ctx, agora = Date.now()) {
  const linhas = ctx.db
    .prepare(
      `SELECT * FROM links WHERE guild_id = ? AND ativo = 1 AND excluido_em IS NULL
       AND expira_em IS NOT NULL AND expira_em <= ?`,
    )
    .all(ctx.guildId, agora);
  const up = ctx.db.prepare('UPDATE links SET ativo = 0 WHERE id = ?');
  for (const l of linhas) up.run(l.id);
  return linhas;
}

module.exports = {
  obter, porCodigo, porReferencia, nomeExiste, registrar, statusDe,
  listar, renomear, desativar, excluir, expirados,
};
