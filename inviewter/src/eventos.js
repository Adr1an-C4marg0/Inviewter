'use strict';

const { Events } = require('discord.js');
const { MIN, diaLocal } = require('./util');
const links = require('./services/links');
const entradas = require('./services/entradas');
const atividade = require('./services/atividade');
const antiabuso = require('./services/antiabuso');
const logs = require('./logs');
const acoes = require('./acoes');

function dadosMembro(member) {
  const u = member.user ?? member;
  return {
    id: u.id,
    tag: u.discriminator && u.discriminator !== '0' ? `${u.username}#${u.discriminator}` : u.username,
    avatarUrl: u.displayAvatarURL?.({ size: 128 }) ?? null,
    contaCriadaEm: u.createdTimestamp ?? null,
  };
}

/** Converte o resultado do rastreador no que vai para o banco e para o embed. */
function classificar(app, det) {
  const { ctx } = app;
  if (det.tipo === 'convite') {
    const c = det.convite;
    const link = links.porCodigo(ctx, c.code);
    if (link) {
      return {
        tipoOrigem: 'plataforma', linkId: link.id, codigo: c.code,
        origem: { tipo: 'plataforma', codigo: c.code, linkNome: link.nome, linkFonte: link.fonte, linkRemovido: Boolean(link.excluido_em) },
      };
    }
    if (c.inviterId && c.inviterId !== app.client.user?.id) {
      return {
        tipoOrigem: 'usuario', convidadorId: c.inviterId, codigo: c.code,
        origem: { tipo: 'usuario', codigo: c.code, convidadorId: c.inviterId },
      };
    }
    return {
      tipoOrigem: 'desconhecido', codigo: c.code,
      origem: { tipo: 'desconhecido', codigo: c.code, motivo: 'convite sem convidador identificável' },
    };
  }
  if (det.tipo === 'vanity') {
    return { tipoOrigem: 'vanity', codigo: det.codigo, origem: { tipo: 'vanity', codigo: det.codigo } };
  }
  if (det.tipo === 'ambiguo') {
    const codigos = det.candidatos.map((c) => c.code);
    return {
      tipoOrigem: 'ambiguo', codigo: codigos.join(','),
      origem: { tipo: 'ambiguo', candidatos: codigos, motivo: det.motivo },
    };
  }
  return { tipoOrigem: 'desconhecido', origem: { tipo: 'desconhecido', motivo: det.motivo } };
}

function origemTexto(app, e) {
  if (!e) return 'sem registro';
  const l = e.link_id ? links.obter(app.ctx, e.link_id) : null;
  return logs.rotuloOrigem({
    tipo: e.tipo_origem,
    linkNome: l?.nome,
    linkRemovido: Boolean(l?.excluido_em),
  }) + (e.tipo_origem === 'usuario' && e.convidador_id ? ` (<@${e.convidador_id}>)` : '');
}

async function processarEntrada(app, member) {
  const { ctx, rastreador } = app;
  const det = await rastreador.detectar(member.guild);
  if (member.user.bot) return;

  const agora = Date.now();
  const m = dadosMembro(member);
  const cfg = antiabuso.cfgDe(ctx);
  const previa = entradas.obter(ctx, m.id);

  // Retorno: mantém a origem original e não conta como nova entrada.
  if (previa) {
    entradas.registrarEntrada(ctx, { userId: m.id, userTag: m.tag });
    const l = previa.link_id ? links.obter(ctx, previa.link_id) : null;
    const origem = {
      tipo: previa.tipo_origem, codigo: previa.codigo, convidadorId: previa.convidador_id,
      linkNome: l?.nome, linkFonte: l?.fonte, linkRemovido: Boolean(l?.excluido_em),
    };
    const embed = logs.embedEntrada({ membro: m, origem, retorno: true, fake: Boolean(previa.fake) });
    await app.logs.enviar(app.logs.canalDeEntrada(previa.tipo_origem), embed);
    return;
  }

  const c = classificar(app, det);
  const aval = antiabuso.avaliarEntrada(cfg, {
    contaCriadaEm: m.contaCriadaEm,
    avatarPadrao: !member.user.avatar,
    agora,
  });
  const { entrada } = entradas.registrarEntrada(ctx, {
    userId: m.id, userTag: m.tag, agora,
    tipoOrigem: c.tipoOrigem, linkId: c.linkId, convidadorId: c.convidadorId, codigo: c.codigo,
    contaCriadaEm: m.contaCriadaEm, fake: aval.fake, motivoFake: aval.motivo,
  });

  const embedDados = { membro: m, origem: c.origem, fake: entrada.fake === 1, selos: aval.selos };
  if (c.tipoOrigem === 'plataforma') {
    embedDados.totalLink = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM entradas WHERE link_id = ? AND fake = 0')
      .get(c.linkId).n;
  }
  if (c.tipoOrigem === 'usuario') embedDados.convidador = { id: c.convidadorId, ...entradas.contagemConvites(ctx, c.convidadorId) };
  await app.logs.enviar(app.logs.canalDeEntrada(c.tipoOrigem), logs.embedEntrada(embedDados));

  // Pico de entradas pelo mesmo convite
  if (c.codigo && !c.codigo.includes(',')) {
    const p = app.detectorPico.registrar(c.codigo, agora, cfg.picoQtd, cfg.picoMin);
    if (p.pico) {
      entradas.marcarRevisar(ctx, c.codigo, agora - cfg.picoMin * MIN);
      const nome = c.origem.linkNome;
      const canal = ctx.ajustes.get('canal_alertas') || app.logs.canalDeEntrada(c.tipoOrigem);
      await app.logs.enviar(canal, logs.embedPico({ total: p.total, minutos: cfg.picoMin, codigo: c.codigo, nome }));
    }
  }

  if (c.convidadorId) await acoes.reavaliarRecompensa(app, c.convidadorId).catch((e) => console.error('[recompensa]', e.message));
}

