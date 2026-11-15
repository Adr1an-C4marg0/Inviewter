'use strict';

const path = require('node:path');

const { Client, GatewayIntentBits, Events, InteractionType } = require('discord.js');
const { config, validar } = require('./config');
const db = require('./db');
const { criarContexto } = require('./contexto');
const { Rastreador } = require('./rastreador');
const { Logs } = require('./logs');
const { DetectorPico } = require('./services/antiabuso');
const eventos = require('./eventos');
const comandos = require('./comandos');
const jobs = require('./jobs');
const painel = require('./panel/servidor');

async function main() {
  validar();

  const conexao = db.abrir(config.dataDir);
  const ctx = criarContexto(conexao, config.guildId);

  const total = conexao.prepare('SELECT COUNT(*) AS n FROM links').get().n;
  console.log(`[bot] banco: ${path.resolve(config.dataDir)} (${total} links salvos)`);
  if (process.env.RAILWAY_ENVIRONMENT && !process.env.DATA_DIR) {
    console.warn('[AVISO] Railway sem DATA_DIR: o banco fica no disco temporário e é APAGADO a cada deploy. '
      + 'Crie um Volume em /data e defina DATA_DIR=/data.');
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  const app = {
    client,
    ctx,
    db: conexao,
    rastreador: new Rastreador(),
    detectorPico: new DetectorPico(),
    logs: new Logs(client, ctx),
    vozAtiva: new Map(),
  };

  eventos.ligar(app);

  client.once(Events.ClientReady, async (c) => {
    console.log(`[bot] conectado como ${c.user.tag}`);
    try {
      const guild = await c.guilds.fetch(config.guildId);
      await guild.members.fetch();
      await app.rastreador.sincronizar(guild);
      const r = await eventos.reconciliar(app);
      console.log(`[bot] convites em cache: ${app.rastreador.cache.size} · saídas reconciliadas: ${r.saidas} · entradas sem rastro: ${r.semRastro}`);
      await guild.commands.set(comandos.json());
      console.log('[bot] comandos registrados');
    } catch (e) {
      console.error('[bot] falha na inicialização:', e.message);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        const cmd = comandos.porNome.get(interaction.commandName);
        if (cmd?.autocomplete) await cmd.autocomplete(app, interaction);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      const cmd = comandos.porNome.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(app, interaction);
    } catch (e) {
      console.error(`[comando ${interaction.commandName ?? '?'}]`, e);
      const msg = { content: 'Algo deu errado. Tente de novo em instantes.', flags: 64 };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
      else if (interaction.isRepliable()) await interaction.reply(msg).catch(() => {});
    }
  });

  const pararJobs = jobs.iniciar(app);

  const servidorPainel = config.painelAtivo ? painel.iniciar(app) : null;
  if (!config.painelAtivo) console.log('[painel] desligado (defina PANEL_BASE_URL, DISCORD_CLIENT_SECRET e SESSION_SECRET)');

  await client.login(config.token);

  const encerrar = () => {
    console.log('[bot] encerrando…');
    pararJobs();
    if (servidorPainel) servidorPainel.close();
    client.destroy();
    conexao.close();
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});