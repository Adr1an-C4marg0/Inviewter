'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const exportarSvc = require('../exportar');
const formato = require('../formato');
const { EFEMERO, exigir } = require('../ui');

const data = new SlashCommandBuilder()
  .setName('exportar')
  .setDescription('Gera um CSV para análise externa (planilha)')
  .addStringOption((o) =>
    o.setName('tipo').setDescription('O que exportar').setRequired(true).addChoices(
      { name: 'Links e métricas', value: 'links' },
      { name: 'Plataformas (comparação)', value: 'plataformas' },
      { name: 'Evolução por dia', value: 'evolucao' },
      { name: 'Entradas (uma linha por membro)', value: 'entradas' },
    ))
  .addStringOption((o) =>
    o.setName('periodo').setDescription('Período (padrão: desde o início)').addChoices(
      { name: 'Últimos 7 dias', value: '7' },
      { name: 'Últimos 30 dias', value: '30' },
      { name: 'Últimos 90 dias', value: '90' },
      { name: 'Desde o início', value: 'tudo' },
    ));

async function execute(app, interaction) {
  if (!(await exigir(app, interaction, 'exportar'))) return;
  const tipo = interaction.options.getString('tipo', true);
  const periodo = interaction.options.getString('periodo') ?? 'tudo';
  await interaction.deferReply({ flags: EFEMERO });
  try {
    const r = exportarSvc.gerar(app.ctx, tipo, { desde: formato.desdeDe(periodo) });
    const anexo = new AttachmentBuilder(Buffer.from(r.conteudo, 'utf8'), { name: r.nome });
    return interaction.editReply({ content: `Pronto: ${r.nome}`, files: [anexo] });
  } catch (e) {
    return interaction.editReply({ content: `Não foi possível exportar: ${e.message}` });
  }
}

module.exports = { data, execute };
