# Paridade funcional — 1.4.1 → 2.0

## Evidência do incremento nativo

Entradas “Parcial” indicam código e verificação local, nunca paridade física aprovada. [Capturas da UI](evidence/native-2.0/ui/ui-smoke.json), [host entre processos](evidence/native-2.0/host-integration.json) e testes Rust documentados em PROGRESS. Nenhuma sala 3D/minijogo, transmissão, updater nativo ou rede pública foi declarada concluída.

Inventário em 2026-11-16, baseado no código `7df27bc684c0743fa52e12bfe6aae5073dd02371`. **Implementação Rust parcial, sem paridade global homologada.** A validação manual recebida aplica-se à 1.4.1. “Existente” significa implementação identificada no repositório, não homologação física ou garantia de ausência de bugs na 1.x. Não marcar uma linha concluída apenas por compilar ou portar um tipo.

Legenda de reaproveitamento: **E** = especificação/fixture/regra a portar; **A** = assets/dados aproveitáveis com adaptação; **R** = reconstrução nativa. `*.test.ts` são testes unitários/integração em Node; `*.e2e.ts`/`*.app.ts` podem usar mídia sintética. A existência de um teste não significa que ele foi executado nesta sessão; consultar PROGRESS.

Cada linha passará a registrar commit, teste, artefato de evidência, ambiente e limitações quando migrada. IDs permanecem estáveis para rastreamento.

