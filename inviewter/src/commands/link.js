'use strict';

const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { parseDuracao, formatarDuracao, extrairCodigo, truncar, fmtData } = require('../util');
const links = require('../services/links');
const stats = require('../services/stats');
const acoes = require('../acoes');
const { CORES } = require('../logs');
const { EFEMERO, exigir, confirmar } = require('../ui');

const TIPOS_CANAL = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Gerencia os links de convite nomeados (Instagram, TikTok…)')
  .addSubcommand((s) =>
    s.setName('criar').setDescription('Cria um convite no Discord e dá um nome a ele')
      .addStringOption((o) => o.setName('nome').setDescription('Nome do link, ex.: Instagram').setRequired(true).setMaxLength(60))
      .addStringOption((o) => o.setName('fonte').setDescription('Agrupa vários links na mesma plataforma, ex.: Instagram').setMaxLength(60))
      .addChannelOption((o) => o.setName('canal').setDescription('Canal para onde o convite leva').addChannelTypes(...TIPOS_CANAL))
      .addStringOption((o) => o.setName('validade').setDescription('Ex.: 30m, 12h, 7d, 30d ou perm (padrão: permanente)'))
      .addIntegerOption((o) => o.setName('usos').setDescription('Número máximo de usos (0 = ilimitado)').setMinValue(0).setMaxValue(100)))
  .addSubcommand((s) =>
    s.setName('importar').setDescription('Dá nome a um convite que já existe no servidor')
      .addStringOption((o) => o.setName('convite').setDescription('Código ou URL do convite').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('nome').setDescription('Nome do link').setRequired(true).setMaxLength(60))
      .addStringOption((o) => o.setName('fonte').setDescription('Plataforma/fonte, ex.: Instagram').setMaxLength(60)))
  .addSubcommand((s) => s.setName('listar').setDescription('Lista os links com usos, validade e status'))
  .addSubcommand((s) =>
    s.setName('renomear').setDescription('Troca o nome (e opcionalmente a fonte) de um link')
      .addStringOption((o) => o.setName('link').setDescription('Link').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('novo_nome').setDescription('Novo nome').setRequired(true).setMaxLength(60))
      .addStringOption((o) => o.setName('fonte').setDescription('Nova fonte').setMaxLength(60)))
  .addSubcommand((s) =>
    s.setName('desativar').setDescription('Revoga o convite no Discord e mantém o histórico')
      .addStringOption((o) => o.setName('link').setDescription('Link').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) =>
    s.setName('excluir').setDescription('Remove o link (o histórico fica como "link removido")')
      .addStringOption((o) => o.setName('link').setDescription('Link').setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('apagar_dados').setDescription('Apaga também as entradas desse link (irreversível)')));

function statusTexto(l) {
  const s = links.statusDe(l);
  return { ativo: 'ativo', desativado: 'desativado', expirado: 'expirado', removido: 'removido' }[s];
}

function descricaoLink(l, url) {
  const partes = [`**${l.nome}**${l.fonte ? ` · fonte ${l.fonte}` : ''}`, url ? `URL: ${url}` : `código \`${l.codigo}\``];
  partes.push(`validade: ${l.expira_em ? fmtData(l.expira_em) : 'permanente'} · usos máx.: ${l.max_usos || 'ilimitado'}`);
  return partes.join('\n');
}

async function autocomplete(app, interaction) {
  const foco = interaction.options.getFocused(true);
  const { ctx } = app;
  if (foco.name === 'convite') {
    let lista = [];
    try {
      lista = await acoes.convitesNaoRegistrados(app);
    } catch {
      /* sem permissão: lista vazia */
    }
    const b = String(foco.value).toLowerCase();
    const opcoes = lista
      .filter((c) => !b || c.code.toLowerCase().includes(b) || (c.inviter?.username || '').toLowerCase().includes(b))
      .slice(0, 25)
      .map((c) => ({ name: truncar(`${c.code} · ${c.inviter?.username ?? '?'} · ${c.uses ?? 0} usos`, 100), value: c.code }));
    return interaction.respond(opcoes);
  }
  const lista = links.listar(ctx, { busca: foco.value }).slice(0, 25);
  return interaction.respond(
    lista.map((l) => ({ name: truncar(`${l.nome}${l.fonte ? ` (${l.fonte})` : ''}`, 100), value: String(l.id) })),
  );
}

