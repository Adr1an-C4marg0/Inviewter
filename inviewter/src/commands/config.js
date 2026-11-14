'use strict';

const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { fusoValido } = require('../util');
const permissoes = require('../services/permissoes');
const recompensas = require('../services/recompensas');
const auditoria = require('../services/auditoria');
const { CORES } = require('../logs');
const { EFEMERO, exigir } = require('../ui');

const TIPOS_CANAL = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** [nome da opção, chave em ajustes, rótulo] */
const CANAIS = [
  ['plataformas', 'canal_log_plataforma', 'Entradas por link'],
  ['usuarios', 'canal_log_usuarios', 'Entradas por convite de usuário'],
  ['saidas', 'canal_log_saidas', 'Saídas'],
  ['alertas', 'canal_alertas', 'Alertas (picos e suspeitos)'],
  ['relatorios', 'canal_relatorio', 'Relatórios automáticos'],
];

const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configura o inviewter (só administradores)')
  .addSubcommand((s) => {
    s.setName('canais').setDescription('Define os canais de log e de alertas');
    for (const [nome, , rotulo] of CANAIS) {
      s.addChannelOption((o) => o.setName(nome).setDescription(rotulo).addChannelTypes(...TIPOS_CANAL));
    }
    return s;
  })
  .addSubcommand((s) =>
    s.setName('fuso').setDescription('Fuso horário das datas e dos relatórios')
      .addStringOption((o) => o.setName('fuso').setDescription('Ex.: America/Sao_Paulo').setRequired(true).setMaxLength(60)))
  .addSubcommand((s) =>
    s.setName('antiabuso').setDescription('Regras para marcar entradas falsas')
      .addIntegerOption((o) => o.setName('conta_dias').setDescription('Conta mais nova que X dias é fake (0 desliga)').setMinValue(0).setMaxValue(365))
      .addIntegerOption((o) => o.setName('saida_min').setDescription('Saiu em menos de X minutos vira fake (0 desliga)').setMinValue(0).setMaxValue(10080))
      .addIntegerOption((o) => o.setName('pico_qtd').setDescription('X entradas no mesmo convite gera alerta (0 desliga)').setMinValue(0).setMaxValue(1000))
      .addIntegerOption((o) => o.setName('pico_min').setDescription('Janela do pico, em minutos').setMinValue(1).setMaxValue(60))
      .addBooleanOption((o) => o.setName('avatar_padrao').setDescription('Mostra selo para avatar padrão (só sinal extra)'))
      .addBooleanOption((o) => o.setName('fakes_nas_metricas').setDescription('Incluir fakes nas métricas de retenção (padrão: não)')))
  .addSubcommand((s) =>
    s.setName('relatorios').setDescription('Relatórios automáticos no canal de relatórios')
      .addBooleanOption((o) => o.setName('semanal').setDescription('Resumo toda segunda, 09h'))
      .addBooleanOption((o) => o.setName('mensal').setDescription('Resumo todo dia 1, 09h')))
  .addSubcommand((s) =>
    s.setName('permissao').setDescription('Define o que um cargo pode fazer no inviewter')
      .addRoleOption((o) => o.setName('cargo').setDescription('Cargo').setRequired(true))
      .addBooleanOption((o) => o.setName('ver_stats').setDescription('Ver estatísticas e painel'))
      .addBooleanOption((o) => o.setName('gerir_links').setDescription('Criar, renomear, desativar e excluir links'))
      .addBooleanOption((o) => o.setName('gerir_recompensas').setDescription('Recompensas, resets de usuário e fakes'))
      .addBooleanOption((o) => o.setName('exportar').setDescription('Exportar CSV')))
  .addSubcommand((s) => s.setName('ver').setDescription('Mostra a configuração atual'));

function resumo(ajustes) {
  const canal = (v) => (v ? `<#${v}>` : 'não definido');
  const linhas = [
    '**Canais**',
    ...CANAIS.map(([, chave, rot]) => `${rot}: ${canal(ajustes.get(chave))}`),
    '',
    `**Fuso:** ${ajustes.get('fuso')}`,
    '',
    '**Anti-abuso**',
    `Conta nova: ${ajustes.get('fake_conta_dias')} dias · Saída rápida: ${ajustes.get('fake_saida_min')} min`,
    `Pico: ${ajustes.get('fake_pico_qtd')} em ${ajustes.get('fake_pico_min')} min · Avatar padrão: ${ajustes.get('fake_avatar') ? 'selo' : 'desligado'}`,
    `Fakes nas métricas: ${ajustes.get('fakes_fora') ? 'não' : 'sim'}`,
    '',
    '**Relatórios**',
    `Semanal: ${ajustes.get('relatorio_semanal') ? 'ligado' : 'desligado'} · Mensal: ${ajustes.get('relatorio_mensal') ? 'ligado' : 'desligado'}`,
  ];
  const r = recompensas.configuracao({ ajustes });
  linhas.push('', '**Recompensa por cargo**', r.ativa ? `Ligada: <@&${r.cargoId}> com ${r.minimo} convites válidos` : 'Desligada');
  return linhas.join('\n');
}

