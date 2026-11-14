'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guildFalsa } = require('./ajudas');
const { Rastreador } = require('../src/rastreador');

const inv = (code, uses, extra = {}) => ({ code, uses, maxUses: 0, inviter: { id: 'ana' }, expiresTimestamp: null, channelId: 'c1', ...extra });

async function comRastreador(opcoes) {
  const guild = guildFalsa(opcoes);
  const r = new Rastreador();
  await r.sincronizar(guild);
  return { guild, r };
}

test('detecta o convite cujo contador de usos subiu', async () => {
  const { guild, r } = await comRastreador({ convites: [inv('aaa', 3), inv('bbb', 0)] });
  guild._estado.convites.get('bbb').uses = 1;
  const d = await r.detectar(guild);
  assert.equal(d.tipo, 'convite');
  assert.equal(d.convite.code, 'bbb');
  assert.equal(d.convite.inviterId, 'ana');
  // segunda entrada pelo mesmo convite: o cache foi atualizado, então ainda detecta
  guild._estado.convites.get('bbb').uses = 2;
  assert.equal((await r.detectar(guild)).convite.code, 'bbb');
});

test('sem mudança em nenhum convite: desconhecido', async () => {
  const { guild, r } = await comRastreador({ convites: [inv('aaa', 3)] });
  const d = await r.detectar(guild);
  assert.equal(d.tipo, 'desconhecido');
});

test('convite novo que o bot não viu ser criado também é detectado', async () => {
  const { guild, r } = await comRastreador({ convites: [inv('aaa', 3)] });
  guild._estado.convites.set('nnn', inv('nnn', 1));
  const d = await r.detectar(guild);
  assert.equal(d.convite.code, 'nnn');
});

test('convite que esgotou o limite some junto com a entrada e é atribuído a ele', async () => {
  const { guild, r } = await comRastreador({ convites: [inv('uso1', 0, { maxUses: 1 }), inv('aaa', 3)] });
  guild._estado.convites.delete('uso1');
  r.inviteApagado({ code: 'uso1' });
  const d = await r.detectar(guild);
  assert.equal(d.tipo, 'convite');
  assert.equal(d.convite.code, 'uso1');
  assert.equal(d.esgotado, true);
});

test('convite expirado ou apagado por um admin não é confundido com esgotado', async () => {
  const agora = Date.now();
  const { guild, r } = await comRastreador({
    convites: [inv('exp', 0, { maxUses: 1, expiresTimestamp: agora - 1000 }), inv('aaa', 3)],
  });
  guild._estado.convites.delete('exp');
  const d = await r.detectar(guild, agora);
  assert.equal(d.tipo, 'desconhecido');
});

test('convite que sumiu mas ainda tinha usos sobrando não é atribuído', async () => {
  const { guild, r } = await comRastreador({ convites: [inv('tres', 0, { maxUses: 5 }), inv('aaa', 3)] });
  guild._estado.convites.delete('tres');
  assert.equal((await r.detectar(guild)).tipo, 'desconhecido');
});

test('esgotado só vale quando nenhum outro convite subiu', async () => {
  const { guild, r } = await comRastreador({ convites: [inv('uso1', 0, { maxUses: 1 }), inv('aaa', 3)] });
  guild._estado.convites.delete('uso1'); // um admin apagou
  guild._estado.convites.get('aaa').uses = 4;
  const d = await r.detectar(guild);
  assert.equal(d.convite.code, 'aaa');
});

test('URL personalizada (vanity)', async () => {
  const { guild, r } = await comRastreador({ convites: [inv('aaa', 3)], vanity: { code: 'meuserver', uses: 10 } });
  guild._estado.vanity.uses = 11;
  const d = await r.detectar(guild);
  assert.equal(d.tipo, 'vanity');
  assert.equal(d.codigo, 'meuserver');
});

test('dois convites subiram ao mesmo tempo: ambíguo com a lista de candidatos', async () => {
  const { guild, r } = await comRastreador({ convites: [inv('aaa', 0), inv('bbb', 0)] });
  guild._estado.convites.get('aaa').uses = 1;
  guild._estado.convites.get('bbb').uses = 1;
  const d = await r.detectar(guild);
  assert.equal(d.tipo, 'ambiguo');
  assert.deepEqual(d.candidatos.map((c) => c.code).sort(), ['aaa', 'bbb']);
});

test('sem permissão para listar convites: desconhecido com motivo', async () => {
  const guild = guildFalsa();
  guild.invites.fetch = async () => {
    throw new Error('Missing Permissions');
  };
  const d = await new Rastreador().detectar(guild);
  assert.equal(d.tipo, 'desconhecido');
  assert.match(d.motivo, /permissão/);
});

test('a fila processa as entradas uma de cada vez, na ordem', async () => {
  const r = new Rastreador();
  const ordem = [];
  const espera = (ms) => new Promise((res) => setTimeout(res, ms));
  await Promise.all([
    r.executar(async () => { await espera(30); ordem.push('a'); }),
    r.executar(async () => { ordem.push('b'); }),
    r.executar(async () => { throw new Error('falha'); }).catch(() => ordem.push('erro')),
    r.executar(async () => { ordem.push('c'); }),
  ]);
  assert.deepEqual(ordem, ['a', 'b', 'erro', 'c']);
});
