'use strict';

const { SlashCommandBuilder } = require('discord.js');
const links = require('../services/links');
const statsSvc = require('../services/stats');
const formato = require('../formato');
const { truncar } = require('../util');
const { EFEMERO, exigir } = require('../ui');

const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Entradas, retenção e atividade por link, plataforma ou servidor')
  .addStringOption((o) => o.setName('link').setDescription('Um link específico').setAutocomplete(true))
  .addStringOption((o) => o.setName('fonte').setDescription('Uma plataforma (agrupa todos os links dela)').setAutocomplete(true))
  .addStringOption((o) =>
    o.setName('periodo').setDescription('Período das entradas (padrão: 30 dias)').addChoices(
      { name: 'Últimos 7 dias', value: '7' },
      { name: 'Últimos 30 dias', value: '30' },
      { name: 'Últimos 90 dias', value: '90' },
      { name: 'Desde o início', value: 'tudo' },
    ));

async function autocomplete(app, interaction) {
  const foco = interaction.options.getFocused(true);
  const b = String(foco.value).toLowerCase();
  if (foco.name === 'fonte') {
    const lista = statsSvc.fontes(app.ctx).filter((f) => f.toLowerCase().includes(b)).slice(0, 25);
    return interaction.respond(lista.map((f) => ({ name: truncar(f, 100), value: f })));
  }
  const lista = links.listar(app.ctx, { busca: foco.value }).slice(0, 25);
  return interaction.respond(
    lista.map((l) => ({ name: truncar(`${l.nome}${l.fonte ? ` (${l.fonte})` : ''}`, 100), value: String(l.id) })),
  );
}

async function execute(app, interaction) {
  if (!(await exigir(app, interaction, 'ver_stats'))) return;
  const { ctx } = app;
  const periodo = interaction.options.getString('periodo') ?? '30';
  const desde = formato.desdeDe(periodo);
  const linkRef = interaction.options.getString('link');
  const fonte = interaction.options.getString('fonte');

  if (linkRef) {
    const l = links.porReferencia(ctx, linkRef);
    if (!l) return interaction.reply({ content: 'Link não encontrado.', flags: EFEMERO });
    const m = statsSvc.metricas(ctx, { linkId: l.id, desde });
    return interaction.reply({ embeds: [formato.embedMetricas(`Link: ${l.nome}`, m, periodo)], flags: EFEMERO });
  }
  if (fonte) {
    const m = statsSvc.metricas(ctx, { fonte, desde });
    const porLink = statsSvc.porLink(ctx, { desde }).filter((x) => (x.fonte ?? x.nome).toLowerCase() === fonte.toLowerCase());
    const e = formato.embedMetricas(`Plataforma: ${fonte}`, m, periodo);
    if (porLink.length > 1) {
      e.addFields({
        name: 'Por link',
        value: truncar(porLink.map((p) => formato.linhaMetricas(p.nome, p)).join('\n'), 1000),
      });
    }
    return interaction.reply({ embeds: [e], flags: EFEMERO });
  }
  return interaction.reply({ embeds: [formato.embedComparativo(ctx, periodo, desde)], flags: EFEMERO });
}

module.exports = { data, execute, autocomplete };
