'use strict';

const { SlashCommandBuilder } = require('discord.js');
const acoes = require('../acoes');
const { EFEMERO, exigir, confirmar } = require('../ui');

const data = new SlashCommandBuilder()
  .setName('resetar')
  .setDescription('Zera a contagem de convites')
  .addSubcommand((s) =>
    s.setName('usuario').setDescription('Zera a contagem de convites de um membro')
      .addUserOption((o) => o.setName('usuario').setDescription('Membro').setRequired(true))
      .addBooleanOption((o) => o.setName('metricas').setDescription('Zera também as métricas desses convidados (padrão: não)')))
  .addSubcommand((s) =>
    s.setName('servidor').setDescription('Zera a contagem de convites de TODOS (só administradores)')
      .addBooleanOption((o) => o.setName('metricas').setDescription('Zera também as métricas de plataforma (padrão: não)')));

async function execute(app, interaction) {
  const sub = interaction.options.getSubcommand();
  const metricas = interaction.options.getBoolean('metricas') ?? false;

  if (sub === 'usuario') {
    if (!(await exigir(app, interaction, 'gerir_recompensas'))) return;
    const alvo = interaction.options.getUser('usuario', true);
    const ok = await confirmar(
      interaction,
      `Zerar a contagem de convites de **${alvo.username}**${metricas ? ' e as métricas desses convidados' : ''}? O histórico dos logs não é apagado.`,
    );
    if (!ok) return;
    const n = await acoes.resetarUsuario(app, alvo.id, { metricas, usuarioId: interaction.user.id });
    return interaction.followUp({ content: `Contagem de **${alvo.username}** zerada (${n} entradas).`, flags: EFEMERO });
  }

  if (!(await exigir(app, interaction, 'admin'))) return;
  const ok = await confirmar(
    interaction,
    `⚠ Zerar a contagem de convites de **todo o servidor**${metricas ? ' e **todas as métricas de plataforma**' : ''}? Isso não pode ser desfeito. Os logs já enviados continuam nos canais.`,
  );
  if (!ok) return;
  const r = await acoes.resetarServidor(app, { metricas, usuarioId: interaction.user.id });
  return interaction.followUp({
    content: `Servidor zerado: ${r.convites} entradas de convites${metricas ? ` e ${r.metricas} entradas fora das métricas` : ''}.`,
    flags: EFEMERO,
  });
}

module.exports = { data, execute };