| ID | Funcionalidade existente / fonte | Oráculo ou referência | Reuso | Estado Rust / aceite |
| --- | --- | --- | --- | --- |
| UI01 | Home/entrar/hospedar — `components/Home.tsx`, `App.tsx` | `ux.e2e.ts`, `redesign.e2e.ts` | E/R | Parcial — UI hospeda/entra por convite e usa sessão real; domínio/deploy/rede pública ainda pendentes |
| UI02 | Recentes, disponibilidade, reconectar/remover — `recentRooms.ts`, `useSavedRooms.ts` | `rooms.test.ts`, `systemFeatures.e2e.ts` | E/A/R | Parcial — 40 recentes com convite DPAPI e reconexão implementados; disponibilidade/remoção completas pendentes |
| UI03 | Trilho e navegação servidor/canal/DM/Novidades — `ServerRail`, `navigation.ts` | `desktop.e2e.ts`, `ux.e2e.ts` | E/R | Parcial — Navegação de servidores/canais/DM/novidades integrada; avisos/não lidas pendentes |
| UI04 | Hub pesquisável, rascunho/desfazer e salvar — `App.tsx`, `HubNavigation` | `redesign.e2e.ts`, DESIGN-SYSTEM | E/R | Parcial — Configurações nativas com seções/rascunho/salvar/desfazer implementadas; busca global pendente |
| UI05 | Temas Voxy/Oceano/Bosque/Kuromi, acento — `Personalization.tsx`, CSS | `ui-themes.test.ts`, `ui-1.3.0/` | E/A/R | Parcial — Quatro paletas nativas implementadas; ilustrações/atribuições/contraste completos pendentes |
| UI06 | Layout, tipografia, hover, foco e movimento reduzido — CSS | `ux.e2e.ts`, DESIGN-SYSTEM | E/R | Parcial — Sidebar/caption/avatars/chat corrigidos; bounds e capturas preenchidas; aprovação visual, DPI e acessibilidade pendentes |
| UI07 | Perfil foto/emoji, nickname/capa e mini perfil — `ProfileForm`, `Avatar`, `photos.ts` | `personalization.test.ts`, `social.e2e.ts` | E/A/R | Parcial — Nome e ID locais; foto/capa/cor/status/mini perfil ainda pendentes |
| UI08 | Canal Novidades offline e popup uma vez — `ReleaseChannel`, `ReleaseNotesStore` | `updates.test.ts`, `remoteUpdates.test.ts` | E/A/R | Parcial — Tela nativa de novidades e flag SQLite implementadas; atualização real/popup nativo pendentes |
| SV01 | Criar/renomear/excluir servidor/canal — `host.ts`, `store.ts`, `ServerManager` | `signaling.test.ts`, `rooms.test.ts` | E/R | Parcial — Criar/renomear/excluir servidor local, criar/excluir canais na UI, renomear canal pela API; gestão completa pendente |
| SV02 | Imagem e dono do servidor, legado sem dono — `store.ts` | `rooms.test.ts` | E/A/R | Pendente; dono não sobrescrito |
| SV03 | Convites/rotação de segredo/limite dez — `main/index.ts`, `host.ts` | `signaling.test.ts`, INSTALACAO-E-CONEXAO | E/R | Parcial — Convites assinados/expiração/admissão/limite dez implementados e testados no emulador; público/rotação completa pendentes |
| SV04 | Canais de voz, presença e estado de mídia — `host.ts`, `Presence`, `ParticipantStatus` | `signaling.test.ts`, `voiceControls.e2e.ts` | E/R | Parcial — Canais de voz com captura e transmissão/reprodução entre processos integradas; mídia de vídeo pendente |
| SV05 | Cargos nome/cor/ordem/atribuição por servidor — `store.ts`, `Roles.tsx` | `personalization.test.ts` | E/A/R | Pendente; preservar escopo; permissões arbitrárias não implementadas na 1.x |
| CH01 | Mensagens persistentes, imagens/preview/ampliação — `Chat`, `store.ts`, `image.ts` | `signaling.test.ts`, `social.e2e.ts` | E/A/R | Parcial — Texto persistente em tempo real na UI e host; imagens/preview/ampliação pendentes |
| CH02 | Editar/excluir só próprias mensagens — `host.ts`, `store.ts` | `signaling.test.ts` | E/R | Parcial — Edição/exclusão por autoria integradas a comandos confirmados; validação ampla multiplayer ainda pendente |
| CH03 | Respostas, menções, reações — `Chat`, `MessageText`, `store.ts` | `social.test.ts`, `social.e2e.ts` | E/R | Pendente; exclusão/revisão/escopo corretos |
| CH04 | Histórico paginado/busca — `useChatHistory`, `store.ts`, `direct.ts` | `personalization.test.ts`, `social.test.ts` | E/A/R | Parcial — Store pagina 100; UI filtra histórico recebido; paginação/busca remotas completas pendentes |
| CH05 | Links clicáveis seguros — `links.ts`, `openExternal` | `links.test.ts` | E/R | Pendente; somente HTTP/S válido e sem credenciais |
| SO01 | Presença online/away/busy e offline derivado — `types.ts`, `host.ts` | `direct.test.ts` | E/A/R | Pendente; busy mantém contadores |
| SO02 | DMs privadas por sala, imagens, edição/reação/histórico — `DirectMessages`, `DirectStore` | `direct.test.ts`, `social.test.ts` | E/A/R | Parcial — DMs de texto persistidas no host e snapshots privados; imagens/edição/reação/paginação completas pendentes |
| SO03 | Inbox offline/não lidas/leitura focada — `DirectInbox`, `useInbox` | `direct.test.ts`, `directThreads.ts` | E/A/R | Pendente; não ressuscitar mensagem apagada |
| SO04 | Amizade aceitar/recusar/remover — `SocialStore`, `Friends` | `social.test.ts` | E/A/R | Parcial — Solicitar/aceitar/recusar/remover por servidor implementado, com teste de consentimento e privacidade |
| SO05 | Chamada privada e canal reservado — `host.ts`, `Friends` | `social.test.ts`, `social.e2e.ts` | E/R | Pendente; acesso só aos convidados e cleanup |
| AU01 | Captura/seleção de microfone/saída — `engine.ts`, `microphone.ts` | `microphone.e2e.ts`, `audio.e2e.ts` | E/R | Parcial — CPAL integrado à chamada e teste duplex de APIs locais; hotplug e homologação acústica pendentes |
| AU02 | AEC/NS/AGC — `microphoneConstraints` | `preferences.test.ts`, AUDIO-E-CONEXAO | E/R | Parcial — Adaptador AEC3/NS/AGC experimental implementado; homologação acústica pendente |
| AU03 | Ganho/sensibilidade/VAD/gate e medidores — `MicrophonePipeline` | `preferences.test.ts`, `microphone.e2e.ts` | E/R | Parcial — Gate/ganho/VAD no pipeline integrado; controles de sensibilidade/medidores completos pendentes |
| AU04 | Teste privado, pausa/restauração do envio — `microphoneTest.ts` | `microphone.e2e.ts` | E/R | Parcial — Monitor privado com ciclo de vida implementado; ainda sem AEC, homologação física pendente |
| AU05 | PTT tecla global — `pushToTalk.ts`, `preferences.ts` | `pushToTalk.e2e.ts` | E/R | Parcial — PTT Win32 com falha fechada implementado/testado em lógica; teste com jogo em foco pendente |
| AU06 | Mouse 4/5 e atalhos combinados — `pushToTalk.ts`, `ShortcutPicker` | `voiceControls.test.ts`, `pushToTalk.e2e.ts` | E/R | Parcial — Mouse4/5 mapeados no leitor nativo; combinações/conflitos e teste físico pendentes |
| AU07 | Mute/deafen, atalhos e restauração do mute — `engine.ts`, `preferences.ts` | `voiceControls.test.ts`, `voiceControls.e2e.ts` | E/A/R | Parcial — Mute/deafen integrados à UI/serviço e têm prioridade; atalhos globais completos pendentes |
| AU08 | Volume individual até 200%, mute local persistente — `voicePlayback.ts` | `voiceControls.e2e.ts`, `preferences.test.ts` | E/A/R | Parcial — Volume 0–200% no mixer/UI e persistência por UUID; mute local separado e acústica pendentes |
| AU09 | Sons entrada/saída/tela/PTT/mute — `engine.ts`, `useNotifications` | `audio.e2e.ts`, `notifications.test.ts` | E/R | Pendente; sem repetição em snapshot nem envio ao mic |
| AU10 | Reconexão ao canal, cancelamento e timeout — `App.tsx`, `engine.ts` | `callRecovery.e2e.ts`, `callDiagnostics.test.ts` | E/R | Parcial — Geração, timeout e backoff com oito tentativas implementados; falhas físicas/rede pública e ICE restart completos pendentes |
| AU11 | Peers quatro transceivers, ICE restart/filas — `engine.ts` | `callNetwork.e2e.ts`, `media.e2e.ts` | E/R | Parcial — Malha Opus/SRTP com três peers testada; API duplex entre dois processos; vídeo/transceivers/ICE restart pendentes |
| AU12 | Diagnóstico seguro e tentar novamente — `callDiagnostics.ts`, `App.tsx` | `callRecovery.e2e.ts` | E/R | Parcial — Etapas/erros/contadores sem SDP/credenciais na UI; exportação de diagnóstico completo pendente |
| AU13 | Voz por proximidade/panorama estéreo — `RoomView`, `voicePlayback` | `room3d.test.ts`, `room3d.app.e2e.ts` | E/R | Parcial — Função de panorama/distância testada; integração ao mundo pendente |
| ME01 | Tela inteira/janela e seleção explícita — `ShareForm`, main/engine | `media.e2e.ts`, `captureAudio.e2e.ts` | E/R | Pendente; captura nativa e término da fonte |
| ME02 | Áudio de tela com exclusão do Voxy — `capture.ts`, engine | `voiceControls.test.ts`, `captureAudio.e2e.ts` | E/R | Pendente; isolar processo escolhido é melhoria nova, nunca loopback irrestrito |
| ME03 | Qualidade/bitrate e reinício sem sair da voz — `ShareForm`, engine | `media.e2e.ts` | E/R | Pendente; tráfego e hardware medidos |
| ME04 | Webcam independente, seleção e liberação — `CameraTile`, engine | `media.e2e.ts`, `gallery.e2e.ts` | E/R | Pendente; webcam física e hotplug |
| ME05 | Grade de várias telas/câmeras e subscriptions — `MediaGallery`, engine | `gallery.e2e.ts`, `personalization.test.ts` | E/R | Pendente; assinatura e decode sob demanda |
| ME06 | Fullscreen/enquadramento/HUD — `Player.tsx` | `gallery.e2e.ts`, `ux.e2e.ts` | E/R | Pendente; UX equivalente sem DOM |
| ME07 | PiP nativo sempre no topo — main, `Player` | `systemFeatures.e2e.ts` | E/R | Pendente; voz e mídia continuam ao minimizar |
| WD01 | Lounge completo, móveis e iluminação — `environment.ts` | `room3d.visual.ts`, capturas `rooms3d-1.2.1` | E/A/R | Pendente; não substituir por cenário reduzido |
| WD02 | Cinema, corredores, assentos, teto e TV — `environment.ts` | `room3d-rebuild.test.ts`, `room3d.visual.ts` | E/A/R | Pendente; colisão e composição equivalentes |
| WD03 | Rooftop noturno/cidade/pergolados/jogos — `Rooftop.ts` | `social3d.app.ts`, `social-1.4.0/rooftop.png` | E/A/R | Pendente; referência visual preservada |
| WD04 | Avatar procedural articulado/rosto/proporções — `avatar.ts`, `characterGeometry.ts` | `room3d-rebuild.test.ts`, `room3d-polish.test.ts` | E/R | Pendente; GLB arquivado não substitui modelo atual |
| WD05 | Doze cabelos, roupas/calçados/cores/barba/acessórios — avatar/editor | `room3d.visual.ts`, ASSETS-3D | E/R | Pendente; catálogo completo e silhuetas |
| WD06 | Preview/editor/zoom/desfazer/seis visuais — `AvatarCreator`, `AvatarPreview` | `room3d.app.e2e.ts`, capturas de creator | E/A/R | Pendente; importar `voxy-avatar-presets-v1` além do perfil |
| WD07 | Movimentação/câmera/zoom/colisão/navegação — `scene`, `camera`, `navigation` | `room3d.test.ts`, `room3d.e2e.ts` | E/R | Pendente; trajetos e parede/teto |
| WD08 | Sentar/levantar/ocupação e câmera sentada — `room3d.ts`, `host`, `camera` | `room3d-rebuild.test.ts`, `room3d-polish.test.ts` | E/R | Pendente; autoridade e poses corporais |
| WD09 | Animações/IK/taco e postura — `avatar`, `ArmIK`, `poolMotion` | `pool.test.ts`, `pool.app.match.ts` | E/R | Pendente; pegada/contato e altura do avatar |
| WD10 | Emotes/menu radial/cigarro/fumaça configurável — `EmoteWheel`, `emotes`, `avatar` | `social3d.app.ts`, `socialGames.test.ts` | E/R | Pendente; sincronização, cancelar e movimento reduzido |
| WD11 | TV com stream, seleção e foco/fullscreen — `RoomView`, `scene` | `room3d.app.e2e.ts` | E/R | Pendente; textura nativa, áudio único, compartilhar decoder quando possível |
| WD12 | Qualidade/fallback/modo tradicional — `RoomBoundary`, `RoomSettings` | `room3d.app.e2e.ts`, `room3d.performance.ts` | E/R | Pendente; 3D opcional sem interromper voz |
| WD13 | Lazy load, pausa oculto, dispose/carga tardia — `assets`, `resources`, `scene` | `resources.performance.ts`, `room3d.performance.ts` | E/R | Pendente; memória/GPU/processos efetivamente liberados |
| GA01 | Sinuca Rotação 7: colisões/caçapas/faltas/bola na mão — `pool.ts` | `pool.test.ts`, `pool.match.ts`, `pool.bot.ts` | E/R | Pendente; trajetórias e placares diferenciais |
| GA02 | Mira fixa/força/teclas/câmera/tacada no cenário — `PoolTable`, `PlayingCue`, `poolMotion` | `pool.app.match.ts`, `pool.visual.ts` | E/R | Pendente; regressão da mira 1.4.1 preservada |
| GA03 | Sinuca multiplayer/espectador/autoridade — `host.ts` | `pool.app.match.ts`, `signaling.test.ts` | E/R | Pendente; impulsos só no host e ação obsoleta rejeitada |
| GA04 | Truco quatro jogadores/duplas/baralho/vira/manilhas — `truco.ts` | `truco.test.ts`, `truco.app.ts` | E/R | Pendente; distribuição/ordem/empates equivalentes |
| GA05 | Truco/seis/nove/doze/onze/ferro/cobertas — `truco.ts` | `truco.test.ts` | E/R | Pendente; parceiro/aceite concorrente serializado |
| GA06 | Truco privacidade de cartas/espectadores — `GameRoom`, `host` | `socialGames.test.ts` | E/R | Pendente; ferro não envia nem mão do dono |
| GA07 | Xadrez regras especiais/xeque/fim/empates — `chess.ts`, chess.js | `chess.test.ts`, `chess.app.ts` | E/R | Pendente; mesma política de reivindicação/automação |
| GA08 | Xadrez peças físicas/seleção/animação/promoção — `ChessTable`, `ChessPieces`, `chessMotion` | `chess.app.ts`, `games.visual.ts` | E/R | Pendente; experiência no cenário, sem popup substituto |
| GA09 | Reserva reconexão 60 s/pausa/abandono/revanche — `gameSession.ts` | `chess.test.ts`, `truco.test.ts` | E/R | Pendente; sinuca conserva semântica distinta |
| NT01 | Central avisos/histórico/leitura/deduplicação — `notifications.ts`, `NotificationCenter` | `notifications.test.ts` | E/A/R | Pendente; navegar para mensagem/canal/DM |
| NT02 | Menção/resposta/amizade/DM, sons/tipos/DND/mute sala — notifications/profile | `notifications.test.ts`, `systemFeatures.e2e.ts` | E/A/R | Pendente; contadores sem alertar em busy/DND |
| WI01 | Notificação Windows — main | `systemFeatures.e2e.ts` | E/R | Pendente; clicar reabre destino |
| WI02 | Bandeja/abrir/mute/deafen/sair/fechar no X — main | `systemFeatures.e2e.ts` | E/R | Parcial — Sessão continua sem UI e reanexa ao reabrir; bandeja/menu completos pendentes |
| WI03 | Login automático/início minimizado/manual visível — `desktopIdentity`, main | `desktopIdentity.test.ts`, `systemFeatures.e2e.ts` | E/A/R | Pendente; não capturar mic por abrir UI |
| WI04 | Barra integrada/tema/minimizar/maximizar/fullscreen — main | `desktop.e2e.ts`, `redesign.e2e.ts` | E/R | Parcial — Caption vetorial integrado com comandos reais, estado maximizado e double click; DPI/fullscreen completo pendente |
| WI05 | Nome/appId/ícone/atalhos e desenvolvimento isolado — `desktopIdentity.ts`, installer | `desktopIdentity.test.ts`, `packaged.e2e.ts` | E/A/R | Pendente; final sem duplicar instalação estável |
| UP01 | Updates automáticos download/reinício explícito — `remoteUpdates.ts` | `remoteUpdates.test.ts`, `updater.runtime.ts` | E/R | Pendente; executor Rust e recuperação |
| UP02 | Ed25519/hashes/tamanho/allowlist/anti-downgrade — `updateTrust`, transport | `remoteUpdates.test.ts`, `updates.test.ts` | E/A/R | Pendente; tamper e pacote trocado rejeitados |
| UP03 | Instalador local/staging/backup — `updates.ts` | `updates.test.ts`, `packaged.e2e.ts` | E/R | Pendente; interrupção e espaço em disco |
| UP04 | Actions/NSIS/tag/releases/manifesto/catalogação — release.yml/scripts | `validate-release`, `verify-publication` | E/R | Pendente; canal experimental não chega à 1.x |
| DA01 | Perfil/UUID/identidade/segredo host — main/deviceIdentity | `direct.test.ts`, `preferences.test.ts` | A/R | Pendente; DPAPI real em cópia, sem regenerar silenciosamente |
| DA02 | Histórico/servidores/cargos/amigos/DMs/imagens SQLite — database | `direct.test.ts`, `social.test.ts`, `atomicFile.test.ts` | A/R | Pendente; FKs/contagens/hashes e importação idempotente |
| DA03 | Recentes/inbox/avisos/notas/cache/visuais salvos — main/editor | `rooms.test.ts`, `notifications.test.ts` | A/R | Pendente; cópia reversível, LevelDB e escopos preservados |
| PF01 | Modo baixo consumo/medidores/ticks inativos — core/renderer | `resources.performance.ts`, STABILITY-1.4.1 | E/R | Pendente; todos os processos e helpers contados |

