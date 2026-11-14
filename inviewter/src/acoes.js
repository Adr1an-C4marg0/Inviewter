'use strict';

/**
 * Ações compartilhadas entre os comandos do Discord e o painel web,
 * para que os dois se comportem exatamente igual.
 */

const { DIA } = require('./util');
const links = require('./services/links');
const entradas = require('./services/entradas');
const recompensas = require('./services/recompensas');
const auditoria = require('./services/auditoria');
const { embedRecompensa } = require('./logs');

const MAX_DISCORD_MS = 7 * DIA; // o Discord só aceita validade nativa de até 7 dias

function guildDe(app) {
  const g = app.client.guilds.cache.get(app.ctx.guildId);
  if (!g) throw new Error('O bot não está no servidor configurado (GUILD_ID).');
  return g;
}

/** Cria o convite no Discord e registra o link com nome, fonte, validade e limite. */
async function criarLink(app, { nome, fonte, canal, validadeMs = 0, maxUsos = 0, usuarioId }) {
  const { ctx } = app;
  if (links.nomeExiste(ctx, String(nome).trim())) throw new Error(`Já existe um link chamado "${String(nome).trim()}".`);
  if (!canal?.createInvite) throw new Error('Escolha um canal de texto onde o convite possa ser criado.');
  const nativo = validadeMs > 0 && validadeMs <= MAX_DISCORD_MS;
  const convite = await canal.createInvite({
    maxAge: nativo ? Math.floor(validadeMs / 1000) : 0,
    maxUses: maxUsos || 0,
    unique: true,
    reason: `InViewte: link "${nome}"`,
  });
  try {
    const link = links.registrar(ctx, {
      codigo: convite.code,
      nome,
      fonte,
      canalId: canal.id,
      criadoPor: usuarioId,
      // Acima de 7 dias o bot revoga o convite sozinho no vencimento.
      expiraEm: validadeMs > 0 ? Date.now() + validadeMs : null,
      maxUsos: maxUsos || 0,
    });
    auditoria.registrar(ctx, usuarioId, 'link_criado', `${link.nome} (${link.codigo})`);
    return { link, url: `https://discord.gg/${convite.code}`, revogadoPeloBot: validadeMs > MAX_DISCORD_MS };
  } catch (e) {
    await convite.delete('InViewte: falha ao registrar o link').catch(() => {});
    throw e;
  }
}

async function convitesDoServidor(app) {
  const convites = await guildDe(app).invites.fetch();
  return [...convites.values()];
}

/** Convites que existem no Discord mas ainda não são links do InViewte. */
async function convitesNaoRegistrados(app) {
  const todos = await convitesDoServidor(app);
  return todos.filter((c) => !links.porCodigo(app.ctx, c.code));
}

async function importarLink(app, { codigo, nome, fonte, usuarioId }) {
  const { ctx } = app;
  const todos = await convitesDoServidor(app);
  const inv = todos.find((c) => c.code === codigo);
  if (!inv) throw new Error('Não encontrei esse convite no servidor. Confira o código ou o link.');
  const link = links.registrar(ctx, {
    codigo: inv.code,
    nome,
    fonte,
    canalId: inv.channelId ?? inv.channel?.id ?? null,
    criadoPor: inv.inviter?.id ?? usuarioId,
    expiraEm: inv.expiresTimestamp ?? null,
    maxUsos: inv.maxUses ?? 0,
  });
  auditoria.registrar(ctx, usuarioId, 'link_importado', `${link.nome} (${link.codigo})`);
  return link;
}

async function revogarNoDiscord(app, codigo) {
  try {
    await guildDe(app).invites.delete(codigo, 'InViewte');
    return true;
  } catch {
    return false; // já não existia
  }
}

async function desativarLink(app, id, usuarioId) {
  const link = links.obter(app.ctx, id);
  if (!link || link.excluido_em) throw new Error('Link não encontrado.');
  const revogado = await revogarNoDiscord(app, link.codigo);
  links.desativar(app.ctx, id);
  auditoria.registrar(app.ctx, usuarioId, 'link_desativado', `${link.nome} (${link.codigo})`);
  return { link, revogado };
}

async function excluirLink(app, id, { apagarDados = false, usuarioId } = {}) {
  const link = links.obter(app.ctx, id);
  if (!link || link.excluido_em) throw new Error('Link não encontrado.');
  await revogarNoDiscord(app, link.codigo);
  const r = links.excluir(app.ctx, id, apagarDados);
  auditoria.registrar(
    app.ctx, usuarioId, 'link_excluido',
    `${link.nome} (${link.codigo})${apagarDados ? ` · ${r.entradasApagadas} entradas apagadas` : ''}`,
  );
  return r;
}

/** Revoga no Discord os links vencidos (necessário para validades acima de 7 dias). */
async function expirarLinks(app) {
  const vencidos = links.expirados(app.ctx);
  for (const l of vencidos) await revogarNoDiscord(app, l.codigo);
  return vencidos;
}

async function notificarRecompensa(app, r, userId) {
  if (!r?.acao) return;
  const cfg = recompensas.configuracao(app.ctx);
  const canal = app.logs.canalDeEntrada('usuario');
  await app.logs.enviar(canal, embedRecompensa({ acao: r.acao, userId, validos: r.validos, cargoId: cfg.cargoId }));
}

async function reavaliarRecompensa(app, userId) {
  if (!userId) return null;
  const r = await recompensas.avaliar(app.ctx, guildDe(app), userId);
  await notificarRecompensa(app, r, userId);
  return r;
}

async function definirFake(app, userId, valor, usuarioId) {
  const e = entradas.marcarFake(app.ctx, userId, valor);
  if (!e) throw new Error('Esse membro não tem registro de entrada.');
  auditoria.registrar(app.ctx, usuarioId, valor ? 'marcado_fake' : 'desmarcado_fake', userId);
  if (e.convidador_id) await reavaliarRecompensa(app, e.convidador_id);
  return e;
}

async function resetarUsuario(app, userId, { metricas = false, usuarioId } = {}) {
  const n = entradas.resetarUsuario(app.ctx, userId, { metricas });
  auditoria.registrar(app.ctx, usuarioId, 'reset_usuario', `${userId}${metricas ? ' (+métricas)' : ''} · ${n} entradas`);
  await reavaliarRecompensa(app, userId);
  return n;
}

async function resetarServidor(app, { metricas = false, usuarioId } = {}) {
  const anteriores = entradas.convidadores(app.ctx);
  const r = entradas.resetarServidor(app.ctx, { metricas });
  auditoria.registrar(app.ctx, usuarioId, 'reset_servidor', `convites: ${r.convites}${metricas ? `, métricas: ${r.metricas}` : ''}`);
  if (recompensas.configuracao(app.ctx).remover) {
    for (const id of anteriores) await reavaliarRecompensa(app, id);
  }
  return r;
}

module.exports = {
  guildDe, criarLink, convitesNaoRegistrados, importarLink, desativarLink, excluirLink,
  expirarLinks, notificarRecompensa, reavaliarRecompensa, definirFake, resetarUsuario, resetarServidor,
};
