# Paridade funcional — 1.4.1 → 2.0

## Evidência do incremento nativo

Entradas “Parcial” indicam código e verificação local, nunca paridade física aprovada. [Capturas da UI](evidence/native-2.0/ui/ui-smoke.json), [host entre processos](evidence/native-2.0/host-integration.json) e testes Rust documentados em PROGRESS. Nenhuma sala 3D/minijogo, transmissão, updater nativo ou rede pública foi declarada concluída.

Inventário em 2026-11-16, baseado no código `7df27bc684c0743fa52e12bfe6aae5073dd02371`. **Implementação Rust parcial, sem paridade global homologada.** A validação manual recebida aplica-se à 1.4.1. “Existente” significa implementação identificada no repositório, não homologação física ou garantia de ausência de bugs na 1.x. Não marcar uma linha concluída apenas por compilar ou portar um tipo.

Legenda de reaproveitamento: **E** = especificação/fixture/regra a portar; **A** = assets/dados aproveitáveis com adaptação; **R** = reconstrução nativa. `*.test.ts` são testes unitários/integração em Node; `*.e2e.ts`/`*.app.ts` podem usar mídia sintética. A existência de um teste não significa que ele foi executado nesta sessão; consultar PROGRESS.

Cada linha passará a registrar commit, teste, artefato de evidência, ambiente e limitações quando migrada. IDs permanecem estáveis para rastreamento.

