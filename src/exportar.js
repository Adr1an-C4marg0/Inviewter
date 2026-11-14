'use strict';

const { csv, fmtData } = require('./util');
const links = require('./services/links');
const entradas = require('./services/entradas');
const stats = require('./services/stats');

const TIPOS = ['links', 'entradas', 'evolucao', 'plataformas'];

function sn(v) {
  return v ? 'sim' : 'não';
}

/** Gera o CSV pedido. Devolve { nome, conteudo }. */
function gerar(ctx, tipo, { desde = null } = {}) {
  const fuso = ctx.ajustes.get('fuso');
  const data = new Date().toISOString().slice(0, 10);
  const nome = `inviewter-${tipo}-${data}.csv`;

  if (tipo === 'links') {
    const m = new Map(stats.porLink(ctx, { desde }).map((x) => [x.id, x]));
    const linhas = links.listar(ctx, { incluirExcluidos: true }).map((l) => ({ l, m: m.get(l.id) }));
    return {
      nome,
      conteudo: csv(linhas, [
        { titulo: 'nome', valor: ({ l }) => l.nome },
        { titulo: 'fonte', valor: ({ l }) => l.fonte ?? l.nome },
        { titulo: 'codigo', valor: ({ l }) => l.codigo },
        { titulo: 'status', valor: ({ l }) => links.statusDe(l) },
        { titulo: 'criado_em', valor: ({ l }) => fmtData(l.criado_em, fuso) },
        { titulo: 'validade', valor: ({ l }) => (l.expira_em ? fmtData(l.expira_em, fuso) : 'permanente') },
        { titulo: 'usos_max', valor: ({ l }) => l.max_usos || 'ilimitado' },
        { titulo: 'entradas', valor: ({ m: x }) => x?.entradas ?? 0 },
        { titulo: 'saidas', valor: ({ m: x }) => x?.saidas ?? 0 },
        { titulo: 'fakes', valor: ({ m: x }) => x?.fakes ?? 0 },
        { titulo: 'retencao_d7_pct', valor: ({ m: x }) => x?.retencao?.[7] ?? '' },
        { titulo: 'retencao_d30_pct', valor: ({ m: x }) => x?.retencao?.[30] ?? '' },
        { titulo: 'ativos', valor: ({ m: x }) => x?.ativos ?? 0 },
        { titulo: 'indice_qualidade_pct', valor: ({ m: x }) => x?.indice ?? '' },
      ]),
    };
  }

  if (tipo === 'plataformas') {
    return {
      nome,
      conteudo: csv(stats.plataformas(ctx, { desde }), [
        { titulo: 'plataforma', valor: (p) => p.nome },
        { titulo: 'entradas', valor: (p) => p.entradas },
        { titulo: 'saidas', valor: (p) => p.saidas },
        { titulo: 'fakes', valor: (p) => p.fakes },
        { titulo: 'retencao_d7_pct', valor: (p) => p.retencao[7] ?? '' },
        { titulo: 'retencao_d30_pct', valor: (p) => p.retencao[30] ?? '' },
        { titulo: 'ativos', valor: (p) => p.ativos },
        { titulo: 'indice_qualidade_pct', valor: (p) => p.indice ?? '' },
        { titulo: 'ativacao_7d_pct', valor: (p) => p.ativacao ?? '' },
        { titulo: 'mensagens_por_entrada', valor: (p) => p.msgsPorEntrada ?? '' },
      ]),
    };
  }

  if (tipo === 'evolucao') {
    const dias = stats.evolucao(ctx, { desde }, { agrupar: 'dia' });
    return {
      nome,
      conteudo: csv(dias, [
        { titulo: 'dia', valor: (d) => d.chave },
        { titulo: 'entradas', valor: (d) => d.entradas },
        { titulo: 'saidas', valor: (d) => d.saidas },
      ]),
    };
  }

  if (tipo === 'entradas') {
    const linhas = entradas.buscar(ctx, { limite: 100000 }).filter((e) => !desde || e.entrou_em >= desde);
    return {
      nome,
      conteudo: csv(linhas, [
        { titulo: 'user_id', valor: (e) => e.user_id },
        { titulo: 'usuario', valor: (e) => e.user_tag },
        { titulo: 'entrou_em', valor: (e) => fmtData(e.entrou_em, fuso) },
        { titulo: 'saiu_em', valor: (e) => (e.saiu_em ? fmtData(e.saiu_em, fuso) : '') },
        { titulo: 'origem', valor: (e) => e.tipo_origem },
        { titulo: 'link', valor: (e) => e.link_nome ?? '' },
        { titulo: 'fonte', valor: (e) => e.link_fonte ?? '' },
        { titulo: 'convidador_id', valor: (e) => e.convidador_id ?? '' },
        { titulo: 'codigo', valor: (e) => e.codigo ?? '' },
        { titulo: 'conta_criada_em', valor: (e) => (e.conta_criada_em ? fmtData(e.conta_criada_em, fuso) : '') },
        { titulo: 'fake', valor: (e) => sn(e.fake) },
        { titulo: 'motivo_fake', valor: (e) => e.motivo_fake ?? '' },
        { titulo: 'retornos', valor: (e) => e.retornos },
      ]),
    };
  }

  throw new Error(`Tipo de exportação desconhecido: ${tipo}`);
}

module.exports = { TIPOS, gerar };
