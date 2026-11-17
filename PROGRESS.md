# Progresso — Voxy 2.0.0 nativo

Estado em 16/11/2026: **2.0.0 em preparação**, última publicação **1.4.1**, branch migration/2.0-native-audit. Sem push, deploy, plano pago, tag ou release. Main e dados estáveis preservados. O redesign permanece **não aprovado**.

## Implementado neste incremento

- [x] Processo de sessão Rust independente do desktop; UI conecta por TCP somente loopback com desafio Ed25519 mútuo, tamanho/tempo/fila limitados e nenhuma credencial no arquivo de descoberta.
- [x] UI hospeda e entra com convite, recebe snapshots reais, envia chat, edita/exclui mensagens e espera confirmação antes de descartar o rascunho. Criar, renomear e excluir servidor local; canais criados/excluídos na UI e renomeados pela API autoritativa.
- [x] Malha Opus/SRTP nativa entre participantes autenticados, separada dos dados autoritativos do host. A associação ao canal e mute/deafen controlam o envio/recebimento. Uma trilha de áudio por peer, payload e taxa limitados.
- [x] Captura/DSP/codec/mixer integrados à sessão, dispositivos, PTT global incluindo Mouse 4/5, mute/deafen, volume 0–200% persistido por identidade e remoção de buffers ao desconectar.
- [x] Entrada exibe etapas; prontidão exige frame codificado, abertura tem timeout externo de 12 s e geração para descartar resultado tardio. Falha de dispositivo/DSP aparece na UI. Reconexão com backoff e limite de oito tentativas; credencial expirada exige novo convite.
- [x] Fechar a UI mantém rede e chamada. Reabrir anexa ao processo existente. Sem sessão ativa, o serviço encerra após desconectar a última UI autenticada. Bandeja ainda pendente.
- [x] Amigos por ID conhecido pelo host: solicitar/aceitar/recusar/remover, persistência por servidor, estado online derivado da conexão. DMs de texto persistidas e snapshots filtrados por participante, com teste de consentimento/privacidade. Não há diretório global.
- [x] Até 40 recentes; convite salvo protegido por DPAPI e reconexão pela Home.
- [x] Home social; sidebar de 64 px com ícones centralizados/tooltips; caption de 36 px, botões vetoriais 46×36; chat com avatares fixos, três colunas e ações no hover/menu contextual; configurações e admin com rolagem e estilos próprios.
- [x] Revisão de telas preenchidas em 1240×820 e 900×640; fixture isolada com dez participantes, mensagens, amizades e DMs. Consulta real de bounds dos widgets durante QA. Sem inferir cliques humanos, DPI real ou aprovação visual.
- [x] Legado, updater e assets 3D preservados; publicação/empacotamento Electron da 2.0 continuam bloqueados.

## Validação e evidências

- Rust: **21 testes** unitários/integração local passaram. Os três testes que requerem emulador/dispositivos são explicitamente ignorados na execução comum e executados separadamente.
- Emulador: sessão entre processos, IPC com identidade estrangeira negada, chat persistente e reanexação da UI; malha com três peers e isolamento de canais; teste duplex de APIs de áudio, codificação/transmissão/decodificação/saída, volume de reprodução zero e chamada continuando após descarregar ambos os clientes UI.
- Qualidade acústica, redes de provedores diferentes, PTT com jogo em foco, hotplug e soak **não homologados**.
- [Sessões](evidence/native-2.0/session-integration.json), [duplex de dispositivos](evidence/native-2.0/session-integration-device-api.json), [QA visual](evidence/native-2.0/liquid-glass-reviewed/ui-smoke.json), [benchmarks](BENCHMARKS.md).
- A declaração manual “Os testes físicos da versão atual foram satisfatórios” continua registrada exclusivamente para **1.4.1** em evidence/native-2.0-manual-validation.json.

## Gates e funcionalidades pendentes

Fases 1–4 avançaram no código integrado, mas a **Fase 2 pública ainda não está aprovada**. Faltam conta/domínio/deploy seguro, CGNAT/NAT simétrico/IPv6/firewalls entre redes reais e TURN financeiramente limitado. Limites locais não substituem teto de cobrança do provedor; relay segue desabilitado.

Áudio ainda requer homologação acústica do AEC3 experimental, recuperação/hotplug, sons, atalhos combinados e mudo/ensurdecer globais completos. A UI tem funcionalidades utilizáveis, mas não paridade: imagens, respostas, reações, busca/paginação remotas completas, perfis com foto/capa, cargos, chamadas privadas reservadas, não lidas, DND e notificações ainda pendentes.

Fases 5–9 continuam pendentes: vídeo/WGC/áudio por processo/webcam/PiP, salas procedurais completas, avatares/animações, três jogos com testes diferenciais, importação integral e distribuição assinada/rollback. Não foram substituídos por telas estáticas ou experiências simplificadas. Critérios originais de aceite permanecem em PLAN.md.

## Revisão visual solicitada durante a execução

Os primeiros prints tinham erros reais: avatars com Fill no lugar de dimensão fixa, sidebar sem centralização, botões de caption genéricos, ações cobertas pela scrollbar e listas sem área rolável. Foram corrigidos; o relatório de revisão registra o que foi conferido. Novos prints são evidência de renderização e correção geométrica, **não aprovação artística ou teste humano**.

[Revisão visual antes/depois](evidence/native-2.0/visual-review.md): 15 capturas atuais, 227 bounds verificados e nenhuma falha nas invariantes consultadas. [Conferência consolidada](evidence/native-2.0/verification.json): 21 testes Rust comuns e três integrações explícitas passaram; fmt e Clippy com warnings negados passaram. npm test: 83 testes; npm run build passou com aviso já existente de chunk Vite. Versão 2.0.0 em preparação, catálogo e pasta de saída coerentes, sem publicação.