| ID | Funcionalidade existente / fonte | Oráculo ou referência | Reuso | Estado Rust / aceite |
| --- | --- | --- | --- | --- |
| UI01 | Home/entrar/hospedar — `components/Home.tsx`, `App.tsx` | `ux.e2e.ts`, `redesign.e2e.ts` | E/R | Parcial — UI usa WSS público padrão, convites e sessão real; fluxos testados na infraestrutura pública com peers na mesma máquina; redes distintas pendentes |
| UI02 | Recentes, disponibilidade, reconectar/remover — `recentRooms.ts`, `useSavedRooms.ts` | `rooms.test.ts`, `systemFeatures.e2e.ts` | E/A/R | Parcial — até 40 recentes DPAPI, lista completa/reconectar/remover na UI; sem sondagem pública de disponibilidade do host |
| UI03 | Trilho e navegação servidor/canal/DM/Novidades — `ServerRail`, `navigation.ts` | `desktop.e2e.ts`, `ux.e2e.ts` | E/R | Implementada/integrada — trilho de servidores, lateral contextual (canais com participantes de voz, DMs, seções), tela de chamada dedicada; texto abre o chat e voz abre a chamada sem interrompê-la; E2E real voice-3/tour-3 |
| UI04 | Hub pesquisável, rascunho/desfazer e salvar — `App.tsx`, `HubNavigation` | `redesign.e2e.ts`, DESIGN-SYSTEM | E/R | Parcial — Configurações nativas com seções/rascunho/salvar/desfazer implementadas; busca global pendente |
| UI05 | Temas Voxy/Oceano/Bosque/Kuromi, acento — `Personalization.tsx`, CSS | `ui-themes.test.ts`, `ui-1.3.0/` | E/A/R | Parcial — Quatro paletas nativas implementadas; ilustrações/atribuições/contraste completos pendentes |
| UI06 | Layout, tipografia, hover, foco e movimento reduzido — CSS | `ux.e2e.ts`, DESIGN-SYSTEM | E/R | Parcial — design system "Nocturne glass" (tokens, Lucide, componentes) implementado; regressão de renderização e hover-50; contraste por teste; DPI ≠ 100 % e acessibilidade com leitor de tela pendentes |
| UI07 | Perfil foto/emoji, nickname/capa e mini perfil — `ProfileForm`, `Avatar`, `photos.ts` | `personalization.test.ts`, `social.e2e.ts` | E/A/R | Parcial — nome/ID, cor de nickname, presença e mini perfil com volume/mencionar/mensagem integrados; foto, capa e emoji de perfil pendentes |
| UI08 | Canal Novidades offline e popup uma vez — `ReleaseChannel`, `ReleaseNotesStore` | `updates.test.ts`, `remoteUpdates.test.ts` | E/A/R | Implementada/integrada/testada automaticamente — catálogo offline, diálogo nativo até reconhecimento persistido por versão; updater/instalação real pendentes |
| SV01 | Criar/renomear/excluir servidor/canal — `host.ts`, `store.ts`, `ServerManager` | `signaling.test.ts`, `rooms.test.ts` | E/R | Implementada/integrada — criar/renomear/excluir servidor local e canais; renomear canal também na UI e no host remoto; autorização testada |
| SV02 | Imagem e dono do servidor, legado sem dono — `store.ts` | `rooms.test.ts` | E/A/R | Pendente; dono não sobrescrito |
| SV03 | Convites/rotação de segredo/limite dez — `main/index.ts`, `host.ts` | `signaling.test.ts`, INSTALACAO-E-CONEXAO | E/R | Implementada/integrada/testada localmente — convite assinado, expiração e renovação autenticada com corte de links anteriores; internet/CGNAT/relay não homologados |
| SV04 | Canais de voz, presença e estado de mídia — `host.ts`, `Presence`, `ParticipantStatus` | `signaling.test.ts`, `voiceControls.e2e.ts` | E/R | Parcial — Canais de voz com captura e transmissão/reprodução entre processos integradas; mídia de vídeo pendente |
| SV05 | Cargos nome/cor/ordem/atribuição por servidor — `store.ts`, `Roles.tsx` | `personalization.test.ts` | E/A/R | Implementada/integrada/testada automaticamente — até 50 cargos nome/cor/ordem, atribuição pelo dono sem poderes administrativos; homologação física pendente |
| CH01 | Mensagens persistentes, imagens/preview/ampliação — `Chat`, `store.ts`, `image.ts` | `signaling.test.ts`, `social.e2e.ts` | E/A/R | Implementada/integrada — texto e imagens PNG/JPEG até 3 MiB, blocos/hash/ACL, preview/ampliação; testada por IPC/P2P público com peers na mesma máquina |
| CH02 | Editar/excluir só próprias mensagens — `host.ts`, `store.ts` | `signaling.test.ts` | E/R | Parcial — Edição/exclusão por autoria integradas a comandos confirmados; validação ampla multiplayer ainda pendente |
| CH03 | Respostas, menções, reações — `Chat`, `MessageText`, `store.ts` | `social.test.ts`, `social.e2e.ts` | E/R | Implementada/integrada/testada automaticamente — respostas no mesmo canal, menções por ID e reações, exclusão/escopo/persistência verificados; homologação física pendente |
| CH04 | Histórico paginado/busca — `useChatHistory`, `store.ts`, `direct.ts` | `personalization.test.ts`, `social.test.ts` | E/A/R | Implementada/integrada/testada automaticamente — History/Search remotos, cursor tempo+ID, até 100 e orçamento UTF-8 384 KiB; cache limitado e invalidação por revisão; busca sem normalização Unicode completa |
| CH05 | Links clicáveis seguros — `links.ts`, `openExternal` | `links.test.ts` | E/R | Implementada/integrada/testada automaticamente — HTTP/S sem credenciais, texto/pontuação preservados, ShellExecuteW; confirmação do navegador físico pendente |
| SO01 | Presença online/away/busy e offline derivado — `types.ts`, `host.ts` | `direct.test.ts` | E/A/R | Implementada/integrada/testada automaticamente — Online/Ausente/Ocupado persistidos por host, offline derivado; DND completo pendente |
| SO02 | DMs privadas por sala, imagens, edição/reação/histórico — `DirectMessages`, `DirectStore` | `direct.test.ts`, `social.test.ts` | E/A/R | Parcial — texto/imagens, edição/exclusão/leitura, páginas privadas até 100/256 KiB por conversa; respostas/reações de DM pendentes |
| SO03 | Inbox offline/não lidas/leitura focada — `DirectInbox`, `useInbox` | `direct.test.ts`, `directThreads.ts` | E/A/R | Pendente; não ressuscitar mensagem apagada |
| SO04 | Amizade aceitar/recusar/remover — `SocialStore`, `Friends` | `social.test.ts` | E/A/R | Parcial — Solicitar/aceitar/recusar/remover por servidor implementado, com teste de consentimento e privacidade |
| SO05 | Chamada privada e canal reservado — `host.ts`, `Friends` | `social.test.ts`, `social.e2e.ts` | E/R | Pendente; acesso só aos convidados e cleanup |
| AU01 | Captura/seleção de microfone/saída — `engine.ts`, `microphone.ts` | `microphone.e2e.ts`, `audio.e2e.ts` | E/R | Parcial — seleção/CPAL e recuperação limitada integradas; falha em chamada ativa força mute e repete a mesma seleção, sem unmute automático; testes lógicos, hotplug/acústica físicos pendentes |
| AU02 | AEC/NS/AGC — `microphoneConstraints` | `preferences.test.ts`, AUDIO-E-CONEXAO | E/R | Parcial — Adaptador AEC3/NS/AGC experimental implementado; homologação acústica pendente |
| AU03 | Ganho/sensibilidade/VAD/gate e medidores — `MicrophonePipeline` | `preferences.test.ts`, `microphone.e2e.ts` | E/R | Parcial — Gate/ganho/VAD no pipeline integrado; controles de sensibilidade/medidores completos pendentes |
| AU04 | Teste privado, pausa/restauração do envio — `microphoneTest.ts` | `microphone.e2e.ts` | E/R | Parcial — teste privado usa NS/AGC/ganho/VAD compartilhados com a chamada, sem rede ou AEC; requer fones e homologação acústica |
| AU05 | PTT tecla global — `pushToTalk.ts`, `preferences.ts` | `pushToTalk.e2e.ts` | E/R | Parcial — PTT Win32 com falha fechada implementado/testado em lógica; teste com jogo em foco pendente |
| AU06 | Mouse 4/5 e atalhos combinados — `pushToTalk.ts`, `ShortcutPicker` | `voiceControls.test.ts`, `pushToTalk.e2e.ts` | E/R | Parcial — Mouse4/5, combinações/conflitos e lease PTT implementados/testados em lógica; jogo em foco e dispositivos pendentes |
| AU07 | Mute/deafen, atalhos e restauração do mute — `engine.ts`, `preferences.ts` | `voiceControls.test.ts`, `voiceControls.e2e.ts` | E/A/R | Parcial — mute/deafen globais configuráveis e prioridades seguras integrados/testados logicamente; homologação física pendente |
| AU08 | Volume individual até 200%, mute local persistente — `voicePlayback.ts` | `voiceControls.e2e.ts`, `preferences.test.ts` | E/A/R | Parcial — Volume 0–200% no mixer/UI e persistência por UUID; mute local separado e acústica pendentes |
| AU09 | Sons entrada/saída/tela/PTT/mute — `engine.ts`, `useNotifications` | `audio.e2e.ts`, `notifications.test.ts` | E/R | Implementada/integrada/testada — notas do Electron sintetizadas no núcleo, após o gate de ensurdecer e dentro da referência do AEC; transições confirmadas (entrar/sair, participantes, mute/deafen, PTT, tela/câmera, DM/menção/amizade); grupos/volume/DND; E2E detecta o cue de entrada no analisador; audição física não homologada |
| AU10 | Reconexão ao canal, cancelamento e timeout — `App.tsx`, `engine.ts` | `callRecovery.e2e.ts`, `callDiagnostics.test.ts` | E/R | Parcial — Geração, timeout e backoff com oito tentativas implementados; falhas físicas/rede pública e ICE restart completos pendentes |
| AU11 | Peers quatro transceivers, ICE restart/filas — `engine.ts` | `callNetwork.e2e.ts`, `media.e2e.ts` | E/R | Parcial — Malha Opus/SRTP com três peers testada; API duplex entre dois processos; vídeo/transceivers/ICE restart pendentes |
| AU12 | Diagnóstico seguro e tentar novamente — `callDiagnostics.ts`, `App.tsx` | `callRecovery.e2e.ts` | E/R | Parcial — Etapas/erros/contadores sem SDP/credenciais na UI; exportação de diagnóstico completo pendente |
| AU13 | Voz por proximidade/panorama estéreo — `RoomView`, `voicePlayback` | `room3d.test.ts`, `room3d.app.e2e.ts` | E/R | Parcial — Função de panorama/distância testada; integração ao mundo pendente |
| ME01 | Tela inteira/janela e seleção explícita — `ShareForm`, main/engine | `media.e2e.ts`, `captureAudio.e2e.ts` | E/R | Implementada/integrada/testada — seletor com prévia privada, presets, WGC/H.264 e espectador remoto; screen-2 16/16 com instâncias reais e sinalização pública |
| ME02 | Áudio de tela com exclusão do Voxy — `capture.ts`, engine | `voiceControls.test.ts`, `captureAudio.e2e.ts` | E/R | Implementada/integrada/testada com tons físicos autorizados — loopback por processo (incluir/excluir árvore) e share-audio-3 16/16: app compartilhado chega, outro app não, sem retransmissão da chamada, microfone não duplicado; sincronia A/V não medida com precisão |
| ME03 | Qualidade/bitrate e reinício sem sair da voz — `ShareForm`, engine | `media.e2e.ts` | E/R | Parcial — presets e bitrate por pressão local; adaptação por RTT/perda e codificação por hardware pendentes |
| ME04 | Webcam independente, seleção e liberação — `CameraTile`, engine | `media.e2e.ts`, `gallery.e2e.ts` | E/R | Implementada/integrada/testada — seleção, prévia privada, publicar só por ação explícita, assistir, desligar; camera-2 12/12 (corrigido decoder para alturas não múltiplas de 16); câmera física não homologada |
| ME05 | Grade de várias telas/câmeras e subscriptions — `MediaGallery`, engine | `gallery.e2e.ts`, `personalization.test.ts` | E/R | Implementada/integrada — grade adaptativa de voz/câmera/tela, destaque com faixa, assinatura sob demanda por espectador |
| ME06 | Fullscreen/enquadramento/HUD — `Player.tsx` | `gallery.e2e.ts`, `ux.e2e.ts` | E/R | Implementada/integrada/testada — tela cheia com HUD que some e reaparece (screen-2) |
| ME07 | PiP nativo sempre no topo — main, `Player` | `systemFeatures.e2e.ts` | E/R | Implementada/integrada/testada — PiP sempre no topo, compacto e recebendo quadros (screen-2) |
| WD01 | Lounge completo, móveis e iluminação — `environment.ts` | `room3d.visual.ts`, capturas `rooms3d-1.2.1` | E/A/R | Parcial — catálogo original e prévia wgpu separados; entrada multiplayer/interação/avatar pendentes |
| WD02 | Cinema, corredores, assentos, teto e TV — `environment.ts` | `room3d-rebuild.test.ts`, `room3d.visual.ts` | E/A/R | Parcial — catálogo original e prévia wgpu; interação dinâmica/TV/assentos multiplayer pendentes |
| WD03 | Rooftop noturno/cidade/pergolados/jogos — `Rooftop.ts` | `social3d.app.ts`, `social-1.4.0/rooftop.png` | E/A/R | Parcial — catálogo original e prévia wgpu; mundo social completo pendente |
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
| GA01 | Sinuca Rotação 7: colisões/caçapas/faltas/bola na mão — `pool.ts` | `pool.test.ts`, `pool.match.ts`, `pool.bot.ts` | E/R | Regras/física Rust testadas diferencialmente — 176 operações/10.278 passos fixos, quatro cenários, tolerância geométrica 1e-7; apresentação 3D/homologação pendentes |
| GA02 | Mira fixa/força/teclas/câmera/tacada no cenário — `PoolTable`, `PlayingCue`, `poolMotion` | `pool.app.match.ts`, `pool.visual.ts` | E/R | Pendente; regressão da mira 1.4.1 preservada |
| GA03 | Sinuca multiplayer/espectador/autoridade — `host.ts` | `pool.app.match.ts`, `signaling.test.ts` | E/R | Autoridade Rust integrada ao host/canal; física avançou em snapshots P2P no teste público com voz sintética; apresentação física/multiplayer visual pendentes |
| GA04 | Truco quatro jogadores/duplas/baralho/vira/manilhas — `truco.ts` | `truco.test.ts`, `truco.app.ts` | E/R | Regras Rust testadas diferencialmente — 742 passos/3.710 snapshots públicos e privados; mesa 3D pendente |
| GA05 | Truco/seis/nove/doze/onze/ferro/cobertas — `truco.ts` | `truco.test.ts` | E/R | Regras Rust testadas diferencialmente, aumentos/onze/ferro/cobertas; apresentação/animações pendentes |
| GA06 | Truco privacidade de cartas/espectadores — `GameRoom`, `host` | `socialGames.test.ts` | E/R | Snapshots por jogador/espectador testados contra TS; apresentação 3D e homologação pendentes |
| GA07 | Xadrez regras especiais/xeque/fim/empates — `chess.ts`, chess.js | `chess.test.ts`, `chess.app.ts` | E/R | Wrapper cozy-chess exato testado — 17 cenários/198 operações/594 snapshots contra TS; apresentação 3D/homologação pendentes |
| GA08 | Xadrez peças físicas/seleção/animação/promoção — `ChessTable`, `ChessPieces`, `chessMotion` | `chess.app.ts`, `games.visual.ts` | E/R | Pendente; experiência no cenário, sem popup substituto |
| GA09 | Reserva reconexão 60 s/pausa/abandono/revanche — `gameSession.ts` | `chess.test.ts`, `truco.test.ts` | E/R | Pendente; sinuca conserva semântica distinta |
| NT01 | Central avisos/histórico/leitura/deduplicação — `notifications.ts`, `NotificationCenter` | `notifications.test.ts` | E/A/R | Parcial — central Home, persistência privada, deduplicação por comando, leitura e contexto de canal/DM; navegação exata e notificação Windows pendentes |
| NT02 | Menção/resposta/amizade/DM, sons/tipos/DND/mute sala — notifications/profile | `notifications.test.ts`, `systemFeatures.e2e.ts` | E/A/R | Parcial — menção/resposta/amizade/DM persistidos; sons, DND e notificação Windows pendentes |
| WI01 | Notificação Windows — main | `systemFeatures.e2e.ts` | E/R | Parcial — balão Shell com UI encerrada e DND/tipos/som; clique/Action Center físico pendente |
| WI02 | Bandeja/abrir/mute/deafen/sair/fechar no X — main | `systemFeatures.e2e.ts` | E/R | Parcial — bandeja abrir/mute/deafen/sair, fechar UI mantém chamada e reabrir reanexa; API de ciclo da bandeja testada anteriormente, clique físico pendente |
| WI03 | Login automático/início minimizado/manual visível — `desktopIdentity`, main | `desktopIdentity.test.ts`, `systemFeatures.e2e.ts` | E/A/R | Parcial — preferências/registro experimental com rollback testado em memória; login real não homologado |
| WI04 | Barra integrada/tema/minimizar/maximizar/fullscreen — main | `desktop.e2e.ts`, `redesign.e2e.ts` | E/R | Parcial — Caption vetorial integrado com comandos reais, estado maximizado e double click; DPI/fullscreen completo pendente |
| WI05 | Nome/appId/ícone/atalhos e desenvolvimento isolado — `desktopIdentity.ts`, installer | `desktopIdentity.test.ts`, `packaged.e2e.ts` | E/A/R | Pendente; final sem duplicar instalação estável |
| UP01 | Updates automáticos download/reinício explícito — `remoteUpdates.ts` | `remoteUpdates.test.ts`, `updater.runtime.ts` | E/R | Pendente; executor Rust e recuperação |
| UP02 | Ed25519/hashes/tamanho/allowlist/anti-downgrade — `updateTrust`, transport | `remoteUpdates.test.ts`, `updates.test.ts` | E/A/R | Implementada/testada automaticamente offline — Ed25519 v1/SPKI, hashes/manifesto, URLs/redirects e antirollback com oráculo Node; downloader/installer pendentes |
| UP03 | Instalador local/staging/backup — `updates.ts` | `updates.test.ts`, `packaged.e2e.ts` | E/R | Parcial — instalador NSIS/ZIP local, assets/runtime MSVC assinado/probes/hashes; aplicação/backup/rollback de atualização e instalação em VM pendentes |
| UP04 | Actions/NSIS/tag/releases/manifesto/catalogação — release.yml/scripts | `validate-release`, `verify-publication` | E/R | Parcial — workflow nativo compila/testa; execução manual prepara ZIP como artefato, sem release/tag/deploy; fluxo remoto não executado nesta sessão |
| DA01 | Perfil/UUID/identidade/segredo host — main/deviceIdentity | `direct.test.ts`, `preferences.test.ts` | A/R | Parcial — perfil UUID/campos preservados em cópia; identidade Electron DPAPI e associação autenticada pendentes |
| DA02 | Histórico/servidores/cargos/amigos/DMs/imagens SQLite — database | `direct.test.ts`, `social.test.ts`, `atomicFile.test.ts` | A/R | Parcial — servidores com dono/canais/mensagens/respostas/reações em transação, contagens/integridade/rollback; autores reservados; outras tabelas preservadas no backup sem alegar conversão |
| DA03 | Recentes/inbox/avisos/notas/cache/visuais salvos — main/editor | `rooms.test.ts`, `notifications.test.ts` | A/R | Pendente; cópia reversível, LevelDB e escopos preservados |
| PF01 | Modo baixo consumo/medidores/ticks inativos — core/renderer | `resources.performance.ts`, STABILITY-1.4.1 | E/R | Pendente; todos os processos e helpers contados |

