'use strict';

/**
 * Descobre por qual convite um membro entrou.
 * O Discord não informa isso, então guardamos o contador de usos de cada convite
 * e comparamos antes e depois da entrada.
 */

const JANELA_REMOVIDO_MS = 30 * 1000;

function snap(inv) {
  return {
    code: inv.code,
    uses: inv.uses ?? 0,
    maxUses: inv.maxUses ?? 0,
    inviterId: inv.inviter?.id ?? inv.inviterId ?? null,
    expiresAt: inv.expiresTimestamp ?? null,
    channelId: inv.channelId ?? inv.channel?.id ?? null,
    removidoEm: null,
  };
}

class Rastreador {
  constructor() {
    this.cache = new Map();
    this.vanity = null;
    this.fila = Promise.resolve();
  }

  /** Executa tarefas uma de cada vez, para que entradas simultâneas não se misturem. */
  executar(fn) {
    const proxima = this.fila.then(fn, fn);
    this.fila = proxima.catch(() => {});
    return proxima;
  }

  async sincronizar(guild) {
    const convites = await guild.invites.fetch();
    this.cache.clear();
    for (const inv of convites.values()) this.cache.set(inv.code, snap(inv));
    this.vanity = await this.lerVanity(guild);
    return this.cache.size;
  }

  async lerVanity(guild) {
    try {
      if (typeof guild.fetchVanityData !== 'function') return null;
      const v = await guild.fetchVanityData();
      return v?.code ? { code: v.code, uses: v.uses ?? 0 } : null;
    } catch {
      return null;
    }
  }

  inviteCriado(inv) {
    this.cache.set(inv.code, snap(inv));
  }

  /** Mantém o convite no cache por um instante: ele pode ter sumido justamente por ter sido usado. */
  inviteApagado(inv) {
    const c = this.cache.get(inv.code);
    if (!c) return;
    c.removidoEm = Date.now();
    setTimeout(() => {
      const atual = this.cache.get(inv.code);
      if (atual && atual.removidoEm) this.cache.delete(inv.code);
    }, JANELA_REMOVIDO_MS).unref?.();
  }

  /**
   * Devolve { tipo, convite?, candidatos?, motivo? }
   *  tipo: 'convite' | 'vanity' | 'ambiguo' | 'desconhecido'
   */
  async detectar(guild, agora = Date.now()) {
    let atuais;
    try {
      const convites = await guild.invites.fetch();
      atuais = new Map([...convites.values()].map((i) => [i.code, snap(i)]));
    } catch (e) {
      return { tipo: 'desconhecido', motivo: 'sem permissão para listar os convites do servidor' };
    }

    const aumentaram = [];
    for (const s of atuais.values()) {
      const antes = this.cache.get(s.code);
      if (s.uses > (antes ? antes.uses : 0)) aumentaram.push(s);
    }

    const vanityAtual = await this.lerVanity(guild);
    const vanitySubiu = Boolean(vanityAtual && this.vanity && vanityAtual.uses > this.vanity.uses);

    // Convites que sumiram: se tinham um único uso restante, a entrada esgotou o convite.
    const esgotados = [];
    for (const c of this.cache.values()) {
      if (atuais.has(c.code)) continue;
      if (c.removidoEm && agora - c.removidoEm > JANELA_REMOVIDO_MS) continue;
      if (c.maxUses > 0 && c.uses + 1 >= c.maxUses && !(c.expiresAt && c.expiresAt <= agora)) {
        esgotados.push(c);
      }
    }

    this.cache = atuais;
    this.vanity = vanityAtual;

    const candidatos = [...aumentaram];
    if (!candidatos.length && !vanitySubiu) candidatos.push(...esgotados);
    const total = candidatos.length + (vanitySubiu ? 1 : 0);

    if (total === 0) return { tipo: 'desconhecido', motivo: 'nenhum convite teve o contador de usos alterado' };
    if (total > 1) {
      return {
        tipo: 'ambiguo',
        candidatos,
        motivo: 'mais de um convite foi usado ao mesmo tempo',
      };
    }
    if (vanitySubiu) return { tipo: 'vanity', codigo: vanityAtual.code };
    return { tipo: 'convite', convite: candidatos[0], esgotado: !atuais.has(candidatos[0].code) };
  }
}

module.exports = { Rastreador, snap };
