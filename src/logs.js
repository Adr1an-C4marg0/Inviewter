'use strict';

const { EmbedBuilder } = require('discord.js');
const { formatarDuracao, truncar } = require('./util');

const CORES = {
  entrada: 0x3bd38f,
  saida: 0xf25c5c,
  alerta: 0xf5b83d,
  info: 0x5b6cff,
};

const RODAPE = { text: 'inviewter' };

const unix = (ms) => Math.floor(ms / 1000);

function base(cor, membro) {
  const e = new EmbedBuilder().setColor(cor).setFooter(RODAPE).setTimestamp();
  if (membro?.avatarUrl) e.setThumbnail(membro.avatarUrl);
  return e;
}

function rotuloOrigem(o) {
  switch (o.tipo_origem ?? o.tipo) {
    case 'plataforma': {
      const nome = o.linkNome ?? 'link';
      return o.linkRemovido ? `${nome} (link removido)` : nome;
    }
    case 'usuario': return 'convite de usuário';
    case 'vanity': return 'URL personalizada';
    case 'ambiguo': return 'origem ambígua';
    default: return 'origem desconhecida';
  }
}

/**
 * Embed de entrada. `d`:
 *  membro { id, tag, avatarUrl, contaCriadaEm }, origem { tipo, linkNome, linkFonte, linkRemovido, codigo,
 *  candidatos[], motivo }, convidador { id, validos, saidas, fakes }, totalLink, selos[], fake, retorno
 */
function embedEntrada(d) {
  const { membro, origem } = d;
  const cor = d.fake ? CORES.alerta : CORES.entrada;
  const e = base(cor, membro).setAuthor({ name: membro.tag });

  let titulo;
  let desc;
  switch (origem.tipo) {
    case 'plataforma':
      titulo = d.retorno ? 'Membro voltou' : 'Nova entrada por link';
      desc = d.retorno
        ? `<@${membro.id}> voltou ao servidor. Origem original: **${rotuloOrigem(origem)}**.`
        : `<@${membro.id}> entrou pelo link **${rotuloOrigem(origem)}**.`;
      break;
    case 'usuario':
      titulo = d.retorno ? 'Membro voltou' : 'Nova entrada por convite';
      desc = d.retorno
        ? `<@${membro.id}> voltou ao servidor. Origem original: convite de <@${origem.convidadorId}>.`
        : `<@${membro.id}> entrou pelo convite de <@${origem.convidadorId}>.`;
      break;
    case 'vanity':
      titulo = d.retorno ? 'Membro voltou' : 'Nova entrada pela URL personalizada';
      desc = `<@${membro.id}> entrou pela URL personalizada do servidor.`;
      break;
    case 'ambiguo':
      titulo = 'Entrada com origem ambígua';
      desc = `<@${membro.id}> entrou, mas mais de um convite foi usado ao mesmo tempo.`;
      break;
    default:
      titulo = 'Entrada de origem desconhecida';
      desc = `<@${membro.id}> entrou, mas o convite não pôde ser identificado.`;
  }
  e.setTitle(titulo).setDescription(desc);

  const campos = [];
  if (membro.contaCriadaEm) {
    campos.push({ name: 'Conta criada', value: `<t:${unix(membro.contaCriadaEm)}:R>`, inline: true });
  }
  if (origem.tipo === 'plataforma') {
    if (origem.linkFonte) campos.push({ name: 'Fonte', value: truncar(origem.linkFonte, 100), inline: true });
    if (d.totalLink != null) campos.push({ name: 'Entradas do link', value: String(d.totalLink), inline: true });
  }
  if (origem.codigo) campos.push({ name: 'Convite', value: `\`${truncar(origem.codigo, 60)}\``, inline: true });
  if (origem.tipo === 'usuario' && d.convidador) {
    const c = d.convidador;
    campos.push({
      name: 'Convites do convidador',
      value: `${c.validos} válidos · ${c.saidas} saídas · ${c.fakes} fakes`,
      inline: false,
    });
  }
  if (origem.tipo === 'ambiguo' && origem.candidatos?.length) {
    campos.push({
      name: 'Candidatos',
      value: truncar(origem.candidatos.map((c) => `\`${c}\``).join(', '), 1000),
    });
  }
  if (origem.tipo === 'desconhecido' || origem.tipo === 'ambiguo') {
    campos.push({
      name: 'Motivo provável',
      value: truncar(origem.motivo || 'URL personalizada, convite expirado ou bot offline', 300),
    });
  }
  if (d.selos?.length) campos.push({ name: 'Alertas', value: d.selos.map((s) => `⚠ ${s}`).join('\n') });
  if (campos.length) e.addFields(campos);
  return e;
}