## Requisitos novos, sem equivalência pronta na 1.x

| ID | Ampliação solicitada | Estado / evidência necessária |
| --- | --- | --- |
| NEW01 | Binário Rust sem Electron/Chromium/WebView/Node | Pendente; árvore de dependências, processos e módulos carregados |
| NEW02 | Convite público, descoberta, host sem VPN/porta manual | Parcial — Worker público, endpoint padrão e testes de dados/voz sintética sem VPN na infraestrutura pública; duas redes e matriz restritiva pendentes |
| NEW03 | ICE/STUN/TURN, CGNAT/simétrico/firewall, IPv6 | Pendente; matriz real e relay selecionado, expiração e reconexão |
| NEW04 | Proteção efetiva de custo e credenciais temporárias | Pendente; corte demonstrado, abuso com cliente modificado e inspeção das condições do provedor |
| NEW05 | Identidade pública assinada/convites revogáveis/replay | Pendente; revisão criptográfica e testes adversariais |
| NEW06 | Captura de áudio da aplicação selecionada | Pendente; distinguir da exclusão do Voxy existente e medir isolamento |
| NEW07 | UI encerrável/3D em processo opcional sem perder chamada | Pendente; teardown/reabertura/crash e memória/GPU efetivas |
| NEW08 | Importação transacional/reversível 1.x→2.x | Pendente; backups e recuperação DPAPI/Local Storage |
| NEW09 | Atualização Electron→Rust com recuperação | Pendente; ensaio em VM, encerramento de todos os processos antigos e autorização de rollout |
| NEW10 | Meta experimental 30–80 MB na chamada minimizada | Pendente; benchmark real equivalente, sem omitir workers e sem sacrificar áudio |

