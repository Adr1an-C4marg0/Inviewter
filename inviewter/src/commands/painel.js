'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { config } = require('../config');
const { EFEMERO, exigir } = require('../ui');

const data = new SlashCommandBuilder()
  .setName('painel')
  .setDescription('Mostra o link do painel web do InViewte');

async function execute(app, interaction) {
  if (!(await exigir(app, interaction, 'ver_stats'))) return;
  if (!config.painelAtivo) {
    return interaction.reply({
      content: 'O painel web não está configurado. Defina `PANEL_BASE_URL`, `DISCORD_CLIENT_SECRET` e `SESSION_SECRET` nas variáveis do serviço.',
      flags: EFEMERO,
    });
  }
  return interaction.reply({
    content: `Painel: ${config.panelBaseUrl}/\nEntre com o Discord. Você verá o que o seu cargo permite.`,
    flags: EFEMERO,
  });
}

module.exports = { data, execute };