async function execute(app, interaction) {
  const { ctx } = app;
  const sub = interaction.options.getSubcommand();
  if (!(await exigir(app, interaction, 'gerir_links'))) return;

  if (sub === 'criar') {
    const nome = interaction.options.getString('nome', true);
    const validadeTxt = interaction.options.getString('validade');
    const validadeMs = parseDuracao(validadeTxt);
    if (validadeMs === null) {
      return interaction.reply({ content: 'Validade inválida. Use algo como `30m`, `12h`, `7d`, `30d` ou `perm`.', flags: EFEMERO });
    }
    const canal = interaction.options.getChannel('canal') ?? (TIPOS_CANAL.includes(interaction.channel?.type) ? interaction.channel : interaction.guild.systemChannel);
    await interaction.deferReply({ flags: EFEMERO });
    try {
      const r = await acoes.criarLink(app, {
        nome, fonte: interaction.options.getString('fonte'), canal, validadeMs,
        maxUsos: interaction.options.getInteger('usos') ?? 0, usuarioId: interaction.user.id,
      });
      const e = new EmbedBuilder().setColor(CORES.entrada).setTitle('Link criado').setDescription(descricaoLink(r.link, r.url));
      if (r.revogadoPeloBot) {
        e.setFooter({ text: `O Discord limita a validade a 7 dias; o InViewte revoga o convite sozinho em ${formatarDuracao(validadeMs)}.` });
      }
      return interaction.editReply({ embeds: [e] });
    } catch (err) {
      return interaction.editReply({ content: `Não foi possível criar o link: ${err.message}` });
    }
  }

  if (sub === 'importar') {
    await interaction.deferReply({ flags: EFEMERO });
    const codigo = extrairCodigo(interaction.options.getString('convite', true));
    if (!codigo) return interaction.editReply({ content: 'Código de convite inválido.' });
    try {
      const l = await acoes.importarLink(app, {
        codigo, nome: interaction.options.getString('nome', true),
        fonte: interaction.options.getString('fonte'), usuarioId: interaction.user.id,
      });
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(CORES.entrada).setTitle('Convite importado').setDescription(descricaoLink(l, `https://discord.gg/${l.codigo}`))],
      });
    } catch (err) {
      return interaction.editReply({ content: `Não foi possível importar: ${err.message}` });
    }
  }

  if (sub === 'listar') {
    const lista = links.listar(ctx);
    if (!lista.length) {
      return interaction.reply({ content: 'Nenhum link ainda. Crie um com `/link criar` ou importe com `/link importar`.', flags: EFEMERO });
    }
    const linhas = lista.map((l) =>
      `**${truncar(l.nome, 50)}**${l.fonte ? ` · ${truncar(l.fonte, 30)}` : ''} — \`${l.codigo}\` · ${l.entradas} entradas · ${statusTexto(l)}` +
      `${l.expira_em ? ` · vence ${fmtData(l.expira_em)}` : ''}${l.max_usos ? ` · máx. ${l.max_usos}` : ''}`,
    );
    const e = new EmbedBuilder().setColor(CORES.info).setTitle(`Links (${lista.length})`).setDescription(truncar(linhas.join('\n'), 4000));
    return interaction.reply({ embeds: [e], flags: EFEMERO });
  }

  const link = links.porReferencia(ctx, interaction.options.getString('link', true));
  if (!link) return interaction.reply({ content: 'Link não encontrado.', flags: EFEMERO });

  if (sub === 'renomear') {
    try {
      const fonte = interaction.options.getString('fonte');
      const l = links.renomear(ctx, link.id, interaction.options.getString('novo_nome', true), fonte ?? undefined);
      return interaction.reply({ content: `Link renomeado para **${l.nome}**${l.fonte ? ` (fonte ${l.fonte})` : ''}. O histórico foi mantido.`, flags: EFEMERO });
    } catch (err) {
      return interaction.reply({ content: err.message, flags: EFEMERO });
    }
  }

  if (sub === 'desativar') {
    await interaction.deferReply({ flags: EFEMERO });
    const r = await acoes.desativarLink(app, link.id, interaction.user.id);
    return interaction.editReply({
      content: `Link **${link.nome}** desativado${r.revogado ? ' e convite revogado no Discord' : ''}. As métricas continuam.`,
    });
  }

  if (sub === 'excluir') {
    const apagar = interaction.options.getBoolean('apagar_dados') ?? false;
    const resumo = stats.metricas(ctx, { linkId: link.id });
    const aviso = apagar
      ? `Excluir **${link.nome}** e **apagar ${resumo.bruto} entradas** registradas por ele? Isso não pode ser desfeito.`
      : `Excluir **${link.nome}**? O histórico (${resumo.bruto} entradas) fica salvo como "link removido".`;
    if (!(await confirmar(interaction, aviso))) return undefined;
    try {
      await acoes.excluirLink(app, link.id, { apagarDados: apagar, usuarioId: interaction.user.id });
      return interaction.followUp({ content: `Link **${link.nome}** excluído.`, flags: EFEMERO });
    } catch (err) {
      return interaction.followUp({ content: err.message, flags: EFEMERO });
    }
  }
  return undefined;
}

module.exports = { data, execute, autocomplete };
