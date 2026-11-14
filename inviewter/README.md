# InViewte

Bot de Discord que descobre por qual link cada membro entrou e mede a qualidade de cada origem:
entradas, saídas, retenção (D7 e D30), usuários ativos e índice de qualidade por plataforma.
Também rastreia convites de usuários (quem trouxe quem), com leaderboard e recompensa opcional por cargo.

## Requisitos

- Node.js 20 ou superior
- Aplicativo no Discord Developer Portal com o bot criado

## Configuração no Discord

1. Em **Bot**, ative a intent **Server Members** (privilegiada).
2. Permissões do bot ao convidar para o servidor:
   - Criar Convite Instantâneo (criar os links)
   - Gerenciar Servidor (ler a lista de convites)
   - Gerenciar Cargos (só se usar a recompensa por cargo)
   - Ver Canais, Enviar Mensagens, Inserir Links, Usar Comandos de Aplicativo
3. Coloque o cargo do bot **acima** dos cargos de recompensa na lista de cargos do servidor.
4. Em **OAuth2**, copie o Client Secret (só se for usar o painel web) e adicione o redirect `PANEL_BASE_URL/callback`.

## Variáveis de ambiente

Copie `.env.example` para `.env` (local) ou defina no Railway.

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DISCORD_TOKEN` | sim | Token do bot |
| `CLIENT_ID` | sim | ID do aplicativo |
| `GUILD_ID` | sim | ID do servidor |
| `DATA_DIR` | não | Pasta do banco. No Railway, use o caminho do Volume (ex.: `/data`) |
| `PANEL_BASE_URL` | painel | URL pública, sem barra no final |
| `DISCORD_CLIENT_SECRET` | painel | Client Secret do OAuth2 |
| `SESSION_SECRET` | painel | Texto longo e aleatório para assinar a sessão |
| `PORT` | não | Padrão 3000 (o Railway define sozinho) |

O painel só liga quando as três variáveis do painel existem. Sem elas, o bot funciona normalmente.

## Rodando

```bash
npm install
npm start
npm test
```

## Deploy no Railway

1. Crie um projeto a partir do repositório no GitHub.
2. Em **Volumes**, adicione um volume montado em `/data`.
3. Defina `DATA_DIR=/data` e as variáveis do bot (e do painel, se quiser).
4. Em **Settings › Networking**, gere um domínio público e use-o como `PANEL_BASE_URL`.

> O disco do Railway é apagado a cada deploy. Sem o volume, o banco se perde.
> Backups diários ficam em `DATA_DIR/backups` (últimos 14 dias).

## Comandos

| Comando | Quem usa | Função |
| --- | --- | --- |
| `/link criar` | gerir links | Cria o convite no Discord com nome, fonte, validade e usos |
| `/link importar` | gerir links | Dá nome a um convite que já existe |
| `/link listar` | gerir links | Lista links, status e entradas |
| `/link renomear` / `desativar` / `excluir` | gerir links | Gerencia o link (exclusão pede confirmação) |
| `/stats` | ver estatísticas | Métricas por link, fonte ou servidor, com período |
| `/invites [usuario]` | todos | Convites válidos, saídas e fakes de alguém |
| `/top` | todos | Ranking de quem mais convida |
| `/recompensa ativar` / `desativar` / `ver` | admin ou permissão | Recompensa opcional: um cargo para quem atinge X convites válidos |
| `/resetar usuario` / `servidor` | gerir recompensas / admin | Zera a contagem de convites (com confirmação) |
| `/config canais` / `fuso` / `antiabuso` / `relatorios` / `permissao` / `ver` | admin | Configuração |
| `/exportar` | exportar | CSV de links, plataformas, evolução ou entradas |
| `/painel` | ver estatísticas | Link do painel web |

Válidos = entradas − saídas − fakes.

## Como funciona o rastreamento

O Discord não informa qual convite foi usado. O bot guarda o contador de usos de cada convite
e compara antes e depois de cada entrada. Casos tratados:

- **Convite de link**: a origem é o link (ex.: Instagram).
- **Convite de usuário**: a origem é o convidador, que recebe a contagem.
- **URL personalizada**: registrada como "URL personalizada".
- **Convite que esgotou o limite**: atribuído a ele quando desaparece junto com a entrada.
- **Dois convites subiram ao mesmo tempo**: marcado como "origem ambígua", com os candidatos listados.
- **Bot offline na entrada**: ao voltar, o bot reconcilia saídas e registra entradas sem rastro como desconhecidas.
- **Quem sai e volta**: mantém a origem original; a volta conta como retorno, não como nova entrada.

## Métricas

- **Retenção D7 / D30**: % das entradas que ainda estão no servidor 7 ou 30 dias depois.
  Só entra no cálculo quem já completou esse prazo.
- **Usuários ativos**: entradas que enviaram ao menos uma mensagem (ou ficaram em canal de voz) nos últimos 7 dias.
- **Índice de qualidade**: ativos ÷ entradas. Ordena plataformas pequenas e boas contra grandes e fracas.
- **Ativação**: % das entradas que enviaram mensagem nos primeiros 7 dias.

O bot guarda apenas contadores diários de mensagens e minutos de voz por membro. Nunca guarda o conteúdo.

## Anti-abuso (padrões, ajustáveis em `/config antiabuso`)

- **Conta nova**: criada há menos de 7 dias vira fake.
- **Saída rápida**: saiu em menos de 60 minutos vira fake.
- **Pico**: 10 entradas em 5 minutos pelo mesmo convite geram alerta e marcam as entradas para revisão.
- **Avatar padrão**: só mostra um selo, não conta como fake.
- Fakes ficam de fora das métricas de retenção e ativos por padrão.
- Um administrador pode marcar ou desmarcar fakes manualmente (no painel ou com `/resetar`, que não o faz).

## Permissões

- Administradores (Administrador ou Gerenciar Servidor) podem tudo.
- Cargos específicos recebem permissões separadas: ver estatísticas, gerir links, gerir recompensas e fakes, exportar.
  Configure com `/config permissao` ou no painel.
- `/config` e `/resetar servidor` são só para administradores.

## Painel web

Entre com o Discord. Cada página confere a permissão do seu cargo no servidor.
O painel faz tudo que os comandos `/` fazem (os comandos continuam funcionando), com nomes e avatares no lugar de IDs:

- **Visão geral**: métricas e gráfico; clique em uma plataforma para ver o detalhe e comparar os links dela.
- **Links**: criar, importar convites que já existem no servidor, renomear (nome e fonte), desativar e excluir.
- **Membros**: busca, origem da entrada e marcação manual de fake.
- **Convites**: ranking, consulta de um membro (equivale ao `/invites`) e reset de usuário ou do servidor com confirmação.
- **Configurações** (admin): canais, anti-abuso, relatórios, recompensa opcional e permissões por cargo.
- **Auditoria** (admin): quem criou, excluiu ou zerou o quê e quando.
- **Exportar**: CSV de links, plataformas, evolução e entradas.

## Estrutura

```
src/
  index.js         ponto de entrada (cliente, comandos, painel, jobs)
  config.js        variáveis de ambiente
  db.js            SQLite (schema e conexão)
  rastreador.js    descoberta da origem de cada entrada
  eventos.js       entrada, saída, mensagens, voz e reconciliação
  logs.js          embeds de log
  acoes.js         ações compartilhadas entre comandos e painel
  jobs.js          expiração de links, backup e relatórios agendados
  comandos.js      registro dos comandos slash
  commands/        um arquivo por comando
  services/        regras de negócio (links, entradas, métricas, permissões, recompensas…)
  panel/           servidor do painel e página (public/index.html)
test/              testes automatizados (node --test)
```
