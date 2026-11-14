'use strict';

const SEG = 1000;
const MIN = 60 * SEG;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Data local (YYYY-MM-DD) de um instante, no fuso informado. */
function diaLocal(ms, fuso = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

function fusoValido(fuso) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/**
 * Converte "30m", "12h", "7d", "2w" ou "perm" em milissegundos.
 * 0 = permanente. null = texto inválido. Sem unidade, assume dias.
 */
function parseDuracao(txt) {
  if (txt === undefined || txt === null) return 0;
  const t = String(txt).trim().toLowerCase();
  if (!t || ['perm', 'permanente', 'nunca', 'infinito', '0'].includes(t)) return 0;
  const m = t.match(/^(\d+)\s*(m|min|minutos?|h|horas?|d|dias?|w|sem|semanas?)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2] || 'd';
  let ms;
  if (u.startsWith('m')) ms = n * MIN;
  else if (u.startsWith('h')) ms = n * HORA;
  else if (u.startsWith('d')) ms = n * DIA;
  else ms = n * 7 * DIA;
  if (ms <= 0 || ms > 365 * DIA) return null;
  return ms;
}

function plural(n, singular, pluralTxt) {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

function formatarDuracao(ms) {
  if (ms < MIN) return 'menos de 1 min';
  if (ms < HORA) return `${Math.floor(ms / MIN)} min`;
  if (ms < DIA) return plural(Math.floor(ms / HORA), 'hora', 'horas');
  return plural(Math.floor(ms / DIA), 'dia', 'dias');
}

function fmtData(ms, fuso = 'America/Sao_Paulo') {
  if (!ms) return '–';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(ms));
}

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10;
}

function fmtPct(v) {
  return v === null || v === undefined ? '–' : `${String(v).replace('.', ',')}%`;
}

function fmtNum(n) {
  return new Intl.NumberFormat('pt-BR').format(n ?? 0);
}

/** Extrai o código de um convite a partir de uma URL ou do próprio código. */
function extrairCodigo(texto) {
  if (!texto) return null;
  const t = String(texto).trim();
  const m = t.match(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/i);
  if (m) return m[1];
  return /^[A-Za-z0-9-]+$/.test(t) ? t : null;
}

function escCsv(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Evita injeção de fórmulas em planilhas.
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV com BOM (abre direto no Excel com acentos). colunas: [{titulo, valor:(linha)=>any}] */
function csv(linhas, colunas) {
  const cab = colunas.map((c) => escCsv(c.titulo)).join(',');
  const corpo = linhas.map((l) => colunas.map((c) => escCsv(c.valor(l))).join(','));
  return `﻿${[cab, ...corpo].join('\r\n')}\r\n`;
}

function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncar(txt, max) {
  const s = String(txt ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

module.exports = {
  SEG, MIN, HORA, DIA,
  diaLocal, fusoValido, parseDuracao, formatarDuracao, fmtData,
  pct, fmtPct, fmtNum, extrairCodigo, csv, escHtml, truncar, plural,
};
