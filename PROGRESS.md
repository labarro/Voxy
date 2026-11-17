# Progresso — Voxy 2.0.0 nativo

Estado em 17/11/2026: **2.0.0 em preparação**, última publicação **1.4.1**, branch migration/2.0-native-audit. Sem push, deploy, plano pago, tag ou release. Main e dados estáveis preservados. O redesign permanece **não aprovado**.

## Incremento anterior — referência preservada

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

## Validação do incremento anterior

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


## Execução contínua — 17/11/2026

Implementado/integrado: comandos sociais (respostas, menções, reações, busca/paginação, DMs editar/excluir/ler, notificações privadas), cargos/presença, convites revogáveis e reconexão por geração. Voz tem watchdogs, lease PTT, gate de envio, descarte de frames antigos e cancelamento por geração. Importação em cópia converte dados públicos preservando IDs e reserva autores contra apropriação. Verificador de atualização é offline; instalador/downloader ainda pendentes. Jogos Rust possuem oráculos diferenciais e autoridade por canal; cenários, mesas, avatares e animações 3D continuam pendentes.

Verificações executadas: npm test 83/83 e npm run build passaram. Integrações Worker test:native/test:host/test:session passaram; sessão ampliada verificou respostas/reactions/search via IPC, cargos/presença, amizade e DMs editar/ler/excluir/negação de autoria, notificações, reanexação e identidade estrangeira negada. Malha: 12 frames Opus, três peers, isolamento, 24 frames enfileirados bloqueados após fechar gate e revogação. Reconexão: quatro admissões da mesma identidade com histórico restaurado. Sem rede pública ou microfone nesses testes.

QA interno: 15 capturas, 229 bounds, zero falhas nas invariantes. Inspeção encontrou header recortado em 900 px; correção funcional em andamento. Evidências em evidence/native-2.0/functional. Capturas não significam teste humano nem aprovação estética. Verificação final será consolidada após integração das frentes.

Gates reais: mídia Windows completa integrada, mundo/avatares/mesas 3D, imagens/perfis completos, chamadas privadas reservadas, DND/notificações Windows, importação integral autenticada, instalador/rollback, auditoria/soak, redes públicas e qualidade acústica. Conta Cloudflare ausente não paralisa essas frentes. Design & Release Polish adiado até integração completa. Não há percentual de prontidão ou candidato aprovado.

### Checkpoint funcional integrado

Suíte Rust comum: **56 testes passaram**, seis integrações opt-in ficam ignoradas (quatro de sessão, uma WGC e uma bandeja). Clippy com warnings negados passou. Oráculos TS têm hashes conferidos. npm test **83/83** e npm run build passaram. Jogos agora passam pelo host/canal com cartas filtradas por espectador, replay limitado e física autoritativa enviada por P2P; sem motor/mesas 3D ainda.

WGC/D3D11 real: 14 frames de uma janela própria de teste, dois ciclos MTA, seis capturas/liberações e dois redimensionamentos. Uma câmera teve apenas metadados enumerados; não foi ativada. Corrigidas falhas de ciclo COM detectadas durante esse teste. Backend ainda sem streaming/encode/decode/UI/áudio. Bandeja nativa tem abrir/mute/deafen/sair e ciclo de criação/destruição verificado por API; notificações usam balão Shell somente com UI encerrada, respeitando tipos/DND/Busy/som e sem reemitir histórico. Clique humano e toast/Action Center não homologados.

Inicialização automática e protocolo **voxy-native://** são preferências explícitas experimentais, com rollback de registro testado em memória. **voxy://** estável não é substituído. Nenhum registro real foi alterado nos testes. Código, package/lock, saída e catálogo permanecem **2.0.0 em preparação**; última publicação **1.4.1**. Sem push, deploy, tag ou release.
