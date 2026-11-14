'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const entradas = require('../services/entradas');
const recompensas = require('../services/recompensas');
const { CORES } = require('../logs');
const { fmtNum } = require('../util');
const formato = require('../formato');

const invites = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Mostra quantos convites você (ou outro membro) trouxe')
    .addUserOption((o) => o.setName('usuario').setDescription('Membro (padrão: você)')),

  async execute(app, interaction) {
    const alvo = interaction.options.getUser('usuario') ?? interaction.user;
    const c = entradas.contagemConvites(app.ctx, alvo.id);
    const e = new EmbedBuilder()
      .setColor(CORES.info)
      .setAuthor({ name: alvo.username, iconURL: alvo.displayAvatarURL({ size: 64 }) })
      .setTitle('Convites')
      .setDescription(`**${fmtNum(c.validos)}** convites válidos`)
      .addFields(
        { name: 'Entradas', value: fmtNum(c.entradas), inline: true },
        { name: 'Saídas', value: fmtNum(c.saidas), inline: true },
        { name: 'Fakes', value: fmtNum(c.fakes), inline: true },
      )
      .setFooter({ text: 'inviewter · válidos = entradas − saídas − fakes' });
    const r = recompensas.configuracao(app.ctx);
    if (r.ativa) {
      const falta = Math.max(0, r.minimo - c.validos);
      e.addFields({
        name: 'Recompensa',
        value: falta > 0
          ? `Faltam **${falta}** convites válidos para o cargo <@&${r.cargoId}>.`
          : `Você já atingiu o mínimo para o cargo <@&${r.cargoId}>.`,
      });
    }
    return interaction.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },
};

const top = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Ranking de quem mais traz membros')
    .addStringOption((o) =>
      o.setName('periodo').setDescription('Período (padrão: desde o início)').addChoices(
        { name: 'Últimos 7 dias', value: '7' },
        { name: 'Últimos 30 dias', value: '30' },
        { name: 'Desde o início', value: 'tudo' },
      ))
    .addIntegerOption((o) => o.setName('quantidade').setDescription('Quantas posições mostrar (padrão 10)').setMinValue(3).setMaxValue(25)),

  async execute(app, interaction) {
    const periodo = interaction.options.getString('periodo') ?? 'tudo';
    const n = interaction.options.getInteger('quantidade') ?? 10;
    const lista = entradas.ranking(app.ctx, { desde: formato.desdeDe(periodo), limite: n });
    const medalhas = ['🥇', '🥈', '🥉'];
    const linhas = lista.map((r, i) =>
      `${medalhas[i] ?? `**${i + 1}.**`} <@${r.user_id}> — **${fmtNum(r.validos)}** válidos ` +
      `(${fmtNum(r.entradas)} entradas · ${fmtNum(r.saidas)} saídas · ${fmtNum(r.fakes)} fakes)`,
    );
    const e = new EmbedBuilder()
      .setColor(CORES.info)
      .setTitle('Quem mais convida')
      .setDescription(`${formato.textoPeriodo(periodo)}\n\n${linhas.join('\n') || 'Ainda não há convites de usuários registrados.'}`)
      .setFooter({ text: 'inviewter' });
    return interaction.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },
};

module.exports = { invites, top };