async function processarSaida(app, member) {
  const { ctx } = app;
  if (member.user?.bot) return;
  const m = dadosMembro(member);
  const r = entradas.registrarSaida(ctx, m.id);
  const e = r?.entrada ?? null;
  let mensagens = null;
  if (e) {
    mensagens = ctx.db
      .prepare('SELECT COALESCE(SUM(mensagens), 0) AS n FROM atividade_diaria WHERE guild_id = ? AND user_id = ?')
      .get(ctx.guildId, m.id).n;
  }
  const embed = logs.embedSaida({
    membro: m, entrada: e, duracaoMs: r?.duracaoMs, mensagens, origemTexto: origemTexto(app, e),
  });
  await app.logs.enviar(app.logs.canalDeSaida(e?.tipo_origem ?? 'desconhecido'), embed);
  if (e?.convidador_id) await acoes.reavaliarRecompensa(app, e.convidador_id).catch((err) => console.error('[recompensa]', err.message));
}

function ligar(app) {
  const { client, ctx, rastreador } = app;
  const protegido = (nome, fn) => (...args) => {
    Promise.resolve(fn(...args)).catch((e) => console.error(`[${nome}]`, e));
  };

  client.on(Events.InviteCreate, protegido('inviteCreate', (inv) => {
    if (inv.guild?.id === ctx.guildId) rastreador.inviteCriado(inv);
  }));
  client.on(Events.InviteDelete, protegido('inviteDelete', (inv) => {
    if (inv.guild?.id === ctx.guildId) rastreador.inviteApagado(inv);
  }));

  client.on(Events.GuildMemberAdd, protegido('guildMemberAdd', (member) => {
    if (member.guild.id !== ctx.guildId) return;
    return rastreador.executar(() => processarEntrada(app, member));
  }));
  client.on(Events.GuildMemberRemove, protegido('guildMemberRemove', (member) => {
    if (member.guild.id !== ctx.guildId) return;
    return processarSaida(app, member);
  }));

  // Atividade: apenas contadores diários, nunca o conteúdo das mensagens.
  client.on(Events.MessageCreate, protegido('messageCreate', (msg) => {
    if (!msg.guildId || msg.guildId !== ctx.guildId || msg.author.bot) return;
    atividade.somar(ctx, msg.author.id, { mensagens: 1 });
  }));

  // Tempo em canais de voz, somado quando a pessoa sai do canal.
  const emVoz = new Map();
  app.vozAtiva = emVoz;
  client.on(Events.VoiceStateUpdate, protegido('voiceStateUpdate', (antes, depois) => {
    if (depois.guild.id !== ctx.guildId || depois.member?.user?.bot) return;
    const id = depois.id;
    if (!antes.channelId && depois.channelId) {
      emVoz.set(id, Date.now());
    } else if (antes.channelId && !depois.channelId) {
      const ini = emVoz.get(id);
      emVoz.delete(id);
      if (ini) {
        const minutos = Math.max(1, Math.round((Date.now() - ini) / MIN));
        atividade.somar(ctx, id, { minutosVoz: minutos });
      }
    }
  }));
}

/** Ao iniciar: sincroniza saídas, registra quem entrou com o bot offline e retoma a contagem de voz. */
async function reconciliar(app) {
  const { ctx, client } = app;
  const guild = acoes.guildDe(app);
  const membros = await guild.members.fetch();
  const reais = [...membros.values()].filter((m) => !m.user.bot);

  const saidas = entradas.reconciliarSaidas(ctx, reais.map((m) => m.id));

  const visto = ctx.ajustes.get('ultimo_visto');
  let semRastro = 0;
  if (visto) {
    for (const m of reais) {
      if ((m.joinedTimestamp ?? 0) > visto && !entradas.obter(ctx, m.id)) {
        const d = dadosMembro(m);
        entradas.registrarEntrada(ctx, {
          userId: d.id, userTag: d.tag, agora: m.joinedTimestamp, tipoOrigem: 'desconhecido',
          contaCriadaEm: d.contaCriadaEm,
        });
        semRastro += 1;
      }
    }
  }
  ctx.ajustes.set('ultimo_visto', Date.now());

  for (const canal of guild.channels.cache.values()) {
    if (!canal.isVoiceBased?.()) continue;
    for (const m of canal.members.values()) if (!m.user.bot) app.vozAtiva.set(m.id, Date.now());
  }
  void client;
  return { saidas, semRastro, dia: diaLocal(Date.now(), ctx.ajustes.get('fuso')) };
}

module.exports = { ligar, reconciliar, processarEntrada, processarSaida, classificar, dadosMembro };
