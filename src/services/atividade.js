'use strict';

const { diaLocal } = require('../util');

/**
 * Soma mensagens/minutos de voz no dia. Só registra membros que existem em `entradas`,
 * o que mantém o banco pequeno. Guarda apenas contadores, nunca o conteúdo.
 */
function somar(ctx, userId, { mensagens = 0, minutosVoz = 0, agora = Date.now() }) {
  const dia = diaLocal(agora, ctx.ajustes.get('fuso'));
  ctx.db
    .prepare(
      `INSERT INTO atividade_diaria (guild_id, user_id, dia, mensagens, minutos_voz)
       SELECT @g, @u, @d, @m, @v
       WHERE EXISTS (SELECT 1 FROM entradas WHERE guild_id = @g AND user_id = @u)
       ON CONFLICT (guild_id, user_id, dia) DO UPDATE SET
         mensagens = mensagens + excluded.mensagens,
         minutos_voz = minutos_voz + excluded.minutos_voz`,
    )
    .run({ g: ctx.guildId, u: userId, d: dia, m: mensagens, v: minutosVoz });
}

module.exports = { somar };
