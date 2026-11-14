'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const recompensas = require('../services/recompensas');
const auditoria = require('../services/auditoria');
const acoes = require('../acoes');
const { CORES } = require('../logs');
const { EFEMERO, exigir } = require('../ui');

const data = new SlashCommandBuilder()
  .setName('recompensa')
  .setDescription('Recompensa opcional: um cargo para quem atingir X convites válidos')
  .addSubcommand((s) =>
    s.setName('ativar').setDescription('Liga a recompensa (um único cargo, igual para todos)')
      .addRoleOption((o) => o.setName('cargo').setDescription('Cargo concedido').setRequired(true))
      .addIntegerOption((o) => o.setName('convites').setDescription('Convites válidos necessários').setRequired(true).setMinValue(1).setMaxValue(10000))
      .addBooleanOption((o) => o.setName('remover_ao_cair').setDescription('Tira o cargo se a pessoa cair abaixo do mínimo (padrão: não)'))
      .addBooleanOption((o) => o.setName('aplicar_agora').setDescription('Concede já o cargo a quem já atingiu o mínimo (padrão: não)')))
  .addSubcommand((s) => s.setName('desativar').setDescription('Desliga a recompensa (ninguém perde o cargo)'))
  .addSubcommand((s) => s.setName('ver').setDescription('Mostra a configuração atual da recompensa'));

async function execute(app, interaction) {
  const { ctx } = app;
  const sub = interaction.options.getSubcommand();

  if (sub === 'ver') {
    if (!(await exigir(app, interaction, 'gerir_recompensas'))) return;
    const r = recompensas.configuracao(ctx);
    const texto = r.ativa
      ? `Ligada: cargo <@&${r.cargoId}> para quem tiver **${r.minimo}** convites válidos.\nRemover ao cair abaixo do mínimo: **${r.remover ? 'sim' : 'não'}**.`
      : 'Desligada. Ative com `/recompensa ativar`.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(CORES.info).setTitle('Recompensa por cargo').setDescription(texto)], flags: EFEMERO, allowedMentions: { parse: [] } });
  }

  if (!(await exigir(app, interaction, 'gerir_recompensas'))) return;

  if (sub === 'desativar') {
    recompensas.desativar(ctx);
    auditoria.registrar(ctx, interaction.user.id, 'recompensa_desativada');
    return interaction.reply({ content: 'Recompensa desligada. Quem já tem o cargo continua com ele.', flags: EFEMERO });
  }

  const cargo = interaction.options.getRole('cargo', true);
  const minimo = interaction.options.getInteger('convites', true);
  const remover = interaction.options.getBoolean('remover_ao_cair') ?? false;
  const aplicar = interaction.options.getBoolean('aplicar_agora') ?? false;

  const eu = interaction.guild.members.me;
  if (cargo.managed || cargo.id === interaction.guild.id) {
    return interaction.reply({ content: 'Esse cargo não pode ser concedido pelo bot. Escolha outro.', flags: EFEMERO });
  }
  if (!eu || eu.roles.highest.comparePositionTo(cargo) <= 0) {
    return interaction.reply({
      content: `O cargo do bot precisa estar **acima** de ${cargo} na lista de cargos do servidor. Ajuste em Configurações do servidor › Cargos e tente de novo.`,
      flags: EFEMERO,
      allowedMentions: { parse: [] },
    });
  }

  recompensas.definir(ctx, { cargoId: cargo.id, minimo, remover });
  auditoria.registrar(ctx, interaction.user.id, 'recompensa_ativada', `cargo ${cargo.id}, mínimo ${minimo}, remover ${remover}`);
  await interaction.deferReply({ flags: EFEMERO });
  let extra = '';
  if (aplicar) {
    const feitos = await recompensas.avaliarTodos(ctx, acoes.guildDe(app));
    for (const f of feitos) await acoes.notificarRecompensa(app, f, f.userId);
    extra = `\nCargo concedido agora a **${feitos.filter((f) => f.acao === 'concedido').length}** pessoa(s).`;
  }
  return interaction.editReply({
    content: `Recompensa ligada: ${cargo} para **${minimo}** convites válidos. Remover ao cair: **${remover ? 'sim' : 'não'}**.${extra}`,
    allowedMentions: { parse: [] },
  });
}

module.exports = { data, execute };
