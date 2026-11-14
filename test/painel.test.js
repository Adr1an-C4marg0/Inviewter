'use strict';

// Variáveis de ambiente precisam existir antes de carregar o painel.
process.env.DISCORD_TOKEN = 'x';
process.env.CLIENT_ID = '1';
process.env.GUILD_ID = 'g1';
process.env.PANEL_BASE_URL = 'http://localhost:38917';
process.env.DISCORD_CLIENT_SECRET = 's';
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.PORT = '38917';

const test = require('node:test');
const assert = require('node:assert/strict');
const Keygrip = require('keygrip');
const { novoCtx } = require('./ajudas');
const links = require('../src/services/links');
const entradas = require('../src/services/entradas');
const atividade = require('../src/services/atividade');
const { DIA } = require('../src/util');
const painel = require('../src/panel/servidor');

const BASE = 'http://localhost:38917';
const ID_ANA = '100000000000000001';
const ID_BIA = '100000000000000002';
const ID_ADMIN = '100000000000000009';
const ID_COMUM = '100000000000000008';

function membro(id, nome, { admin = false } = {}) {
  return {
    id,
    displayName: nome,
    user: { id, username: nome.toLowerCase(), bot: false },
    permissions: { has: (p) => admin && (p === 'Administrator' || p === 'ManageGuild') },
    roles: { cache: new Map() },
    displayAvatarURL: () => `https://cdn.example/${id}.png`,
  };
}

function cookieDe(userId) {
  const valor = Buffer.from(JSON.stringify({ user: { id: userId, nome: 'Teste' } })).toString('base64');
  const sig = new Keygrip(['segredo-de-teste']).sign(`inviewter=${valor}`);
  return `inviewter=${valor}; inviewter.sig=${sig}`;
}

async function chamar(metodo, caminho, { usuario = ID_ADMIN, corpo } = {}) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { Cookie: cookieDe(usuario), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* não é JSON */ }
  return { status: r.status, json, texto };
}

