'use strict';

/** Ajustes do servidor (tabela chave/valor com valores em JSON) e valores padrão. */
const PADROES = {
  // Canais de log
  canal_log_plataforma: null,
  canal_log_usuarios: null,
  canal_log_saidas: null,
  canal_alertas: null,
  canal_relatorio: null,

  fuso: 'America/Sao_Paulo',

  // Anti-abuso
  fake_conta_dias: 7,
  fake_saida_min: 60,
  fake_pico_qtd: 10,
  fake_pico_min: 5,
  fake_avatar: false,
  fakes_fora: true, // fakes ficam fora da retenção e das métricas por padrão

  // Métricas
  ativo_dias: 7,
  retencao_dias: [7, 30],

  // Recompensa por cargo (opcional): um único cargo, igual para todos
  recompensa_ativa: false,
  recompensa_cargo: null,
  recompensa_min: 5,
  recompensa_remover: false,

  // Relatórios automáticos
  relatorio_semanal: false,
  relatorio_mensal: false,

  // Interno
  ultimo_visto: null,
};

function criarAjustes(db, guildId) {
  const sel = db.prepare('SELECT valor FROM config WHERE guild_id = ? AND chave = ?');
  const up = db.prepare(
    `INSERT INTO config (guild_id, chave, valor) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, chave) DO UPDATE SET valor = excluded.valor`,
  );
  const del = db.prepare('DELETE FROM config WHERE guild_id = ? AND chave = ?');

  function get(chave) {
    if (!(chave in PADROES)) throw new Error(`Ajuste desconhecido: ${chave}`);
    const r = sel.get(guildId, chave);
    if (!r) return PADROES[chave];
    try {
      return JSON.parse(r.valor);
    } catch {
      return PADROES[chave];
    }
  }

  function set(chave, valor) {
    if (!(chave in PADROES)) throw new Error(`Ajuste desconhecido: ${chave}`);
    if (valor === null || valor === undefined) del.run(guildId, chave);
    else up.run(guildId, chave, JSON.stringify(valor));
  }

  function todos() {
    const out = {};
    for (const k of Object.keys(PADROES)) out[k] = get(k);
    return out;
  }

  return { get, set, todos };
}

module.exports = { PADROES, criarAjustes };
