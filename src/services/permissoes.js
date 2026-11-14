'use strict';

const ACOES = ['ver_stats', 'gerir_links', 'gerir_recompensas', 'exportar'];

const ROTULOS = {
  ver_stats: 'Ver estatísticas e painel',
  gerir_links: 'Gerenciar links',
  gerir_recompensas: 'Gerenciar recompensas, resets de usuário e fakes',
  exportar: 'Exportar CSV',
};

/** Administrador do servidor (Administrador ou Gerenciar Servidor) pode tudo. */
function ehAdmin(member) {
  if (!member || !member.permissions) return false;
  return member.permissions.has('Administrator') || member.permissions.has('ManageGuild');
}

function idsDeCargos(member) {
  const cache = member?.roles?.cache;
  if (!cache) return [];
  return [...cache.keys()];
}

function listar(ctx) {
  return ctx.db.prepare('SELECT * FROM permissoes WHERE guild_id = ? ORDER BY cargo_id').all(ctx.guildId);
}

function permitido(ctx, member, acao) {
  if (!ACOES.includes(acao)) throw new Error(`Ação desconhecida: ${acao}`);
  if (ehAdmin(member)) return true;
  const cargos = new Set(idsDeCargos(member));
  if (!cargos.size) return false;
  return listar(ctx).some((p) => cargos.has(p.cargo_id) && p[acao] === 1);
}

/** Define as permissões de um cargo. Sem nenhuma permissão marcada, o cargo é removido da lista. */
function definir(ctx, cargoId, perms) {
  const v = Object.fromEntries(ACOES.map((a) => [a, perms[a] ? 1 : 0]));
  if (!ACOES.some((a) => v[a])) {
    ctx.db.prepare('DELETE FROM permissoes WHERE guild_id = ? AND cargo_id = ?').run(ctx.guildId, cargoId);
    return null;
  }
  ctx.db
    .prepare(
      `INSERT INTO permissoes (guild_id, cargo_id, ver_stats, gerir_links, gerir_recompensas, exportar)
       VALUES (@g, @c, @ver_stats, @gerir_links, @gerir_recompensas, @exportar)
       ON CONFLICT (guild_id, cargo_id) DO UPDATE SET
         ver_stats = excluded.ver_stats, gerir_links = excluded.gerir_links,
         gerir_recompensas = excluded.gerir_recompensas, exportar = excluded.exportar`,
    )
    .run({ g: ctx.guildId, c: cargoId, ...v });
  return v;
}

function remover(ctx, cargoId) {
  ctx.db.prepare('DELETE FROM permissoes WHERE guild_id = ? AND cargo_id = ?').run(ctx.guildId, cargoId);
}

module.exports = { ACOES, ROTULOS, ehAdmin, permitido, listar, definir, remover };
