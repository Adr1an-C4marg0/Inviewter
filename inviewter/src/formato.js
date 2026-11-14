'use strict';

const { EmbedBuilder } = require('discord.js');
const { DIA, fmtNum, fmtPct, truncar } = require('./util');
const { CORES } = require('./logs');
const stats = require('./services/stats');

const PERIODOS = { '7': 7, '30': 30, '90': 90, tudo: null };

function desdeDe(periodo, agora = Date.now()) {
  const dias = PERIODOS[String(periodo ?? '30')];
  return dias ? agora - dias * DIA : null;
}

function textoPeriodo(periodo) {
  const p = String(periodo ?? '30');
  return p === 'tudo' ? 'desde o início' : `últimos ${p} dias`;
}

function retencaoTexto(m) {
  return Object.entries(m.retencao)
    .map(([dias, v]) => `D${dias} ${fmtPct(v)}`)
    .join(' · ');
}

function linhaMetricas(nome, m) {
  return (
    `**${truncar(nome, 60)}** — ${fmtNum(m.entradas)} entradas · ${retencaoTexto(m)} · ` +
    `ativos ${fmtNum(m.ativos)} (${fmtPct(m.indice)}) · fakes ${fmtNum(m.fakes)}`
  );
}

function camposMetricas(m) {
  return [
    { name: 'Entradas', value: fmtNum(m.entradas), inline: true },
    { name: 'Saídas', value: fmtNum(m.saidas), inline: true },
    { name: 'Fakes', value: fmtNum(m.fakes), inline: true },
    { name: 'Retenção', value: retencaoTexto(m) || '–', inline: true },
    { name: 'Usuários ativos', value: `${fmtNum(m.ativos)} (${fmtPct(m.indice)} das entradas)`, inline: true },
    { name: 'Ativação nos 7 primeiros dias', value: fmtPct(m.ativacao), inline: true },
    { name: 'Mensagens por entrada', value: m.msgsPorEntrada == null ? '–' : String(m.msgsPorEntrada).replace('.', ','), inline: true },
  ];
}

function embedMetricas(titulo, m, periodo) {
  return new EmbedBuilder()
    .setColor(CORES.info)
    .setTitle(titulo)
    .setDescription(`Período: ${textoPeriodo(periodo)}`)
    .addFields(camposMetricas(m))
    .setFooter({ text: 'InViewte' })
    .setTimestamp();
}

/** Compara as plataformas pelo índice de qualidade (ativos ÷ entradas), do melhor para o pior. */
function embedComparativo(ctx, periodo, desde) {
  const geral = stats.metricas(ctx, { desde });
  const lista = stats
    .plataformas(ctx, { desde })
    .sort((a, b) => (b.indice ?? -1) - (a.indice ?? -1) || b.entradas - a.entradas);
  const e = new EmbedBuilder()
    .setColor(CORES.info)
    .setTitle('Plataformas: volume e qualidade')
    .setFooter({ text: 'InViewte · ordenado pelo índice de qualidade (ativos ÷ entradas)' })
    .setTimestamp();
  const linhas = lista.length
    ? lista.map((p, i) => `${i + 1}. ${linhaMetricas(p.nome, p)}`)
    : ['Ainda não há entradas registradas por links.'];
  e.setDescription(
    `Período: ${textoPeriodo(periodo)}\n\n` + truncar(linhas.join('\n'), 3500),
  );
  e.addFields({
    name: 'Servidor inteiro',
    value: truncar(
      `${fmtNum(geral.entradas)} entradas · ${fmtNum(geral.saidas)} saídas · ${fmtNum(geral.fakes)} fakes · ${retencaoTexto(geral)} · ativos ${fmtNum(geral.ativos)} (${fmtPct(geral.indice)})`,
      1000,
    ),
  });
  return e;
}

module.exports = {
  PERIODOS, desdeDe, textoPeriodo, retencaoTexto, linhaMetricas, camposMetricas, embedMetricas, embedComparativo,
};
