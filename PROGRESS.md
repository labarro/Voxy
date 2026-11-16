# Progresso — Voxy 2.0.0 nativo

Atualizado em **2026-11-16**. Código **2.0.0 experimental**, última distribuição **1.4.1**. Trabalho isolado na branch `migration/2.0-native-audit`; main, releases e dados pessoais preservados. Nenhum deploy, plano pago, push, tag ou release nesta execução.

## Validação manual recebida

O usuário informou: **“Os testes físicos da versão atual foram satisfatórios.”** Registro: [evidência](evidence/native-2.0-manual-validation.json). Aplica-se à **1.4.1**, sem inventar aparelhos, redes, duração ou métricas. Não homologa a implementação Rust.

## Implementado e verificado

- [x] Auditoria de 234 arquivos e matriz de paridade; implementação Electron preservada.
- [x] Rust 1.100.0/MSVC x64, Visual Studio C++ Build Tools/SDK e CMake instalados; workspace, lockfile, rustfmt e Clippy.
- [x] Cinco crates: core, rede, voz, CLI e desktop. Executáveis nativos sem navegador ou Node.
- [x] SQLite WAL/transações, perfil/configurações, espaços/canais/mensagens locais, identidade Ed25519 protegida por DPAPI.
- [x] Sessões com geração/cancelamento, comandos autoritativos com autoria e idempotência, limite de participantes e tamanhos de mensagens.
- [x] Convites assinados/expiráveis, prova de posse, sinalização assinada vinculada ao nonce da admissão, filas limitadas, framing com integridade.
- [x] ICE/DTLS/SCTP e Opus/SRTP nativos; teste de dados e mídia sintética por UDP entre peers locais.
- [x] Worker/Durable Objects com WebSocket hibernável, quotas de admissões/salas, proteção contra replay e implantação desativada. Dois processos Rust trocaram mensagem autoritativa usando o emulador local.
- [x] CPAL/WASAPI, seleção de dispositivos, Opus 48 kHz/20 ms, gate/limiter, mute/deafen, PTT global incluindo Mouse 4/5, mixer por participante e jitter buffer limitados.
- [x] Adaptador AEC3/NS/AGC experimental, referência da saída real e DSP fora do callback. Qualidade física ainda pendente.
- [x] Sondagem real de APIs de áudio: 150 frames em 3 s, captura/saída abertas, mute antes do encoder, sem gravação ou rede. Corrigido erro que tornava um underrun inicial fatal; teste de regressão incluído.
- [x] Iced/tiny-skia: nova Home editorial, navegação, chat local, criação de espaço, perfil/configurações, novidades e quatro paletas. Materiais glass escuros, reflexos, bordas, estados de foco/hover, Acrylic por janela e efeitos reduzidos. [Design](native/DESIGN.md).
- [x] Nove capturas produzidas pelo próprio renderer, incluindo 900×640 e Kuromi; [relatório](evidence/native-2.0/ui/ui-smoke.json). Automação externa da janela foi recusada pela ferramenta; não são testes de cliques humanos/acessibilidade.
- [x] Importador inicial em cópia: backup com hashes por streaming, destino vazio/isolado, perfil e campos desconhecidos preservados. Outros formatos ainda arquivados sem conversão.
- [x] Medição release de core/Home/Home minimizada com árvore de processos e dados brutos; não são benchmarks de chamada ou de paridade integral.
- [x] README, notas experimentais e versões sincronizados em 2.0.0. Empacotamento/publicação Electron 2.0 bloqueados por `nativeReady=false`.
- [x] Workflow nativo sem publicação/deploy criado; ainda não executado no GitHub.

## Estado das fases e bloqueadores reais

| Fase | Estado / pendências para aceite |
| --- | --- |
| 0 — Auditoria | Inventário e baseline exploratória feitos; confirmação manual 1.4.1 registrada. Comparações empacotadas equivalentes e medições completas de chamadas continuam pendentes. |
| 1 — Nativo/voz | Código e testes locais implementados. Faltam chamada entre usuários, avaliação acústica, hotplug, latência real e PTT com jogos em foco. |
| 2 — Sem VPN | Transporte nativo e host/chat por convite verificados localmente. **Não aprovada:** implantação/domínio/conta, internet entre provedores, CGNAT/NAT simétrico/IPv6/firewall, TURN seguro financeiramente e reconexão completa. |
| 3 — Comunicação | Autoridade/persistência e fluxo de mensagem nativo implementados parcialmente. UI ainda usa chat local; faltam integração de sessão remota, DMs/amigos/cargos/reação/anexos e paridade. |
| 4 — UI/Windows | Nova direção visual implementada nas telas existentes. Faltam mini perfis, menus/notificações, tray, autostart, IME/DPI/acessibilidade e encerramento da UI com chamada preservada. |
| 5 — Multimídia | Pendente: WGC, áudio por processo isolado, webcam, codecs de hardware, grade/PiP. |
| 6 — Mundo | Pendente: salas completas, avatares procedurais, animações/IK, interação, TV, lifecycle GPU. Assets e fontes 1.x preservados. |
| 7 — Jogos | Pendente: sinuca/Truco/xadrez completos no cenário e sincronização autoritativa. |
| 8 — Migração/qualidade | Perfil inicial e backups testados; formatos restantes, segurança/CVEs/licenças, fuzzing, soak e paridade completos pendentes. |
| 9 — Distribuição | Instalador/updater assinado Rust, transição/rollback e homologação pendentes. Publicação exige autorização explícita. |

Não se consideram as fases posteriores aprovadas: tarefas locais independentes avançaram enquanto os gates físicos/externos permanecem abertos. TURN está efetivamente bloqueado; STUN/P2P direto não garantem a experiência em todas as redes. Sem corte financeiro verificável, não habilitar relay nem prometer custo zero universal.

## Verificações

- Legado: `npm test` **83/83** e `npm run build` passaram; aviso existente de chunk grande no Vite.
- Rust: **19/19 testes passaram**, incluindo identidade/DPAPI, dados, migração, autorização/idempotência, convites/replay, framing, gate/resampling/Opus/DSP e transporte SRTP. `cargo fmt`, Clippy com `-D warnings` e build release passaram.
- Infra local: TypeScript, **3/3 testes** de admissão/quotas/replay/nonce de sessão e integrações nativo + host passaram. Auditoria npm da infraestrutura sem vulnerabilidades conhecidas na execução.
- Binário release: [sondagem de áudio](evidence/native-2.0/audio-probe.json) com 150 frames em 3 s, sem falha de dispositivo; a inicialização do duplex só confirma prontidão após produzir o primeiro frame. Um evento recuperável foi observado e não interrompeu o fluxo.
- Os bloqueios de empacotamento Electron e publicação estável foram exercitados e recusaram a distribuição experimental antes de gerar artefatos.
- [Verificação consolidada e hashes dos binários](evidence/native-2.0/verification.json); [inspeção do processo nativo](evidence/native-2.0/runtime-boundary.json) confirmou renderer pronto, nenhum processo filho e nenhum módulo de Electron/Chromium/WebView/Node na execução observada.
- Memória em repouso: Home **29,6 MiB**, Home minimizada **23,6 MiB** de working set médio; escopo e private bytes em [BENCHMARKS.md](BENCHMARKS.md). Não equivale à meta de chamada 30–80 MB.

## Próximos gates

Integrar a sessão remota e o duplex de voz à UI com cancelamento/timeout; revisar identidade/permissões e reconexão; habilitar teste público somente com conta/domínio seguros e custo fechado; validar redes e áudio fisicamente. Não reduzir o escopo 3D/jogos para alegar paridade.
