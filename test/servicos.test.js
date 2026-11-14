'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { novoCtx, membroFalso } = require('./ajudas');
const util = require('../src/util');
const links = require('../src/services/links');
const entradas = require('../src/services/entradas');
const atividade = require('../src/services/atividade');
const stats = require('../src/services/stats');
const antiabuso = require('../src/services/antiabuso');
const permissoes = require('../src/services/permissoes');
const recompensas = require('../src/services/recompensas');

const { DIA, HORA, MIN } = util;

test('util: duração, dia local, código de convite e CSV', () => {
  assert.equal(util.parseDuracao('7d'), 7 * DIA);
  assert.equal(util.parseDuracao('12h'), 12 * HORA);
  assert.equal(util.parseDuracao('30m'), 30 * MIN);
  assert.equal(util.parseDuracao('2w'), 14 * DIA);
  assert.equal(util.parseDuracao('perm'), 0);
  assert.equal(util.parseDuracao(''), 0);
  assert.equal(util.parseDuracao('abc'), null);
  assert.equal(util.parseDuracao('9999d'), null);
  // 02:00 UTC ainda é o dia anterior em São Paulo (UTC-3)
  assert.equal(util.diaLocal(Date.UTC(2026, 10, 12, 2, 0), 'America/Sao_Paulo'), '2026-11-11');
  assert.equal(util.diaLocal(Date.UTC(2026, 10, 12, 4, 0), 'America/Sao_Paulo'), '2026-11-12');
  assert.equal(util.extrairCodigo('https://discord.gg/AbC-123'), 'AbC-123');
  assert.equal(util.extrairCodigo('discord.com/invite/xyz'), 'xyz');
  assert.equal(util.extrairCodigo('abc123'), 'abc123');
  assert.equal(util.extrairCodigo('não é código!'), null);
  const c = util.csv([{ a: '=1+1', b: 'x,y' }], [
    { titulo: 'a', valor: (l) => l.a },
    { titulo: 'b', valor: (l) => l.b },
  ]);
  assert.match(c, /'=1\+1/);
  assert.match(c, /"x,y"/);
});

test('links: nomes únicos, referência por nome, desativar e excluir preservando histórico', () => {
  const ctx = novoCtx();
  const a = links.registrar(ctx, { codigo: 'aaa', nome: 'Instagram', fonte: 'Instagram' });
  assert.equal(a.nome, 'Instagram');
  assert.throws(() => links.registrar(ctx, { codigo: 'bbb', nome: 'instagram' }), /Já existe/);
  assert.throws(() => links.registrar(ctx, { codigo: 'aaa', nome: 'Outro' }), /já está registrado/);
  assert.equal(links.porReferencia(ctx, 'INSTAGRAM').id, a.id);
  assert.equal(links.porReferencia(ctx, String(a.id)).id, a.id);

  const b = links.registrar(ctx, { codigo: 'bbb', nome: 'Bio', fonte: 'Instagram' });
  links.renomear(ctx, b.id, 'Bio nova');
  assert.equal(links.obter(ctx, b.id).nome, 'Bio nova');
  assert.throws(() => links.renomear(ctx, b.id, 'Instagram'), /Já existe/);

  entradas.registrarEntrada(ctx, { userId: 'u1', tipoOrigem: 'plataforma', linkId: a.id, codigo: 'aaa' });
  links.desativar(ctx, a.id);
  assert.equal(links.statusDe(links.obter(ctx, a.id)), 'desativado');
  // código continua reconhecido depois de desativar
  assert.equal(links.porCodigo(ctx, 'aaa').id, a.id);

  const r = links.excluir(ctx, a.id, false);
  assert.equal(r.entradasApagadas, 0);
  assert.equal(links.statusDe(links.obter(ctx, a.id)), 'removido');
  assert.equal(links.porReferencia(ctx, 'Instagram'), null);
  assert.ok(entradas.obter(ctx, 'u1'), 'histórico mantido');
  assert.ok(links.listar(ctx, { incluirExcluidos: true }).some((l) => l.id === a.id));
  assert.ok(!links.listar(ctx).some((l) => l.id === a.id));
  // nome liberado após excluir
  links.registrar(ctx, { codigo: 'ccc', nome: 'Instagram' });

  const c = links.registrar(ctx, { codigo: 'ddd', nome: 'Apagar' });
  entradas.registrarEntrada(ctx, { userId: 'u2', tipoOrigem: 'plataforma', linkId: c.id, codigo: 'ddd' });
  assert.equal(links.excluir(ctx, c.id, true).entradasApagadas, 1);
  assert.equal(entradas.obter(ctx, 'u2'), null);
});

test('links: expiração marca como inativo', () => {
  const ctx = novoCtx();
  const agora = Date.now();
  links.registrar(ctx, { codigo: 'x1', nome: 'Velho', expiraEm: agora - 1000 });
  links.registrar(ctx, { codigo: 'x2', nome: 'Novo', expiraEm: agora + DIA });
  const exp = links.expirados(ctx, agora);
  assert.deepEqual(exp.map((l) => l.codigo), ['x1']);
  assert.equal(links.statusDe(links.porCodigo(ctx, 'x1'), agora), 'expirado');
  assert.equal(links.statusDe(links.porCodigo(ctx, 'x2'), agora), 'ativo');
  assert.deepEqual(links.expirados(ctx, agora), []);
});

test('entradas: retorno reabre a mesma linha e mantém a origem do primeiro link', () => {
  const ctx = novoCtx();
  const l = links.registrar(ctx, { codigo: 'aaa', nome: 'Insta' });
  const t0 = Date.now() - 10 * DIA;
  entradas.registrarEntrada(ctx, { userId: 'u1', tipoOrigem: 'plataforma', linkId: l.id, codigo: 'aaa', agora: t0 });
  entradas.registrarSaida(ctx, 'u1', t0 + 2 * DIA);
  assert.ok(entradas.obter(ctx, 'u1').saiu_em);
  const r = entradas.registrarEntrada(ctx, { userId: 'u1', tipoOrigem: 'usuario', convidadorId: 'x' });
  assert.equal(r.retorno, true);
  assert.equal(r.entrada.tipo_origem, 'plataforma');
  assert.equal(r.entrada.link_id, l.id);
  assert.equal(r.entrada.retornos, 1);
  assert.equal(r.entrada.saiu_em, null);
  assert.equal(stats.metricas(ctx, { linkId: l.id }).entradas, 1);
});

test('anti-abuso: conta nova é fake, saída rápida reclassifica, marcação manual vence a regra', () => {
  const ctx = novoCtx();
  const agora = Date.now();
  const cfg = antiabuso.cfgDe(ctx);
  assert.equal(antiabuso.avaliarEntrada(cfg, { contaCriadaEm: agora - 2 * DIA, agora }).fake, true);
  assert.equal(antiabuso.avaliarEntrada(cfg, { contaCriadaEm: agora - 30 * DIA, agora }).fake, false);
  assert.deepEqual(antiabuso.avaliarEntrada({ ...cfg, avatar: true }, { contaCriadaEm: agora - 30 * DIA, avatarPadrao: true, agora }).selos, ['avatar padrão']);

  entradas.registrarEntrada(ctx, { userId: 'a', tipoOrigem: 'desconhecido', agora: agora - 10 * MIN });
  const s = entradas.registrarSaida(ctx, 'a', agora);
  assert.equal(s.viroFake, true);
  assert.equal(entradas.obter(ctx, 'a').motivo_fake, 'saída rápida');

  entradas.registrarEntrada(ctx, { userId: 'b', tipoOrigem: 'desconhecido', agora: agora - 10 * MIN });
  entradas.marcarFake(ctx, 'b', false);
  assert.equal(entradas.registrarSaida(ctx, 'b', agora).viroFake, false);
  assert.equal(entradas.obter(ctx, 'b').fake, 0);

  entradas.registrarEntrada(ctx, { userId: 'c', tipoOrigem: 'desconhecido', agora: agora - 5 * DIA });
  assert.equal(entradas.marcarFake(ctx, 'c', true).fake, 1);
});

test('anti-abuso: detector de pico alerta uma vez por janela', () => {
  const d = new antiabuso.DetectorPico();
  const t = 1_000_000;
  let alertas = 0;
  for (let i = 0; i < 12; i += 1) if (d.registrar('k', t + i * 1000, 10, 5).pico) alertas += 1;
  assert.equal(alertas, 1);
  // fora da janela, conta de novo
  assert.equal(d.registrar('k', t + 20 * MIN, 10, 5).total, 1);
});

test('convites de usuários: válidos = entradas − saídas − fakes; ranking; resets', () => {
  const ctx = novoCtx();
  const agora = Date.now();
  const novo = (id, extra = {}) =>
    entradas.registrarEntrada(ctx, { userId: id, tipoOrigem: 'usuario', convidadorId: 'ana', agora: agora - 20 * DIA, ...extra });
  novo('v1');
  novo('v2');
  novo('v3');
  novo('f1', { fake: true, motivoFake: 'conta nova' });
  entradas.registrarEntrada(ctx, { userId: 'b1', tipoOrigem: 'usuario', convidadorId: 'bia', agora: agora - 20 * DIA });
  entradas.registrarSaida(ctx, 'v3', agora - 5 * DIA);

  assert.deepEqual(entradas.contagemConvites(ctx, 'ana'), { entradas: 4, saidas: 1, fakes: 1, validos: 2 });
  const rk = entradas.ranking(ctx);
  assert.deepEqual(rk.map((r) => [r.user_id, r.validos]), [['ana', 2], ['bia', 1]]);

  assert.equal(entradas.resetarUsuario(ctx, 'ana'), 4);
  assert.equal(entradas.contagemConvites(ctx, 'ana').validos, 0);
  assert.equal(entradas.contagemConvites(ctx, 'bia').validos, 1);
  assert.equal(entradas.obter(ctx, 'v1').conta_metricas, 1, 'métricas preservadas por padrão');

  const r = entradas.resetarServidor(ctx, { metricas: true });
  assert.equal(r.convites, 1);
  assert.equal(stats.metricas(ctx).entradas, 0);
});

test('métricas: retenção, ativos, ativação e índice por plataforma', () => {
  const ctx = novoCtx();
  const agora = Date.now();
  const tz = ctx.ajustes.get('fuso');
  const insta = links.registrar(ctx, { codigo: 'ig', nome: 'Bio', fonte: 'Instagram' });
  const tik = links.registrar(ctx, { codigo: 'tt', nome: 'Perfil', fonte: 'TikTok' });

  // Instagram: 10 entradas há 40 dias; 3 saíram cedo; 2 ficaram e são ativos
  for (let i = 0; i < 10; i += 1) {
    entradas.registrarEntrada(ctx, { userId: `i${i}`, tipoOrigem: 'plataforma', linkId: insta.id, codigo: 'ig', agora: agora - 40 * DIA });
  }
  for (let i = 0; i < 3; i += 1) entradas.registrarSaida(ctx, `i${i}`, agora - 40 * DIA + 2 * DIA); // saíram no D2
  for (let i = 3; i < 5; i += 1) entradas.registrarSaida(ctx, `i${i}`, agora - 5 * DIA); // saíram no D35 (ficaram >30d)
  for (const u of ['i5', 'i6']) atividade.somar(ctx, u, { mensagens: 4, agora });
  atividade.somar(ctx, 'i7', { mensagens: 1, agora: agora - 39 * DIA }); // ativou nos 1ºs dias, hoje inativo

  // TikTok: 2 entradas, 2 ativas
  for (let i = 0; i < 2; i += 1) {
    entradas.registrarEntrada(ctx, { userId: `t${i}`, tipoOrigem: 'plataforma', linkId: tik.id, codigo: 'tt', agora: agora - 10 * DIA });
    atividade.somar(ctx, `t${i}`, { mensagens: 10, agora });
    atividade.somar(ctx, `t${i}`, { mensagens: 3, agora: agora - 9 * DIA });
  }

  const mi = stats.metricas(ctx, { fonte: 'Instagram', agora });
  assert.equal(mi.entradas, 10);
  assert.equal(mi.saidas, 5);
  assert.equal(mi.presentes, 5);
  assert.equal(mi.retencao[7], 70); // 3 saíram antes de 7 dias
  assert.equal(mi.retencao[30], 70); // i0-i2 saíram no D2; i3-i4 saíram no D35 (já tinham passado do D30)
  assert.equal(mi.ativos, 2);
  assert.equal(mi.indice, 20);
  assert.equal(mi.ativacao, 10); // só i7 foi ativo nos primeiros 7 dias

  const mt = stats.metricas(ctx, { fonte: 'TikTok', agora });
  assert.equal(mt.entradas, 2);
  assert.equal(mt.ativos, 2);
  assert.equal(mt.indice, 100);
  // poucas entradas e muito ativas ganham de muitas e pouco ativas
  const ps = stats.plataformas(ctx, { agora }).sort((x, y) => y.indice - x.indice);
  assert.equal(ps[0].nome, 'TikTok');
  assert.deepEqual(stats.fontes(ctx).sort(), ['Instagram', 'TikTok']);
});

test('métricas: fakes ficam fora por padrão e entram se configurado', () => {
  const ctx = novoCtx();
  const agora = Date.now();
  const l = links.registrar(ctx, { codigo: 'k', nome: 'K' });
  for (const id of ['a', 'b']) entradas.registrarEntrada(ctx, { userId: id, tipoOrigem: 'plataforma', linkId: l.id, agora: agora - 9 * DIA });
  entradas.registrarEntrada(ctx, { userId: 'f', tipoOrigem: 'plataforma', linkId: l.id, fake: true, motivoFake: 'conta nova', agora: agora - 9 * DIA });
  let m = stats.metricas(ctx, { linkId: l.id, agora });
  assert.equal(m.entradas, 2);
  assert.equal(m.fakes, 1);
  ctx.ajustes.set('fakes_fora', false);
  m = stats.metricas(ctx, { linkId: l.id, agora });
  assert.equal(m.entradas, 3);
});

test('evolução por dia e por semana preenche dias sem entradas', () => {
  const ctx = novoCtx();
  const agora = Date.UTC(2026, 10, 12, 15, 0);
  const t = (dias) => agora - dias * DIA;
  entradas.registrarEntrada(ctx, { userId: 'a', tipoOrigem: 'desconhecido', agora: t(3) });
  entradas.registrarEntrada(ctx, { userId: 'b', tipoOrigem: 'desconhecido', agora: t(3) });
  entradas.registrarEntrada(ctx, { userId: 'c', tipoOrigem: 'desconhecido', agora: t(1) });
  entradas.registrarSaida(ctx, 'c', t(0));
  const dias = stats.evolucao(ctx, { desde: t(4), agora }, { agrupar: 'dia' });
  assert.equal(dias.length, 5);
  assert.deepEqual(dias.map((d) => d.entradas), [0, 2, 0, 1, 0]);
  assert.equal(dias.at(-1).saidas, 1);
  const semanas = stats.evolucao(ctx, { desde: t(10), agora }, { agrupar: 'semana' });
  assert.equal(semanas.reduce((s, x) => s + x.entradas, 0), 3);
  assert.ok(semanas.every((s) => new Date(`${s.chave}T00:00:00Z`).getUTCDay() === 1), 'semanas começam na segunda');
});

test('permissões: admin, cargo com permissão específica e membro comum', () => {
  const ctx = novoCtx();
  const admin = membroFalso({ admin: true });
  const mkt = membroFalso({ cargos: ['mkt'] });
  const comum = membroFalso({ cargos: ['x'] });
  assert.equal(permissoes.permitido(ctx, admin, 'exportar'), true);
  assert.equal(permissoes.permitido(ctx, mkt, 'ver_stats'), false);
  permissoes.definir(ctx, 'mkt', { ver_stats: true, exportar: true });
  assert.equal(permissoes.permitido(ctx, mkt, 'ver_stats'), true);
  assert.equal(permissoes.permitido(ctx, mkt, 'exportar'), true);
  assert.equal(permissoes.permitido(ctx, mkt, 'gerir_links'), false);
  assert.equal(permissoes.permitido(ctx, comum, 'ver_stats'), false);
  permissoes.definir(ctx, 'mkt', {});
  assert.equal(permissoes.permitido(ctx, mkt, 'ver_stats'), false);
  assert.equal(permissoes.listar(ctx).length, 0);
});

function guildComCargo({ temCargo = false, cargoExiste = true } = {}) {
  const chamadas = [];
  const membro = {
    id: 'ana',
    roles: {
      cache: new Map(temCargo ? [['R', {}]] : []),
      add: async (r) => { chamadas.push(['add', r.id]); membro.roles.cache.set('R', r); },
      remove: async (r) => { chamadas.push(['remove', r.id]); membro.roles.cache.delete('R'); },
    },
  };
  const role = { id: 'R' };
  return {
    chamadas,
    membro,
    members: { fetch: async () => membro },
    roles: { cache: new Map(cargoExiste ? [['R', role]] : []), fetch: async () => (cargoExiste ? role : null) },
  };
}

test('recompensa opcional: desligada não faz nada; ligada concede uma vez e respeita remoção manual', async () => {
  const ctx = novoCtx();
  const agora = Date.now();
  for (let i = 0; i < 3; i += 1) {
    entradas.registrarEntrada(ctx, { userId: `v${i}`, tipoOrigem: 'usuario', convidadorId: 'ana', agora: agora - 20 * DIA });
  }
  const g = guildComCargo();
  assert.equal((await recompensas.avaliar(ctx, g, 'ana')).acao, null);
  assert.equal(g.chamadas.length, 0, 'opcional: desligada por padrão');

  recompensas.definir(ctx, { cargoId: 'R', minimo: 3, remover: false });
  assert.equal((await recompensas.avaliar(ctx, g, 'ana')).acao, 'concedido');
  assert.deepEqual(g.chamadas, [['add', 'R']]);
  // admin tira o cargo manualmente: o bot não devolve
  g.membro.roles.cache.delete('R');
  assert.equal((await recompensas.avaliar(ctx, g, 'ana')).acao, null);

  // abaixo do mínimo e sem "remover ao cair": mantém
  entradas.registrarSaida(ctx, 'v0', agora - DIA);
  g.membro.roles.cache.set('R', {});
  assert.equal((await recompensas.avaliar(ctx, g, 'ana')).acao, null);
  recompensas.definir(ctx, { cargoId: 'R', minimo: 3, remover: true });
  assert.equal((await recompensas.avaliar(ctx, g, 'ana')).acao, 'removido');

  recompensas.desativar(ctx);
  assert.equal(recompensas.configuracao(ctx).ativa, false);
});

test('recompensa: cargo apagado não quebra', async () => {
  const ctx = novoCtx();
  recompensas.definir(ctx, { cargoId: 'R', minimo: 1, remover: false });
  const r = await recompensas.avaliar(ctx, guildComCargo({ cargoExiste: false }), 'ana');
  assert.equal(r.acao, null);
  assert.match(r.motivoFalha, /cargo/);
});