function embedSaida(d) {
  const { membro, entrada } = d;
  const e = base(CORES.saida, membro).setAuthor({ name: membro.tag }).setTitle('Membro saiu');
  const tempo = d.duracaoMs != null ? ` depois de **${formatarDuracao(d.duracaoMs)}**` : '';
  e.setDescription(`<@${membro.id}> saiu do servidor${tempo}.`);
  const campos = [];
  if (entrada) {
    campos.push({ name: 'Origem da entrada', value: truncar(d.origemTexto || 'desconhecida', 200), inline: true });
    if (d.mensagens != null) campos.push({ name: 'Mensagens enviadas', value: String(d.mensagens), inline: true });
    if (entrada.fake) {
      campos.push({ name: 'Alerta', value: `⚠ ${entrada.motivo_fake || 'fake'}`, inline: true });
    }
  } else {
    campos.push({ name: 'Origem da entrada', value: 'sem registro (entrou antes do bot)', inline: true });
  }
  if (campos.length) e.addFields(campos);
  return e;
}

function embedPico(d) {
  return new EmbedBuilder()
    .setColor(CORES.alerta)
    .setFooter(RODAPE)
    .setTimestamp()
    .setTitle('Pico de entradas')
    .setDescription(
      `**${d.total}** entradas em ${d.minutos} min pelo convite \`${d.codigo}\`` +
        (d.nome ? ` (**${truncar(d.nome, 80)}**)` : '') +
        '.\nAs entradas foram marcadas para revisão no painel.',
    );
}

function embedRecompensa(d) {
  const concedido = d.acao === 'concedido';
  return new EmbedBuilder()
    .setColor(concedido ? CORES.entrada : CORES.alerta)
    .setFooter(RODAPE)
    .setTimestamp()
    .setTitle(concedido ? 'Recompensa concedida' : 'Recompensa removida')
    .setDescription(
      concedido
        ? `<@${d.userId}> atingiu **${d.validos}** convites válidos e recebeu o cargo <@&${d.cargoId}>.`
        : `<@${d.userId}> caiu para **${d.validos}** convites válidos e perdeu o cargo <@&${d.cargoId}>.`,
    );
}

function embedSimples(titulo, descricao, cor = CORES.info) {
  return new EmbedBuilder().setColor(cor).setFooter(RODAPE).setTimestamp().setTitle(titulo).setDescription(truncar(descricao, 4000));
}

class Logs {
  constructor(client, ctx) {
    this.client = client;
    this.ctx = ctx;
  }

  /** Qual canal recebe cada tipo de origem; usa o outro canal de entradas se o primeiro não estiver definido. */
  canalDeEntrada(tipo) {
    const a = this.ctx.ajustes;
    const plat = a.get('canal_log_plataforma');
    const usu = a.get('canal_log_usuarios');
    return tipo === 'usuario' ? usu || plat : plat || usu;
  }

  canalDeSaida(tipo) {
    return this.ctx.ajustes.get('canal_log_saidas') || this.canalDeEntrada(tipo);
  }

  async enviar(canalId, embed) {
    if (!canalId) return false;
    try {
      const canal = this.client.channels.cache.get(canalId) || (await this.client.channels.fetch(canalId));
      if (!canal?.isTextBased?.()) return false;
      await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
      return true;
    } catch (e) {
      console.error(`[logs] não consegui enviar para o canal ${canalId}: ${e.message}`);
      return false;
    }
  }
}

module.exports = {
  CORES, Logs, rotuloOrigem,
  embedEntrada, embedSaida, embedPico, embedRecompensa, embedSimples,
};
