'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cron = require('node-cron');
const { config } = require('./config');
const acoes = require('./acoes');
const formato = require('./formato');

const MANTER_BACKUPS = 14;

function log(nome, e) {
  console.error(`[job ${nome}]`, e?.message || e);
}

/** Backup diário do SQLite com VACUUM INTO (arquivo consistente, mesmo com o bot rodando). */
function backup(app) {
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  const arquivo = path.join(dir, `inviewter-${hoje}.db`);
  if (!fs.existsSync(arquivo)) app.db.prepare('VACUUM INTO ?').run(arquivo);
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  for (const antigo of arquivos.slice(0, Math.max(0, arquivos.length - MANTER_BACKUPS))) {
    fs.rmSync(path.join(dir, antigo), { force: true });
  }
  return arquivo;
}

async function relatorio(app, dias, nome) {
  const { ctx } = app;
  const canal = ctx.ajustes.get('canal_relatorio') || ctx.ajustes.get('canal_log_plataforma');
  if (!canal) return;
  const periodo = String(dias);
  const e = formato.embedComparativo(ctx, periodo, formato.desdeDe(periodo));
  e.setTitle(`Relatório ${nome}: plataformas`);
  await app.logs.enviar(canal, e);
}

/** Liga as tarefas agendadas. Todas leem os ajustes na hora da execução, então mudanças valem sem reiniciar. */
function iniciar(app) {
  const fuso = app.ctx.ajustes.get('fuso');
  const tarefas = [];

  // Revoga no Discord convites vencidos (validades acima de 7 dias não são nativas).
  tarefas.push(cron.schedule('*/10 * * * *', () => {
    acoes.expirarLinks(app).catch((e) => log('expirar-links', e));
  }));

  tarefas.push(cron.schedule('15 3 * * *', () => {
    try { backup(app); } catch (e) { log('backup', e); }
  }, { timezone: fuso }));

  tarefas.push(cron.schedule('0 9 * * 1', () => {
    if (!app.ctx.ajustes.get('relatorio_semanal')) return;
    relatorio(app, 7, 'semanal').catch((e) => log('relatorio-semanal', e));
  }, { timezone: fuso }));

  tarefas.push(cron.schedule('0 9 1 * *', () => {
    if (!app.ctx.ajustes.get('relatorio_mensal')) return;
    relatorio(app, 30, 'mensal').catch((e) => log('relatorio-mensal', e));
  }, { timezone: fuso }));

  return () => tarefas.forEach((t) => t.stop());
}

module.exports = { iniciar, backup, relatorio };
