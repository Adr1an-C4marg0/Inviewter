'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const permissoes = require('./services/permissoes');

const EFEMERO = MessageFlags.Ephemeral;

/** Verifica a permissão; se faltar, responde ao usuário e devolve false. */
async function exigir(app, interaction, acao) {
  const ok = acao === 'admin'
    ? permissoes.ehAdmin(interaction.member)
    : permissoes.permitido(app.ctx, interaction.member, acao);
  if (!ok) {
    const msg = acao === 'admin'
      ? 'Só administradores do servidor podem usar este comando.'
      : 'Você não tem permissão para isso. Peça a um administrador para liberar seu cargo no InViewte.';
    const payload = { content: msg, flags: EFEMERO };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  }
  return ok;
}

/** Pergunta com botões Confirmar/Cancelar. Devolve true se o mesmo usuário confirmar em 30 s. */
async function confirmar(interaction, texto) {
  const linha = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sim').setLabel('Confirmar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('nao').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content: texto, components: [linha], flags: EFEMERO });
  const msg = await interaction.fetchReply();
  try {
    const clique = await msg.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id,
      time: 30_000,
    });
    if (clique.customId === 'sim') {
      await clique.update({ content: 'Confirmado. Executando…', components: [] });
      return true;
    }
    await clique.update({ content: 'Cancelado.', components: [] });
    return false;
  } catch {
    await interaction.editReply({ content: 'Tempo esgotado. Nada foi alterado.', components: [] }).catch(() => {});
    return false;
  }
}

module.exports = { EFEMERO, exigir, confirmar };
