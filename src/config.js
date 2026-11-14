require('dotenv').config();
const path = require('node:path');

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  port: Number(process.env.PORT) || 3000,
  panelBaseUrl: (process.env.PANEL_BASE_URL || '').replace(/\/+$/, ''),
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  sessionSecret: process.env.SESSION_SECRET,
};

config.painelAtivo = Boolean(config.panelBaseUrl && config.clientSecret && config.sessionSecret);

function validar() {
  const faltando = ['token', 'clientId', 'guildId'].filter((k) => !config[k]);
  if (faltando.length) {
    const nomes = { token: 'DISCORD_TOKEN', clientId: 'CLIENT_ID', guildId: 'GUILD_ID' };
    throw new Error(`Variáveis de ambiente ausentes: ${faltando.map((k) => nomes[k]).join(', ')}`);
  }
}

module.exports = { config, validar };
