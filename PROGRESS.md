# Progresso — Voxy 2.0.0 nativo

## Checkpoint 18/11/2026 — Beta 3 (2.0.0-beta.3): correções da primeira homologação real

**Publicada como pre-release** em 18/11/2026: tag `v2.0.0-beta.3` em `57b236d` (CI native.yml verde, run 44316121254), [release](https://github.com/labarro/Voxy/releases/tag/v2.0.0-beta.3) com instalador, ZIP e SHA256SUMS conferidos após download; latest continua 1.4.1 e o pipeline estável não foi acionado. CI expôs três problemas do próprio pipeline, corrigidos: compilação dentro do limite de 90 s do teste de sessão, hash das fixtures sensível a CRLF e testes de integração concorrentes no runner. Somente o agente principal, sem subagentes. Notas completas: [release-notes/v2.0.0-beta.3.md](release-notes/v2.0.0-beta.3.md).

**Causas raiz encontradas com evidência**
- **Servidor salvo exigia novo convite:** cada `Request::Host` criava convite com segredo novo e 24 h de validade.
  - Agora: convite do servidor persistido (DPAPI) e reutilizado.
  - **Acesso salvo** de membro, assinado pelo host, vinculado à chave do membro, com época de revogação.
  - Worker aceita o acesso, só consome admissão com o host online e substitui conexão antiga da mesma identidade.
- **"Alerta do antivírus" e UAC:** sem detecção do Defender e sem crash WER do Voxy.
  - O Firewall do Windows registrou prompts às 20:58:39 (`Downloads\voxy-native-experimental-2.0.0-win-x64\voxy-core.exe`, ZIP pré-redesign) e às 21:05:24 (Beta 2 instalada), liberados via `dllhost.exe`.
  - Causa reproduzida: mDNS (QueryOnly, padrão do webrtc-rs) liga a porta fixa UDP 5353. Porta fixa dispara o aviso; efêmera não. Em rede Pública, liberar exige administrador.
  - mDNS desligado; manifesto `asInvoker` nos três executáveis (antes não tinham manifesto).
- **Reabertura de versão antiga e ícone ausente:** a interface aceitava qualquer núcleo da pasta de dados (protocolo IPC 1, sem versão/caminho).
  - O núcleo do ZIP antigo atendia a Beta 2 e a bandeja dele (sem recurso de ícone) abria a interface irmã antiga.
  - Pedidos novos desconhecidos derrubavam o IPC.
  - Agora `session.json` traz versão e executável; a interface encerra núcleos de outra instalação/versão.
- **Fechar pelo X sem servidor encerrava o núcleo e o ícone**, por `Detached && network.is_none() → break`. Agora respeita "fechar para a bandeja".
- **multi-3 (voz muda e memória):** o envio de vídeo bloqueava o laço que encaminha a voz (`try_send` descartava áudio). Agora há fila de mídia por link, pulo até keyframe e pedido de keyframe ao publicador.
- **Guest perdia acesso após revogação** (achado pelo E2E): o laço de reconexão continuava com o convite. Agora adota o acesso salvo recebido.

**Funcionalidades recuperadas**
- Imagens inline em canais/DMs: cache por SHA-256, miniatura única, progresso, ampliar/salvar/copiar.
- Foto de perfil e banner sincronizados pelo host: `ImageTarget::Profile`, ACL de leitura para membros do servidor, avatar redondo com máscara aplicada à miniatura.
- Ícone original da 1.4.1 com fundo laranja (`#8f3b14`) para a Beta.
- Códigos curtos e links `/join/CODE`.
- Logs locais com panic hook; instalador com encerramento coordenado apenas da própria instalação.

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| persist-3 (pública) | 23/23 | `evidence/native-2.0/e2e/persist-3-release-public-20261118-092941` |
| screen-2 de pasta nova, sem evento de Firewall/Defender | 16/16 | `…/screen-2-release-public-freshpath-20261118-093150` |
| multi-3 (pública; antes falhava) | 15/15; núcleo de Ana 314,9 → 33,0 MiB privados | `…/multi-3-release-public-20261118-093304` |
| Bandeja/handoff (núcleo da Beta 2 instalada, 5 ciclos) | 15/15 | `…/tray-reopen-release-20261118-094402` |
| voice-3 | não aprovado nesta sessão: sondas de áudio intermitentes com Roblox aberto; baseline da Beta 2 também falhou | `…/voice-3-*-20261118-*` |
| Instalador (limpo, atualização, reinstalação, desinstalação, pasta alheia, interrompido, **atualização com processo aberto**) | aprovado | `scripts/test-native-installer.ps1` |
| Worker 13/13; Rust workspace + Clippy; npm test 83/83; npm run build | aprovado | — |

Worker implantado (versão `9c6ca307-714e-4e78-a875-ef19645ea49b`), com DO `InviteCodes` (migration v2, SQLite, plano Free).

Pendências: homologação física entre computadores e redes; voice-3 limpo com a máquina ociosa; DMs com imagem no E2E (a renderização é a mesma dos canais, mas não foi exercitada por instância real); avatares associados por nome; codificação por hardware; TURN desativado.

## Checkpoint 17/11/2026 (noite) — Experience & Design Polish + núcleo de comunicação

Commits locais: `38bf0e5` (design system, tela de chamada, sons, correções de renderização), `2bd7e63` (decoder de câmera, E2E de mídia), `5c2ca3a` (E2E de áudio compartilhado) e o commit de documentação/telas deste checkpoint. Sem push, tag ou publicação.

- **Camada preta acumulativa — causa raiz:** em `iced_tiny_skia 0.14.1` o pixmap da sombra era desenhado com máscara `None` (sem recorte) e o dano de um quad ignorava a sombra. Cada redesenho parcial escurecia o painel inteiro; só as regiões limpas voltavam ao normal (o padrão das capturas do usuário). Patch mínimo em `native/vendor/iced_tiny_skia` (ver `PATCH-VOXY.md`), testes `render_damage.rs` (o primeiro falhava com a correção parcial) e `hover-50` sobre pixels apresentados (PrintWindow): 0 pixels alterados após 50 ciclos.
- **Controles duplicados — causa raiz:** `DwmExtendFrameIntoClientArea(-1)` + janela transparente fazia o DWM desenhar os botões nativos atrás dos personalizados. Janela opaca, sem backdrop; dark mode e cantos arredondados mantidos. Snap Layouts nativo no botão maximizar não implementado (exige hit-test não cliente).
- **Interface:** design system (`design.rs`, `ui.rs`, Lucide em `icons.rs`), trilho/lateral/painéis (`chrome.rs`), tela de chamada (`call.rs`), chat e DMs (`chat.rs`, `direct.rs`), Home (`home.rs`), gerenciamento (`admin.rs`), seções de Vídeo e Notificações e sons. `art.rs` (ícones em canvas) e a atmosfera removidos. Prévias 3D fora da UI convencional; código preservado.
- **Indicadores de fala:** anel verde a partir de estado confirmado (gate local; nível decodificado remoto), retenção 450 ms; exportado à automação (`memberView`) e verificado no voice-3.
- **Sons:** `voxy-voice::cues` (tabela do Electron) + `voxy-session::sounds` (transições confirmadas, resumo pequeno do estado). Regressão encontrada e corrigida: clonar o `State` inteiro a cada publicação atrasava o áudio (voz própria vazava em 0,011); com o resumo voltou a 0,0.
- **Câmera:** decoder recusava superfície 368 linhas para 360p (teste TDD `software_h264_decodes_heights_not_aligned_to_16`).
- **Testes reais (release, sinalização pública, mesma máquina):** voice-3 28/28, screen-2 16/16 (inclui PiP), camera-2 12/12, share-audio-3 16/16 (tons físicos autorizados), hover-50 4/4, tour-3 (21 capturas). Isolamento WASAPI incluir/excluir árvore: A 6,06e-4 vs C 6,5e-11.
- **Recursos (amostra pontual voice-3):** interface ~29–30 MiB WS / ~11 MiB privados, sessão ~28 MiB WS / ~9,7 MiB privados; ver BENCHMARKS.

| Funcionalidade | Implementada | Integrada | E2E real | Homologação física | Evidência |
| --- | --- | --- | --- | --- | --- |
| Tela de chamada, grade, destaque, dock | sim | sim | sim (voice-3, screen-2, camera-2, tour-3) | não | `e2e/*-20261117-19*`, `visual/after` |
| Indicador verde de fala | sim | sim | sim (memberView) | não (fonte sintética) | voice-3 redesign |
| Sons | sim | sim | sim no voice-3 (entrada por dominância espectral; mute ouvido localmente e 0,0 na chamada); cue de participante entrando não verificável (harmônico da voz sintética na mesma sonda) | não | voice-3 (execuções 20:10–20:15) |
| Webcam | sim | sim | sim (camera-2) | não (câmera sintética) | camera-2-…-193136 |
| PiP | sim | sim | sim (screen-2) | não | screen-2-…-193214 |
| Áudio compartilhado isolado | sim | sim | sim (share-audio-3) | tons físicos no dispositivo padrão | share-audio-3-…-193728 |
| Multimídia simultânea 3 participantes | sim (cenário multi-3) | sim | **falhou** — Clara recebe tela+câmera e o áudio do app, mas o microfone de Ana chega mudo a todos e a sessão de Ana cresce a 315 MiB privados (Bruno 98 MiB) com tela e câmera publicadas ao mesmo tempo; causa em investigação | não | e2e/multi-3-release-public-20261117-201129 |
| Encoder por hardware / bitrate por rede | não | — | — | — | — |

**Intermitência sob carga:** com o Roblox aberto, a verificação "não ouve a própria voz" falhou de forma intermitente (0,0094–0,0098 contra limite 0,006, com 480 amostras de underrun); com a máquina ociosa a mesma build passou 28/28 (0,0009/0,0/0,0007). Não declarado como resolvido.

Instalador e ZIP experimentais regenerados com o código deste checkpoint (hashes em `evidence/native-2.0/public/verification.json`; não assinados, não instalados em VM, não publicados).

Pendências técnicas: defeito do multi-3 (microfone do transmissor mudo e crescimento de memória com tela+câmera simultâneas), intermitência de áudio sob carga, E2E dedicado de sons e PTT, sincronia A/V precisa, H.264 por hardware e adaptação por RTT/perda, foto/capa/emoji de perfil, reações/respostas em DMs, chamadas privadas, Snap Layouts, migração privada, atualizador (download/aplicação/rollback), instalação em VM. Homologação física pendente: microfones e câmeras reais, computadores e redes distintas, DPI ≠ 100 %.


## Checkpoint 17/11/2026 (tarde) — validação real com instâncias do aplicativo

Commits locais: `f0a989b` (runner de testes, E2E real, estados confirmados, lease da sinalização), `18c0115` (evidência pública de voz com 3 participantes), `62f76a9` (compartilhamento de tela ponta a ponta).

- **Testes**: `scripts/native.ps1 test` analisa cada suíte (mínimos em `scripts/native-test-manifest.json`), `e2e` roda opt-in explícitos (SKIPPED nunca conta como aprovado), `e2e-app` abre instâncias reais. Último: 80 aprovados, 8 opt-in separados; 7 opt-in aprovados com emulador; duplex físico não executado (sem autorização de dispositivos).
- **E2E real aprovado** (`evidence/native-2.0/e2e/`): voz 3 participantes, release, sinalização pública (28 verificações); compartilhamento de tela release + público (14 verificações: imagem decodificada igual ao padrão da janela de origem, movimento contínuo, tela cheia/HUD, envio cessa sem espectadores).
- **Infra**: lease de sala de 15 min no Worker (implantado, versão `6c7fb64f`), 8/8 testes do Worker. DNS normal resolve `voxy.devbarros.com`.
- **Interface**: falando/mudo/ensurdecido/mídia por participante, resumo da chamada e diagnóstico copiável vêm da sessão.
- Commits seguintes: `883e88a` câmera, `0e1ae5d` captura de áudio por processo, `ac86c76`/`a13e5fc` testes sem prompts de firewall, `7c790c5` áudio no compartilhamento, `456f545` mídia encerrada ao fechar a UI, `66e51d5` PiP.
- **Bloqueio de ambiente**: prompts "Segurança do Windows" (Firewall) abertos por executáveis de teste antigos (corrigido: testes usam loopback) impedem entrada injetada até serem fechados pelo usuário. Pendentes por isso: regressão `voice-3` após as trilhas de vídeo, `screen-2` com PiP, `camera-2`.

| Funcionalidade | Implementada | Integrada (UI+sessão) | E2E aprovado | Homologação física | Evidência |
| --- | --- | --- | --- | --- | --- |
| Sinalização pública sem VPN, convite, entrada | sim | sim | sim (release, público) | não (só esta máquina) | `e2e/voice-3-release-public-20261117-165715` |
| Voz bidirecional, 3 participantes, isolamento por fonte | sim | sim | sim | não (fonte sintética) | idem |
| Mute, ensurdecer, UI fechada com chamada viva, reabertura, saída | sim | sim | sim | não | idem |
| Estados confirmados (falando, mudo, mídia/RTT) e diagnóstico | sim | sim | sim | — | idem |
| Compartilhamento de tela (seletor, prévia, presets, grade, ampliar, tela cheia/HUD) | sim | sim | sim (release, público) | não | `e2e/screen-2-release-public-20261117-171624` |
| PiP | sim | sim | pendente (bloqueio de ambiente) | não | — |
| Câmera (seletor, prévia privada, publicar, assistir, desligar) | sim | sim | pendente (bloqueio de ambiente) | não (sem câmera física autorizada) | — |
| Áudio de aplicativo isolado / sistema sem Voxy | sim | sim | ativação validada; isolamento opt-in não executado | não (exige tocar tons no dispositivo) | teste `app_audio_windows` |
| Encoder por hardware, adaptação por feedback de rede | não (só software; adaptação por pressão local) | — | — | — | — |
- **Limites**: todos os participantes nesta máquina; sem NAT entre redes; codificação só por software; cliques físicos exigem não usar o mouse durante `e2e-app`.

Estado em 17/11/2026: **2.0.0 em preparação; última distribuição 1.4.1**. Branch migration/2.0-native-audit. Continuidade dos checkpoints 264f0d7 e 74a6847. Subagentes interrompidos a pedido do usuário; implementação e revisão seguintes realizadas pelo agente principal. Sem push, tag, release do aplicativo, alteração da main ou dados estáveis. Design & Release Polish congelado.

## Implantado e validado publicamente

- Worker voxy-native-signaling-experimental em **wss://voxy.devbarros.com**. SignalRoom e AdmissionBudget com migrations SQLite v1, WebSocket Hibernation, deployment=true e relay=false. Sem D1/R2/SFU/TURN.
- Wrangler autenticado na conta informada. Changeset do domínio sem conflitos, configuração com override de DNS/origem false. HTTPS/TLS e sessões WSS autenticadas validados. Conta Free confirmada pelo operador; API de billing e listagem DNS recusaram a credencial OAuth. Nenhuma assinatura/upgrade foi acionada.
- Testes públicos de IPC/sessões/P2P, chat/imagens, respostas/reações/busca, renomeação de canal, cargos/presença, amizade/DMs/histórico/leitura, reabertura da UI e identidade estrangeira negada. Malha com três peers, 12 frames Opus sintéticos, isolamento, gate mute e física autoritativa de sinuca por snapshots. Revogação e quatro reconexões.
- Todos os peers públicos estavam nesta máquina. **Sem homologação de duas redes, CGNAT/NAT simétrico, IPv6/firewall ou acústica.** DNS Windows retorna ENOTFOUND para o hostname novo; DNS sobre HTTPS encontra A e TLS verifica o hostname. Override de endereço existe apenas em debug/teste e apenas para esse endpoint; release usa o resolvedor normal, sem IP fixo.
- [Evidência pública](evidence/native-2.0/public/session-integration.json), [infraestrutura](INFRASTRUCTURE.md).

## Funcionalidades integradas

Sessão Rust autônoma/IPC Ed25519, SQLite/DPAPI, voz Opus/SRTP, DSP/mixer, dispositivos, teste privado sem rede, PTT/atalhos combinados/Mouse4/5, mute/deafen/watchdogs/gerações, volumes 0–200%. Interface pode encerrar e reanexar sem perder chamada. Bandeja abrir/mute/deafen/sair, alertas Shell com UI encerrada, DND/tipos/som e preferências de inicialização/protocolo experimental; registro testado em memória, homologação Windows física ainda pendente.

Chat, imagens PNG/JPEG até 3 MiB, respostas/menções/reações, busca/paginação, cargos/presença, notificações privadas e DMs editar/excluir/ler. Endpoint/STUN público padrão dispensam configuração do usuário. Convites gerados usam voxy-native:// e aceitam convites nativos anteriores para compatibilidade. Canal pode ser renomeado pela UI. DMs carregam páginas privadas por conversa de até 100 mensagens/256 KiB; consulta não grava recibos. Leitura em lote até 100 evita encher a fila IPC e reverte integralmente se houver ID não autorizado. Indicador de não lidas recentes na Home. Teste de 205 mensagens com horário igual cobre cursor/privacidade. Home lista todos os recentes e remove entradas sem apagar servidor remoto.

## Implementado parcialmente, sem paridade completa

- Captura WGC/D3D11 de janela própria e H.264 software/RTP-SRTP testados em incrementos anteriores. **Ainda sem iniciar transmissão na UI e assistir remotamente**. Webcam só enumeração; áudio isolado por processo, subscriptions/grade/PiP e aceleração completos pendentes.
- Catálogos originais Lounge/Cinema/Rooftop e renderer wgpu independente com primeiro frame/previews. Mundo interativo, avatar dinâmico/personalização/animações/assentos/multiplayer/TV e voz espacial integrada pendentes.
- Motores Rust de sinuca/Truco/xadrez e autoridade por canal testados; cartas filtradas por jogador/espectador. Mesas físicas/controles/animações/IK/câmeras ainda não integrados.
- Importador em cópia preserva perfil/IDs, servidores com dono, canais/mensagens/respostas/reações, backup/integridade/contagens/rollback e reserva de autores contra apropriação. DPAPI Electron, dados privados/anexos e Local Storage integral pendentes; originais intocados.
- Verificador offline Ed25519/tamanho/hashes/origem/antirollback implementado. Download, aplicação coordenada, recuperação e rollback de instalação pendentes.
- Instalador/ZIP experimental gerados localmente; probes dos executáveis e catálogos passam. Instalação/desinstalação em VM e assinatura Windows pendentes. Workflow manual guarda ZIP como artefato; não publica release nem tag e não foi executado remotamente.
- Perfis foto/capa/emoji completos, DM respostas/reações/inbox offline, chamadas privadas reservadas, busca de configurações, sons de chamada e homologação de hotplug ainda abertos.

## Verificações deste conjunto

74 testes Rust comuns passaram (oito opt-in separados); Clippy com warnings negados passou. Sete testes Worker e tsc passaram. Integrações de sessão local 3/3 e pública 3/3 passaram; sem microfone físico. npm test 83/83 e npm run build passaram, com aviso de chunk Vite preexistente. Oráculos diferenciais existentes preservados. Novas coletas de recursos somente para core ocioso/Home; consultar BENCHMARKS antes de comparar.

Correções descobertas na validação: espera fixa do teste de admissão substituída por snapshot confirmado; teste de histórico não espera um snapshot adicional após consulta sem mutação; processo de probe empacotado passou a usar código de saída confiável; sintaxe /oname do NSIS corrigida. Falhas não foram contadas como aprovação.

Versões npm/lock/Cargo, catálogo completo e saída release/2.0.0 permanecem coerentes. Novidades persistidas por versão; teste legado verifica exibição única e teste Rust preserva reconhecimento após reabrir banco. Nenhuma homologação de atualizador instalado foi presumida.

## Próxima tarefa

Integrar captura/publicação/recepção H.264 ao processo de sessão e à UI com seleção explícita, filas limitadas, preview e liberação. Em seguida áudio WASAPI isolado, webcam e grade. Preservar motores de regras e catálogos; não substituir mundo/jogos por popups. Continuar pelos gates de FEATURE_PARITY.md. Para amigos/dispositivos/redes externas e VM, usar [roteiro de homologação](native/PUBLIC-TESTING.md). Sem conectividade universal, qualidade acústica ou paridade completa declaradas.

## Continuidade após d5ee590 — recuperação de áudio

Recuperação integrada à sessão após falha de captura/saída ou watchdog em chamada ativa. Mute é imposto antes de descartar áudio e invalidar a geração; o host recebe VoiceLeave. Até três tentativas usam a seleção original, com intervalos de 2/4/8 s e timeout de 12 s. Sucesso reentra no canal mantendo mute; exige desmutar explicitamente. Seleção Padrão segue o Windows; seleção nomeada não usa fallback silencioso.

Sair, desconectar, encerrar sessão, iniciar outro canal ou remover o canal invalida a geração e descarta resultados tardios. Falha inicial de abertura não inicia recuperação automática. Timeout cancela explicitamente a geração. Testes lógicos verificam tentativas, seleção e gate, sem homologar dispositivos. Uma chamada de abertura do Windows pode permanecer bloqueada além do timeout; resultados tardios são invalidados e cada ciclo tem limite de três tentativas. Homologação física pendente.

## Interrupção solicitada pelo usuário

Execução encerrada a pedido do usuário após concluir o build, empacotamento e coleta em andamento. Nenhuma nova frente foi iniciada após o pedido. Instalador experimental local e ZIP em release/2.0.0/native-experimental; hashes atualizados em artifacts.json e evidence/native-2.0/public/verification.json. Fluxo de criar/hospedar/entrar por convite disponível, mas sem homologação entre redes e com falha do DNS normal desta máquina registrada. Próxima tarefa funcional permanece integração completa de compartilhamento H.264 na sessão/UI, seguida de áudio isolado e webcam. Relatório consolidado: SESSION-2026-11-17.md.
