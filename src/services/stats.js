'use strict';

const { DIA, diaLocal, pct } = require('../util');

/**
 * Filtro aceito pelas funções deste módulo:
 *  { linkId, fonte, tipos: ['plataforma','usuario',...], desde: ms, agora: ms }
 */
function coletar(ctx, filtro = {}) {
  const agora = filtro.agora ?? Date.now();
  const tz = ctx.ajustes.get('fuso');
  const ativoDias = Math.max(1, ctx.ajustes.get('ativo_dias'));
  const corteAtivo = diaLocal(agora - (ativoDias - 1) * DIA, tz);

  const w = ['e.guild_id = @g', 'e.conta_metricas = 1'];
  const p = { g: ctx.guildId, corte: corteAtivo };
  if (filtro.linkId) {
    w.push('e.link_id = @link');
    p.link = filtro.linkId;
  }
  if (filtro.fonte) {
    w.push("e.tipo_origem = 'plataforma' AND COALESCE(l.fonte, l.nome) = @fonte COLLATE NOCASE");
    p.fonte = filtro.fonte;
  }
  if (filtro.tipos?.length) {
    const nomes = filtro.tipos.map((t, i) => {
      p[`t${i}`] = t;
      return `@t${i}`;
    });
    w.push(`e.tipo_origem IN (${nomes.join(',')})`);
  }
  if (filtro.desde) {
    w.push('e.entrou_em >= @desde');
    p.desde = filtro.desde;
  }

  const linhas = ctx.db
    .prepare(
      `SELECT e.user_id, e.entrou_em, e.entrou_dia, e.saiu_em, e.saiu_dia, e.fake,
         (SELECT COALESCE(SUM(a.mensagens), 0) FROM atividade_diaria a
            WHERE a.guild_id = e.guild_id AND a.user_id = e.user_id AND a.dia >= e.entrou_dia) AS msgs,
         (SELECT COUNT(*) FROM atividade_diaria a
            WHERE a.guild_id = e.guild_id AND a.user_id = e.user_id
              AND a.dia BETWEEN e.entrou_dia AND date(e.entrou_dia, '+7 days')
              AND (a.mensagens > 0 OR a.minutos_voz > 0)) AS ativo_inicial,
         (SELECT COUNT(*) FROM atividade_diaria a
            WHERE a.guild_id = e.guild_id AND a.user_id = e.user_id AND a.dia >= @corte
              AND (a.mensagens > 0 OR a.minutos_voz > 0)) AS ativo_recente
       FROM entradas e LEFT JOIN links l ON l.id = e.link_id
       WHERE ${w.join(' AND ')}`,
    )
    .all(p);
  return { linhas, agora };
}

function calcular(ctx, { linhas, agora }) {
  const incluirFakes = !ctx.ajustes.get('fakes_fora');
  const diasRet = ctx.ajustes.get('retencao_dias');
  const fakes = linhas.filter((r) => r.fake).length;
  const base = incluirFakes ? linhas : linhas.filter((r) => !r.fake);

  const entradas = base.length;
  const saidas = base.filter((r) => r.saiu_em).length;
  const ativos = base.filter((r) => !r.saiu_em && r.ativo_recente > 0).length;

  const retencao = {};
  for (const n of diasRet) {
    const maduros = base.filter((r) => r.entrou_em <= agora - n * DIA);
    const ficaram = maduros.filter((r) => !r.saiu_em || r.saiu_em >= r.entrou_em + n * DIA);
    retencao[n] = pct(ficaram.length, maduros.length);
  }

  const maduros7 = base.filter((r) => r.entrou_em <= agora - 7 * DIA);
  const ativacao = pct(maduros7.filter((r) => r.ativo_inicial > 0).length, maduros7.length);
  const msgs = base.reduce((s, r) => s + r.msgs, 0);

  return {
    entradas,
    saidas,
    presentes: entradas - saidas,
    fakes,
    bruto: linhas.length,
    ativos,
    retencao,
    ativacao,
    msgsPorEntrada: entradas ? Math.round((msgs / entradas) * 10) / 10 : null,
    indice: pct(ativos, entradas),
  };
}