## Requisitos novos, sem equivalência pronta na 1.x

| ID | Ampliação solicitada | Estado / evidência necessária |
| --- | --- | --- |
| NEW01 | Binário Rust sem Electron/Chromium/WebView/Node | Pendente; árvore de dependências, processos e módulos carregados |
| NEW02 | Convite público, descoberta, host sem VPN/porta manual | Pendente; fluxo completo entre duas redes, incluindo dados e mídia |
| NEW03 | ICE/STUN/TURN, CGNAT/simétrico/firewall, IPv6 | Pendente; matriz real e relay selecionado, expiração e reconexão |
| NEW04 | Proteção efetiva de custo e credenciais temporárias | Pendente; corte demonstrado, abuso com cliente modificado e inspeção das condições do provedor |
| NEW05 | Identidade pública assinada/convites revogáveis/replay | Pendente; revisão criptográfica e testes adversariais |
| NEW06 | Captura de áudio da aplicação selecionada | Pendente; distinguir da exclusão do Voxy existente e medir isolamento |
| NEW07 | UI encerrável/3D em processo opcional sem perder chamada | Pendente; teardown/reabertura/crash e memória/GPU efetivas |
| NEW08 | Importação transacional/reversível 1.x→2.x | Pendente; backups e recuperação DPAPI/Local Storage |
| NEW09 | Atualização Electron→Rust com recuperação | Pendente; ensaio em VM, encerramento de todos os processos antigos e autorização de rollout |
| NEW10 | Meta experimental 30–80 MB na chamada minimizada | Pendente; benchmark real equivalente, sem omitir workers e sem sacrificar áudio |

Envio arbitrário de arquivos além de imagens não foi identificado na base atual: será extensão do transporte de anexos, não funcionalidade “já preservada”. Autenticação global, RBAC completo, SFU e host migration também não devem ser marcados como existentes.