test('painel: novas rotas (nomes, importar, resets, detalhe, auditoria, permissões)', async (t) => {
  const ctx = novoCtx();
  const agora = Date.now();

  const insta = links.registrar(ctx, { codigo: 'ig1', nome: 'Bio', fonte: 'Instagram' });
  links.registrar(ctx, { codigo: 'ig2', nome: 'Stories', fonte: 'Instagram' });
  for (const [i, l] of [[0, insta], [1, insta]]) {
    entradas.registrarEntrada(ctx, { userId: `20000000000000000${i}`, tipoOrigem: 'plataforma', linkId: l.id, codigo: 'ig1', agora: agora - 12 * DIA });
    atividade.somar(ctx, `20000000000000000${i}`, { mensagens: 3, agora });
  }
  for (const u of ['300000000000000001', '300000000000000002']) {
    entradas.registrarEntrada(ctx, { userId: u, userTag: `conv${u.slice(-1)}`, tipoOrigem: 'usuario', convidadorId: ID_ANA, codigo: 'zzz', agora: agora - 12 * DIA });
  }

  const convitesDiscord = [
    { code: 'ig1', uses: 2, maxUses: 0, inviter: { id: ID_ANA }, channel: { name: 'geral' }, expiresTimestamp: null },
    { code: 'livre1', uses: 5, maxUses: 10, inviter: { id: ID_BIA }, channel: { name: 'regras' }, expiresTimestamp: null },
  ];
  const membros = new Map([
    [ID_ANA, membro(ID_ANA, 'Ana')],
    [ID_BIA, membro(ID_BIA, 'Bia')],
    [ID_ADMIN, membro(ID_ADMIN, 'Chefe', { admin: true })],
    [ID_COMUM, membro(ID_COMUM, 'Comum')],
  ]);
  const guild = {
    id: 'g1',
    members: { cache: membros, fetch: async (id) => membros.get(id) ?? null },
    invites: { fetch: async () => convitesDiscord, delete: async () => {} },
    channels: { cache: new Map(), fetch: async () => null },
    roles: { cache: new Map(), fetch: async () => null },
  };
  const client = {
    guilds: { cache: new Map([['g1', guild]]) },
    users: { fetch: async () => null },
  };
  const app = {
    client, ctx, db: ctx.db,
    logs: { enviar: async () => false, canalDeEntrada: () => null },
    rastreador: {}, detectorPico: {}, vozAtiva: new Map(),
  };
  const servidor = painel.iniciar(app);
  t.after(() => servidor.close());
  await new Promise((r) => setTimeout(r, 200));

  await t.test('sem login: tudo bloqueado', async () => {
    const r = await fetch(`${BASE}/api/plataforma?fonte=Instagram`);
    assert.equal(r.status, 401);
  });

  await t.test('ranking e entradas mostram nomes em vez de IDs', async () => {
    const rk = await chamar('GET', '/api/ranking?periodo=tudo');
    assert.equal(rk.status, 200);
    assert.equal(rk.json[0].pessoa.nome, 'Ana');
    assert.match(rk.json[0].pessoa.avatar, /cdn\.example/);
    assert.equal(rk.json[0].validos, 2);
    const en = await chamar('GET', '/api/entradas');
    const deAna = en.json.find((e) => e.convidadorId === ID_ANA);
    assert.equal(deAna.convidador.nome, 'Ana');
  });

  await t.test('consulta de membro por nome e por ID', async () => {
    const porNome = await chamar('GET', '/api/convites/usuario?busca=an');
    assert.equal(porNome.json.length, 1);
    assert.equal(porNome.json[0].pessoa.nome, 'Ana');
    assert.equal(porNome.json[0].validos, 2);
    const porId = await chamar('GET', `/api/convites/usuario?busca=${ID_ANA}`);
    assert.equal(porId.json[0].entradas, 2);
    const curto = await chamar('GET', '/api/convites/usuario?busca=a');
    assert.deepEqual(curto.json, []);
  });

  await t.test('detalhe da plataforma traz métricas, links e evolução', async () => {
    const r = await chamar('GET', '/api/plataforma?fonte=Instagram&periodo=30');
    assert.equal(r.status, 200);
    assert.equal(r.json.geral.entradas, 2);
    assert.deepEqual(r.json.links.map((l) => l.nome).sort(), ['Bio', 'Stories']);
    assert.ok(r.json.evolucao.length > 0);
    assert.equal((await chamar('GET', '/api/plataforma')).status, 400);
  });

  await t.test('convites livres e importação', async () => {
    const livres = await chamar('GET', '/api/convites-livres');
    assert.deepEqual(livres.json.map((c) => c.codigo), ['livre1']);
    assert.equal(livres.json[0].criadoPor, 'Bia');
    const ruim = await chamar('POST', '/api/links/importar', { corpo: { codigo: '!!!', nome: 'X' } });
    assert.equal(ruim.status, 400);
    const ok = await chamar('POST', '/api/links/importar', { corpo: { codigo: 'https://discord.gg/livre1', nome: 'YouTube', fonte: 'YouTube' } });
    assert.equal(ok.status, 200);
    assert.equal(links.porCodigo(ctx, 'livre1').fonte, 'YouTube');
    assert.deepEqual((await chamar('GET', '/api/convites-livres')).json, []);
  });

  await t.test('renomear com fonte', async () => {
    const r = await chamar('POST', `/api/links/${insta.id}/renomear`, { corpo: { nome: 'Bio nova', fonte: 'Insta' } });
    assert.equal(r.status, 200);
    const l = links.obter(ctx, insta.id);
    assert.equal(l.nome, 'Bio nova');
    assert.equal(l.fonte, 'Insta');
  });

  await t.test('reset de usuário valida o ID e zera a contagem', async () => {
    assert.equal((await chamar('POST', '/api/resetar/usuario', { corpo: { userId: 'abc' } })).status, 400);
    const r = await chamar('POST', '/api/resetar/usuario', { corpo: { userId: ID_ANA } });
    assert.equal(r.status, 200);
    assert.equal(r.json.entradas, 2);
    assert.equal(entradas.contagemConvites(ctx, ID_ANA).validos, 0);
  });

  await t.test('reset do servidor exige a palavra RESETAR e ser admin', async () => {
    assert.equal((await chamar('POST', '/api/resetar/servidor', { corpo: { confirmar: 'sim' } })).status, 400);
    assert.equal((await chamar('POST', '/api/resetar/servidor', { usuario: ID_COMUM, corpo: { confirmar: 'RESETAR' } })).status, 403);
    const ok = await chamar('POST', '/api/resetar/servidor', { corpo: { confirmar: 'RESETAR' } });
    assert.equal(ok.status, 200);
  });

  await t.test('auditoria registra as ações e mostra o nome de quem fez', async () => {
    const r = await chamar('GET', '/api/auditoria');
    assert.equal(r.status, 200);
    const acoes = r.json.map((l) => l.acao);
    for (const esperado of ['link_importado', 'reset_usuario', 'reset_servidor']) assert.ok(acoes.includes(esperado), esperado);
    assert.equal(r.json[0].pessoa.nome, 'Chefe');
    assert.equal((await chamar('GET', '/api/auditoria', { usuario: ID_COMUM })).status, 403);
  });

  await t.test('membro sem cargo liberado não acessa nada', async () => {
    for (const rota of ['/api/ranking', '/api/convites-livres', '/api/plataforma?fonte=x']) {
      assert.equal((await chamar('GET', rota, { usuario: ID_COMUM })).status, 403, rota);
    }
  });
});