Envio arbitrário de arquivos além de imagens não foi identificado na base atual: será extensão do transporte de anexos, não funcionalidade “já preservada”. Autenticação global, RBAC completo, SFU e host migration também não devem ser marcados como existentes.


## Execução contínua — 17/11/2026

Estados distinguem implementação, integração e teste automático da homologação física. As portas de jogos não substituem mesas 3D por interfaces alternativas. Nenhuma paridade global é declarada. Evidências em evidence/native-2.0/functional.


## Consolidação da retomada

CH01 e SO02 avançaram: imagens PNG/JPEG com upload/read autenticados, persistência, limites e galeria nativa integrados; continuam pendentes os formatos/fluxos legados ainda não migrados e a homologação física. WD01–WD03 têm geometria procedural/catalogação e renderer nativo verificáveis, sem declarar ambientes socialmente completos. Vídeo tem captura e codec/transporte em testes isolados; MV/NEW06 não estão homologados. UP03/UP04 têm preparação de fontes de empacotamento, sem release, instalador homologado ou updater nativo completo.

## Estado da execução pública — 17/11/2026

2.0.0 continua em preparação; última distribuição 1.4.1. Worker voxy-native-signaling-experimental implantado em wss://voxy.devbarros.com; SignalRoom e AdmissionBudget SQLite, deployment=true, relay=false, 1.000 admissões/dia e dez salas. Domínio configurado com override de DNS/origem explicitamente false e changeset sem conflitos. Credencial local Wrangler não entra nos artefatos. Não houve push, tag, release, alteração de main ou do protocolo estável.

Testes públicos executam os fluxos reais de sessão (IPC/P2P), imagens, chat/DMs, malha Opus sintética de três peers, canais isolados, revogação e quatro reconexões. Evidência: evidence/native-2.0/public/session-integration.json. Todos os peers estão nesta máquina; não é homologação de redes distintas ou dispositivos. O resolvedor do sistema retorna ENOTFOUND para o novo domínio; DNS sobre HTTPS encontra A e HTTPS/TLS são válidos. Somente o teste debug permite endereço resolvido externamente, mantendo SNI/certificado; release não lê esse override.

Integrado neste conjunto: endpoint público/STUN padrão; convites voxy-native:// com leitura compatível de convites nativos anteriores; renomeação de canal na UI; páginas privadas de DMs com cursor tempo+ID, limites de bytes e sem recibos persistentes; lista/remoção de recentes. Não reimplementados motores de jogos ou catálogos. Compartilhamento/webcam completos, mundo dinâmico, avatares/mesas, migração privada e updater transacional permanecem abertos. Design & Release Polish congelado.
