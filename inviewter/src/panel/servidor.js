'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const { config } = require('../config');
const links = require('../services/links');
const stats = require('../services/stats');
const entradas = require('../services/entradas');
const permissoes = require('../services/permissoes');
const recompensas = require('../services/recompensas');
const auditoria = require('../services/auditoria');
const formato = require('../formato');
const exportar = require('../exportar');
const acoes = require('../acoes');
const { parseDuracao, fusoValido, extrairCodigo } = require('../util');

const DISCORD = 'https://discord.com/api/v10';
const TIPOS_CANAL = new Set([0, 5]); // texto e anúncios

/** Painel web. Login pelo Discord; cada rota confere o cargo/permissão do usuário no servidor. */
function iniciar(app) {
  const base = config.panelBaseUrl;
  const seguro = base.startsWith('https://');
  const ex = express();
  ex.disable('x-powered-by');
  ex.set('trust proxy', 1);
  ex.use(express.json({ limit: '100kb' }));
  ex.use(cookieSession({
    name: 'inviewte',
    keys: [config.sessionSecret],
    maxAge: 7 * 24 * 3600 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: seguro,
  }));
  ex.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  const guild = () => app.client.guilds.cache.get(config.guildId);
  const ctx = app.ctx;

  /** Resolve um ID para nome e avatar, usando o cache do servidor e, se faltar, a API do Discord. */
  const cacheNomes = new Map();
  async function pessoa(id) {
    if (!id) return null;
    const m = guild()?.members.cache.get(id);
    if (m) return { id, nome: m.displayName, avatar: m.displayAvatarURL({ size: 32 }) };
    if (cacheNomes.has(id)) return cacheNomes.get(id);
    const u = await app.client.users.fetch(id).catch(() => null);
    const r = { id, nome: u ? (u.globalName || u.username) : `Usuário ${id}`, avatar: u ? u.displayAvatarURL({ size: 32 }) : null };
    cacheNomes.set(id, r);
    return r;
  }
  /** Vários IDs de uma vez (no máximo 60 distintos por chamada). */
  async function pessoas(ids) {
    const unicos = [...new Set(ids.filter(Boolean))].slice(0, 60);
    const lista = await Promise.all(unicos.map((i) => pessoa(i)));
    return new Map(lista.map((p) => [p.id, p]));
  }

  async function membroDaSessao(req) {
    const uid = req.session?.user?.id;
    const g = guild();
    if (!uid || !g) return null;
    return g.members.fetch(uid).catch(() => null);
  }

  function login(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ erro: 'Faça login com o Discord.' });
    return next();
  }

  /** acao: 'ver_stats' | 'gerir_links' | 'gerir_recompensas' | 'exportar' | 'admin' */
  function permissao(acao) {
    return async (req, res, next) => {
      const m = await membroDaSessao(req);
      if (!m) return res.status(403).json({ erro: 'Você não está no servidor configurado.' });
      const ok = acao === 'admin' ? permissoes.ehAdmin(m) : permissoes.permitido(ctx, m, acao);
      if (!ok) return res.status(403).json({ erro: 'Seu cargo não tem permissão para isso.' });
      req.membro = m;
      return next();
    };
  }

  const uid = (req) => req.session.user.id;
  const periodoDe = (req) => formato.desdeDe(String(req.query.periodo ?? '30'));

  ex.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  ex.use('/static', express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));

  ex.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.state = state;
    const q = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${base}/callback`,
      response_type: 'code',
      scope: 'identify',
      state,
      prompt: 'none',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${q}`);
  });

  ex.get('/callback', async (req, res) => {
    try {
      if (!req.query.code || req.query.state !== req.session.state) {
        return res.status(400).send('Login inválido ou expirado. Tente de novo pelo painel.');
      }
      req.session.state = null;
      const t = await fetch(`${DISCORD}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code: String(req.query.code),
          redirect_uri: `${base}/callback`,
        }),
      });
      if (!t.ok) throw new Error(`token ${t.status}`);
      const { access_token: token } = await t.json();
      const u = await fetch(`${DISCORD}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!u.ok) throw new Error(`usuário ${u.status}`);
      const me = await u.json();
      req.session.user = { id: me.id, nome: me.global_name || me.username, avatar: me.avatar };
      return res.redirect('/');
    } catch (e) {
      console.error('[painel] login', e.message);
      return res.status(500).send('Não consegui concluir o login com o Discord. Tente de novo.');
    }
  });

  ex.post('/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  ex.get('/api/me', async (req, res) => {
    if (!req.session?.user) return res.json({ logado: false });
    const user = req.session.user;
    const m = await membroDaSessao(req);
    if (!m) return res.json({ logado: true, acesso: false, user });
    const p = (a) => permissoes.permitido(ctx, m, a);
    return res.json({
      logado: true,
      acesso: true,
      user,
      permissoes: {
        ver: p('ver_stats'),
        links: p('gerir_links'),
        recompensas: p('gerir_recompensas'),
        exportar: p('exportar'),
        admin: permissoes.ehAdmin(m),
      },
    });
  });

  ex.get('/api/resumo', login, permissao('ver_stats'), (req, res) => {
    const periodo = String(req.query.periodo ?? '30');
    const desde = periodoDe(req);
    const plataformas = stats.plataformas(ctx, { desde }).sort((a, b) => (b.indice ?? -1) - (a.indice ?? -1));
    const evolucao = stats.evolucao(ctx, { desde }, { agrupar: periodo === 'tudo' ? 'semana' : 'dia' });
    res.json({ periodo, geral: stats.metricas(ctx, { desde }), plataformas, evolucao });
  });

  ex.get('/api/links', login, permissao('ver_stats'), (req, res) => {
    const desde = periodoDe(req);
    const por = new Map(stats.porLink(ctx, { desde }).map((l) => [l.id, l]));
    res.json(links.listar(ctx, { incluirExcluidos: true }).map((l) => {
      const m = por.get(l.id) || {};
      return {
        id: l.id, nome: l.nome, fonte: l.fonte, codigo: l.codigo, url: `https://discord.gg/${l.codigo}`,
        status: links.statusDe(l), validade: l.expira_em, usosMax: l.max_usos,
        entradas: m.entradas ?? 0, saidas: m.saidas ?? 0, fakes: m.fakes ?? 0,
        retencao: m.retencao ?? {}, ativos: m.ativos ?? 0, indice: m.indice ?? null,
      };
    }));
  });

  ex.get('/api/canais', login, permissao('gerir_links'), async (req, res) => {
    const g = guild();
    res.json([...g.channels.cache.values()].filter((c) => TIPOS_CANAL.has(c.type)).map((c) => ({ id: c.id, nome: c.name })));
  });

  ex.post('/api/links', login, permissao('gerir_links'), async (req, res, next) => {
    try {
      const { nome, fonte, canalId, validade, usos } = req.body || {};
      const validadeMs = parseDuracao(validade ?? 'perm');
      if (validadeMs === null) throw new Error('Validade inválida. Use algo como 30m, 12h, 7d ou perm.');
      const canal = canalId ? await guild().channels.fetch(String(canalId)).catch(() => null) : null;
      const r = await acoes.criarLink(app, {
        nome, fonte, canal, validadeMs, maxUsos: Number(usos) || 0, usuarioId: uid(req),
      });
      res.json({ id: r.link.id, url: r.url });
    } catch (e) { next(e); }
  });

  ex.post('/api/links/:id/renomear', login, permissao('gerir_links'), (req, res, next) => {
    try {
      const l = links.renomear(ctx, Number(req.params.id), req.body?.nome, req.body?.fonte);
      auditoria.registrar(ctx, uid(req), 'link_renomeado', l.nome);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  ex.post('/api/links/:id/desativar', login, permissao('gerir_links'), async (req, res, next) => {
    try {
      await acoes.desativarLink(app, Number(req.params.id), uid(req));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  ex.post('/api/links/:id/excluir', login, permissao('gerir_links'), async (req, res, next) => {
    try {
      await acoes.excluirLink(app, Number(req.params.id), { apagarDados: Boolean(req.body?.apagarDados), usuarioId: uid(req) });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  ex.get('/api/entradas', login, permissao('ver_stats'), async (req, res) => {
    const lista = entradas.buscar(ctx, {
      busca: req.query.busca ? String(req.query.busca) : null,
      apenasRevisar: req.query.revisar === '1',
      apenasFakes: req.query.fakes === '1',
      limite: 200,
    });
    const nomes = await pessoas(lista.map((e) => e.convidador_id));
    res.json(lista.map((e) => ({
      userId: e.user_id, tag: e.user_tag, entrouEm: e.entrou_em, saiuEm: e.saiu_em,
      origem: e.tipo_origem, link: e.link_nome, convidadorId: e.convidador_id,
      convidador: nomes.get(e.convidador_id) ?? null,
      fake: Boolean(e.fake), motivo: e.motivo_fake, revisar: Boolean(e.revisar), retornos: e.retornos,
    })));
  });

  ex.post('/api/entradas/:userId/fake', login, permissao('gerir_recompensas'), async (req, res, next) => {
    try {
      await acoes.definirFake(app, req.params.userId, Boolean(req.body?.valor), uid(req));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  ex.get('/api/ranking', login, permissao('ver_stats'), async (req, res) => {
    const lista = entradas.ranking(ctx, { desde: periodoDe(req), limite: 25 });
    const nomes = await pessoas(lista.map((r) => r.user_id));
    res.json(lista.map((r) => ({
      userId: r.user_id, pessoa: nomes.get(r.user_id) ?? null,
      validos: r.validos, entradas: r.entradas, saidas: r.saidas, fakes: r.fakes,
    })));
  });

  /** Consulta o equivalente do /invites: por ID ou por parte do nome. */
  ex.get('/api/convites/usuario', login, permissao('ver_stats'), async (req, res) => {
    const busca = String(req.query.busca ?? '').trim().toLowerCase();
    if (busca.length < 2) return res.json([]);
    let ids;
    if (/^\d{15,25}$/.test(busca)) {
      ids = [busca];
    } else {
      ids = [...guild().members.cache.values()]
        .filter((m) => !m.user.bot && (m.displayName.toLowerCase().includes(busca) || m.user.username.toLowerCase().includes(busca)))
        .slice(0, 10)
        .map((m) => m.id);
    }
    const nomes = await pessoas(ids);
    return res.json(ids.map((id) => ({ pessoa: nomes.get(id), ...entradas.contagemConvites(ctx, id) })));
  });

  /** Convites do Discord que ainda não viraram links do InViewte. */
  ex.get('/api/convites-livres', login, permissao('gerir_links'), async (req, res, next) => {
    try {
      const lista = await acoes.convitesNaoRegistrados(app);
      const nomes = await pessoas(lista.map((c) => c.inviter?.id));
      res.json(lista.map((c) => ({
        codigo: c.code, url: `https://discord.gg/${c.code}`, usos: c.uses ?? 0, maxUsos: c.maxUses ?? 0,
        validade: c.expiresTimestamp ?? null, canal: c.channel?.name ?? null,
        criadoPor: nomes.get(c.inviter?.id)?.nome ?? null,
      })));
    } catch (e) { next(e); }
  });

  ex.post('/api/links/importar', login, permissao('gerir_links'), async (req, res, next) => {
    try {
      const codigo = extrairCodigo(req.body?.codigo);
      if (!codigo) throw new Error('Código de convite inválido.');
      const l = await acoes.importarLink(app, { codigo, nome: req.body?.nome, fonte: req.body?.fonte, usuarioId: uid(req) });
      res.json({ id: l.id });
    } catch (e) { next(e); }
  });

  /** Detalhe de uma plataforma: métricas, cada link dela e a evolução no período. */
  ex.get('/api/plataforma', login, permissao('ver_stats'), (req, res, next) => {
    try {
      const fonte = String(req.query.fonte ?? '').trim();
      if (!fonte) throw new Error('Informe a plataforma.');
      const periodo = String(req.query.periodo ?? '30');
      const desde = periodoDe(req);
      const porLink = stats.porLink(ctx, { desde }).filter((l) => (l.fonte ?? l.nome).toLowerCase() === fonte.toLowerCase());
      res.json({
        fonte,
        periodo,
        geral: stats.metricas(ctx, { fonte, desde }),
        links: porLink,
        evolucao: stats.evolucao(ctx, { fonte, desde }, { agrupar: periodo === 'tudo' ? 'semana' : 'dia' }),
      });
    } catch (e) { next(e); }
  });

  ex.post('/api/resetar/usuario', login, permissao('gerir_recompensas'), async (req, res, next) => {
    try {
      const userId = String(req.body?.userId ?? '');
      if (!/^\d{15,25}$/.test(userId)) throw new Error('Membro inválido.');
      const n = await acoes.resetarUsuario(app, userId, { metricas: Boolean(req.body?.metricas), usuarioId: uid(req) });
      res.json({ entradas: n });
    } catch (e) { next(e); }
  });

  ex.post('/api/resetar/servidor', login, permissao('admin'), async (req, res, next) => {
    try {
      if (req.body?.confirmar !== 'RESETAR') throw new Error('Digite RESETAR para confirmar.');
      const r = await acoes.resetarServidor(app, { metricas: Boolean(req.body?.metricas), usuarioId: uid(req) });
      res.json(r);
    } catch (e) { next(e); }
  });

  ex.get('/api/auditoria', login, permissao('admin'), async (req, res) => {
    const linhas = auditoria.recentes(ctx, 100);
    const nomes = await pessoas(linhas.map((l) => l.user_id));
    res.json(linhas.map((l) => ({
      id: l.id, quando: l.quando, acao: l.acao, detalhes: l.detalhes,
      pessoa: nomes.get(l.user_id) ?? null,
    })));
  });

  ex.get('/api/export/:tipo', login, permissao('exportar'), (req, res, next) => {
    try {
      if (!exportar.TIPOS.includes(req.params.tipo)) throw new Error('Tipo de exportação inválido.');
      const r = exportar.gerar(ctx, req.params.tipo, { desde: periodoDe(req) });
      res.attachment(r.nome);
      res.type('text/csv; charset=utf-8').send(r.conteudo);
    } catch (e) { next(e); }
  });

  ex.get('/api/config', login, permissao('admin'), (req, res) => {
    const a = ctx.ajustes;
    res.json({
      canais: {
        plataformas: a.get('canal_log_plataforma'), usuarios: a.get('canal_log_usuarios'),
        saidas: a.get('canal_log_saidas'), alertas: a.get('canal_alertas'), relatorios: a.get('canal_relatorio'),
      },
      fuso: a.get('fuso'),
      antiabuso: {
        contaDias: a.get('fake_conta_dias'), saidaMin: a.get('fake_saida_min'),
        picoQtd: a.get('fake_pico_qtd'), picoMin: a.get('fake_pico_min'),
        avatarPadrao: a.get('fake_avatar'), fakesNasMetricas: !a.get('fakes_fora'),
      },
      relatorios: { semanal: a.get('relatorio_semanal'), mensal: a.get('relatorio_mensal') },
      recompensa: recompensas.configuracao(ctx),
      permissoes: permissoes.listar(ctx),
    });
  });

  ex.post('/api/config', login, permissao('admin'), (req, res, next) => {
    try {
      const b = req.body || {};
      const a = ctx.ajustes;
      const inteiro = (v, min, max, nome) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nome} deve ser um número entre ${min} e ${max}.`);
        return n;
      };
      if (b.canais) {
        const mapa = { plataformas: 'canal_log_plataforma', usuarios: 'canal_log_usuarios', saidas: 'canal_log_saidas', alertas: 'canal_alertas', relatorios: 'canal_relatorio' };
        for (const [k, chave] of Object.entries(mapa)) {
          if (k in b.canais) a.set(chave, b.canais[k] || null);
        }
      }
      if (b.fuso !== undefined) {
        if (!fusoValido(String(b.fuso))) throw new Error('Fuso inválido. Use um nome IANA, ex.: America/Sao_Paulo.');
        a.set('fuso', String(b.fuso));
      }
      if (b.antiabuso) {
        const x = b.antiabuso;
        if (x.contaDias !== undefined) a.set('fake_conta_dias', inteiro(x.contaDias, 0, 365, 'Conta nova'));
        if (x.saidaMin !== undefined) a.set('fake_saida_min', inteiro(x.saidaMin, 0, 10080, 'Saída rápida'));
        if (x.picoQtd !== undefined) a.set('fake_pico_qtd', inteiro(x.picoQtd, 0, 1000, 'Pico (quantidade)'));
        if (x.picoMin !== undefined) a.set('fake_pico_min', inteiro(x.picoMin, 1, 60, 'Pico (minutos)'));
        if (x.avatarPadrao !== undefined) a.set('fake_avatar', Boolean(x.avatarPadrao));
        if (x.fakesNasMetricas !== undefined) a.set('fakes_fora', !x.fakesNasMetricas);
      }
      if (b.relatorios) {
        if (b.relatorios.semanal !== undefined) a.set('relatorio_semanal', Boolean(b.relatorios.semanal));
        if (b.relatorios.mensal !== undefined) a.set('relatorio_mensal', Boolean(b.relatorios.mensal));
      }
      auditoria.registrar(ctx, uid(req), 'config_painel', Object.keys(b).join(','));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  ex.get('/api/cargos', login, permissao('admin'), (req, res) => {
    const g = guild();
    res.json([...g.roles.cache.values()]
      .filter((r) => !r.managed && r.id !== g.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, nome: r.name })));
  });

  ex.post('/api/permissoes', login, permissao('admin'), (req, res, next) => {
    try {
      const { cargoId, perms } = req.body || {};
      if (!cargoId) throw new Error('Escolha um cargo.');
      const v = {};
      for (const a of permissoes.ACOES) v[a] = Boolean(perms?.[a]);
      permissoes.definir(ctx, String(cargoId), v);
      auditoria.registrar(ctx, uid(req), 'permissao_painel', `${cargoId} ${JSON.stringify(v)}`);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  ex.post('/api/recompensa', login, permissao('admin'), (req, res, next) => {
    try {
      const b = req.body || {};
      if (!b.ativa) {
        recompensas.desativar(ctx);
      } else {
        if (!b.cargoId) throw new Error('Escolha o cargo da recompensa.');
        const minimo = Number(b.minimo);
        if (!Number.isInteger(minimo) || minimo < 1 || minimo > 10000) throw new Error('Convites necessários: entre 1 e 10000.');
        recompensas.definir(ctx, { cargoId: String(b.cargoId), minimo, remover: Boolean(b.remover) });
      }
      auditoria.registrar(ctx, uid(req), 'recompensa_painel', b.ativa ? `cargo ${b.cargoId}, mínimo ${b.minimo}` : 'desativada');
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  ex.use((err, req, res, _next) => {
    console.error('[painel]', err.message);
    res.status(400).json({ erro: err.message || 'Não foi possível concluir a ação.' });
  });

  return ex.listen(config.port, () => {
    console.log(`[painel] ouvindo na porta ${config.port}`);
  });
}

module.exports = { iniciar };
