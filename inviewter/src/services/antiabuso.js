'use strict';

const { DIA, MIN } = require('../util');

function cfgDe(ctx) {
  const a = ctx.ajustes;
  return {
    contaDias: a.get('fake_conta_dias'),
    saidaMin: a.get('fake_saida_min'),
    picoQtd: a.get('fake_pico_qtd'),
    picoMin: a.get('fake_pico_min'),
    avatar: a.get('fake_avatar'),
  };
}

/** Avalia uma entrada nova. Conta nova = fake; avatar padrão apenas gera selo. */
function avaliarEntrada(cfg, { contaCriadaEm, avatarPadrao, agora = Date.now() }) {
  const selos = [];
  let fake = false;
  let motivo = null;
  if (contaCriadaEm && cfg.contaDias > 0 && agora - contaCriadaEm < cfg.contaDias * DIA) {
    fake = true;
    motivo = 'conta nova';
    selos.push('conta nova');
  }
  if (cfg.avatar && avatarPadrao) selos.push('avatar padrão');
  return { fake, motivo, selos };
}

/** Saiu cedo demais depois de entrar? Devolve o motivo ou null. */
function avaliarSaida(cfg, entrada, agora = Date.now()) {
  if (entrada.fake || entrada.fake_manual) return null;
  if (cfg.saidaMin > 0 && agora - entrada.entrou_em < cfg.saidaMin * MIN) return 'saída rápida';
  return null;
}

/** Detecta muitas entradas pelo mesmo convite em pouco tempo. Alerta uma vez por janela. */
class DetectorPico {
  constructor() {
    this.janelas = new Map();
    this.alertadoAte = new Map();
  }

  registrar(chave, agora, qtd, minutos) {
    const limite = agora - minutos * MIN;
    const lista = (this.janelas.get(chave) || []).filter((t) => t > limite);
    lista.push(agora);
    this.janelas.set(chave, lista);
    if (qtd > 0 && lista.length >= qtd && (this.alertadoAte.get(chave) || 0) < agora) {
      this.alertadoAte.set(chave, agora + minutos * MIN);
      return { pico: true, total: lista.length };
    }
    if (this.janelas.size > 500) this.limpar(agora, minutos);
    return { pico: false, total: lista.length };
  }

  limpar(agora, minutos) {
    for (const [k, v] of this.janelas) {
      if (!v.some((t) => t > agora - minutos * MIN)) this.janelas.delete(k);
    }
  }
}

module.exports = { cfgDe, avaliarEntrada, avaliarSaida, DetectorPico };