/** Métricas de um conjunto de entradas (um link, uma fonte, um tipo de origem ou o servidor todo). */
function metricas(ctx, filtro = {}) {
  return calcular(ctx, coletar(ctx, filtro));
}

function lerDesdeEntradas(ctx, filtro) {
  const { linhas, agora } = coletar(ctx, filtro);
  const incluirFakes = !ctx.ajustes.get('fakes_fora');
  return { linhas: incluirFakes ? linhas : linhas.filter((r) => !r.fake), agora };
}

function inicioDaSemana(dia) {
  const d = new Date(`${dia}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Entradas e saídas por dia ou por semana, com os dias sem movimento preenchidos com zero. */
function evolucao(ctx, filtro = {}, { agrupar = 'dia' } = {}) {
  const { linhas, agora } = lerDesdeEntradas(ctx, filtro);
  const tz = ctx.ajustes.get('fuso');
  const hoje = diaLocal(agora, tz);
  const mapa = new Map();
  const chaveDe = (dia) => (agrupar === 'semana' ? inicioDaSemana(dia) : dia);
  const somar = (dia, campo) => {
    const k = chaveDe(dia);
    if (!mapa.has(k)) mapa.set(k, { chave: k, entradas: 0, saidas: 0 });
    mapa.get(k)[campo] += 1;
  };
  for (const r of linhas) {
    somar(r.entrou_dia, 'entradas');
    if (r.saiu_dia) somar(r.saiu_dia, 'saidas');
  }
  let inicio = filtro.desde ? diaLocal(filtro.desde, tz) : null;
  if (!inicio && mapa.size) inicio = [...mapa.keys()].sort()[0];
  if (!inicio) return [];
  const fim = chaveDe(hoje);
  const saida = [];
  const passo = agrupar === 'semana' ? 7 : 1;
  const cursor = new Date(`${chaveDe(inicio)}T00:00:00Z`);
  for (let i = 0; i < 800; i += 1) {
    const k = cursor.toISOString().slice(0, 10);
    if (k > fim) break;
    saida.push(mapa.get(k) || { chave: k, entradas: 0, saidas: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + passo);
  }
  return saida;
}

function fontes(ctx) {
  return ctx.db
    .prepare(
      `SELECT DISTINCT COALESCE(fonte, nome) AS nome FROM links WHERE guild_id = ? ORDER BY 1 COLLATE NOCASE`,
    )
    .all(ctx.guildId)
    .map((r) => r.nome);
}

/** Uma linha por fonte (plataforma) mais as origens que não são links: URL personalizada, usuários e desconhecido. */
function plataformas(ctx, { desde = null, agora } = {}) {
  const base = { desde, agora };
  const out = fontes(ctx).map((nome) => ({
    nome,
    tipo: 'plataforma',
    ...metricas(ctx, { ...base, fonte: nome }),
  }));
  const extras = [
    ['URL personalizada', ['vanity']],
    ['Convites de usuários', ['usuario']],
    ['Desconhecido', ['desconhecido', 'ambiguo']],
  ];
  for (const [nome, tipos] of extras) {
    const m = metricas(ctx, { ...base, tipos });
    if (m.bruto > 0) out.push({ nome, tipo: 'outro', ...m });
  }
  return out;
}

/** Desempenho de cada link dentro de uma fonte (ou de todos), para comparar campanhas. */
function porLink(ctx, { desde = null, agora } = {}) {
  const links = ctx.db
    .prepare('SELECT id, nome, fonte, excluido_em FROM links WHERE guild_id = ? ORDER BY criado_em DESC')
    .all(ctx.guildId);
  return links.map((l) => ({
    id: l.id,
    nome: l.nome,
    fonte: l.fonte,
    removido: Boolean(l.excluido_em),
    ...metricas(ctx, { desde, agora, linkId: l.id }),
  }));
}

module.exports = { metricas, evolucao, plataformas, porLink, fontes, coletar };