async function execute(app, interaction) {
  if (!(await exigir(app, interaction, 'admin'))) return;
  const { ctx } = app;
  const a = ctx.ajustes;
  const sub = interaction.options.getSubcommand();
  const quem = interaction.user.id;
  const responder = (content) => interaction.reply({ content, flags: EFEMERO, allowedMentions: { parse: [] } });

  if (sub === 'canais') {
    const linhas = [];
    for (const [nome, chave, rotulo] of CANAIS) {
      const c = interaction.options.getChannel(nome);
      if (!c) continue;
      a.set(chave, c.id);
      linhas.push(`${rotulo}: <#${c.id}>`);
    }
    if (!linhas.length) return responder('Nenhum canal informado. Escolha pelo menos um.');
    auditoria.registrar(ctx, quem, 'config_canais', linhas.join(' | '));
    return responder(`Canais atualizados:\n${linhas.join('\n')}`);
  }

  if (sub === 'fuso') {
    const f = interaction.options.getString('fuso', true).trim();
    if (!fusoValido(f)) return responder('Fuso inválido. Use um nome do banco IANA, ex.: `America/Sao_Paulo`.');
    a.set('fuso', f);
    auditoria.registrar(ctx, quem, 'config_fuso', f);
    return responder(`Fuso definido como **${f}**.`);
  }

  if (sub === 'antiabuso') {
    const mapa = [
      ['conta_dias', 'fake_conta_dias'],
      ['saida_min', 'fake_saida_min'],
      ['pico_qtd', 'fake_pico_qtd'],
      ['pico_min', 'fake_pico_min'],
    ];
    const mudou = [];
    for (const [opt, chave] of mapa) {
      const v = interaction.options.getInteger(opt);
      if (v !== null) {
        a.set(chave, v);
        mudou.push(`${opt} = ${v}`);
      }
    }
    const av = interaction.options.getBoolean('avatar_padrao');
    if (av !== null) { a.set('fake_avatar', av); mudou.push(`avatar_padrao = ${av}`); }
    const fn = interaction.options.getBoolean('fakes_nas_metricas');
    if (fn !== null) { a.set('fakes_fora', !fn); mudou.push(`fakes_nas_metricas = ${fn}`); }
    if (!mudou.length) return responder('Nada para alterar. Informe pelo menos uma opção.');
    auditoria.registrar(ctx, quem, 'config_antiabuso', mudou.join(', '));
    return responder(`Anti-abuso atualizado: ${mudou.join(', ')}.`);
  }

  if (sub === 'relatorios') {
    const s = interaction.options.getBoolean('semanal');
    const m = interaction.options.getBoolean('mensal');
    if (s === null && m === null) return responder('Informe `semanal` e/ou `mensal`.');
    if (s !== null) a.set('relatorio_semanal', s);
    if (m !== null) a.set('relatorio_mensal', m);
    const canal = a.get('canal_relatorio');
    auditoria.registrar(ctx, quem, 'config_relatorios', `semanal=${a.get('relatorio_semanal')} mensal=${a.get('relatorio_mensal')}`);
    return responder(
      `Relatórios: semanal ${a.get('relatorio_semanal') ? 'ligado' : 'desligado'}, mensal ${a.get('relatorio_mensal') ? 'ligado' : 'desligado'}.` +
        (canal ? '' : '\n⚠ Defina o canal com `/config canais relatorios`.'),
    );
  }

  if (sub === 'permissao') {
    const cargo = interaction.options.getRole('cargo', true);
    const atual = permissoes.listar(ctx).find((p) => p.cargo_id === cargo.id) || {};
    const perms = {};
    for (const acao of permissoes.ACOES) {
      const v = interaction.options.getBoolean(acao);
      perms[acao] = v !== null ? v : atual[acao] === 1;
    }
    const salvo = permissoes.definir(ctx, cargo.id, perms);
    auditoria.registrar(ctx, quem, 'config_permissao', `${cargo.id} ${JSON.stringify(perms)}`);
    if (!salvo) return responder(`${cargo} não tem mais permissões no inviewter.`);
    const lista = permissoes.ACOES.filter((k) => salvo[k]).map((k) => permissoes.ROTULOS[k]);
    return responder(`${cargo} agora pode: ${lista.join('; ')}.`);
  }

  // ver
  const e = new EmbedBuilder().setColor(CORES.info).setTitle('Configuração do inviewter').setDescription(resumo(a)).setFooter({ text: 'inviewter' });
  return interaction.reply({ embeds: [e], flags: EFEMERO, allowedMentions: { parse: [] } });
}

module.exports = { data, execute, CANAIS };
