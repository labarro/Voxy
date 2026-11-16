# Voxy 2.0.0 — plano de migração nativa

## Stack implementada neste incremento

Rust **1.100.0**, Iced **0.14.0/tiny-skia**, Tokio, Serde, SQLite/rusqlite **0.37**, Ed25519/DPAPI, CPAL **0.18.2**, Opus **0.4.0**, webrtc-rs/rtc **0.21.1** e AEC3 **0.4.0**. Versões transitivas fixadas em Cargo.lock. A escolha Rust para transporte evita embutir navegador e evolui diretamente o código existente; o processamento de voz permanece substituível atrás do adaptador, pois a porta AEC3 é experimental e exige homologação acústica. libwebrtc continua alternativa se os gates de áudio/mídia falharem; não há alegação de qualidade equivalente já aprovada.

UI implementada com materiais próprios e Windows Acrylic opcional, sem loop de animação ociosa. [DESIGN.md](native/DESIGN.md) documenta a nova identidade. Mundo/3D e captura de vídeo ainda não têm implementação nativa escolhida/homologada. Não introduzir Bevy no processo de voz.

Infra mínima implementada: Worker + dois tipos de Durable Object, sem D1/R2/SFU, relay bloqueado e implantação desativada. [PROGRESS.md](PROGRESS.md) é o estado atual das fases e gates; nenhuma fase de rede pública foi considerada concluída pelos testes locais.

Estado em 2026-11-16: implementação incremental em andamento; código 2.0.0 experimental, última distribuição 1.4.1. Branch `migration/2.0-native-audit`, main e dados legados preservados. O quadro abaixo registra a escolha implementada; a pesquisa e os critérios originais seguintes permanecem referência histórica. Não autoriza publicação ou contratação.

## Escopo e evidências

- [AUDIT.md](AUDIT.md): implementação atual, dependências, dados e riscos.
- [FEATURE_PARITY.md](FEATURE_PARITY.md): contrato de preservação rastreável por funcionalidade.
- [ARCHITECTURE.md](ARCHITECTURE.md): desenho proposto e histórico da arquitetura Electron preservado.
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md): cotas, orçamento, domínio e condições para implantação.
- [BENCHMARKS.md](BENCHMARKS.md): resultados medidos e lacunas.
- [PROGRESS.md](PROGRESS.md): checklist, verificações e bloqueadores.

A auditoria cobre módulos, contratos IPC/rede, persistência, recursos e testes do repositório. O índice estático registra arquivos e hashes; não representa revisão de segurança linha a linha nem homologação de todos os comportamentos existentes. As lacunas permanecem abertas, inclusive as da 1.4.1.

## Pesquisa inicial e critérios de validação (histórico da Fase 0)

Rust será a linguagem principal. São proibidos no produto final Electron, navegador embarcado, Chromium de renderização, WebView2, Tauri e processos Node. Ferramentas Node continuam exclusivamente no desenvolvimento da 1.x e, se útil, no serviço de sinalização remoto; não integram o desktop nativo.

Stack candidata prioritária: Rust + Tokio + Serde + SQLite nativo; Iced no desktop; `windows` para Win32/COM; libwebrtc isolada por FFI para mídia; Bevy sob demanda para o mundo. Esta é a escolha para os experimentos, **não uma stack definitivamente homologada**. Fixar versões estáveis e hashes, toolchain MSVC e `Cargo.lock` somente depois dos experimentos. Não utilizar branches `master` como dependências de distribuição. Em particular, as páginas upstream consultadas incluem código em desenvolvimento que não deve ser confundido com release estável.

| Tecnologia | Capacidade e licença upstream | Decisão, limite e teste que falta |
| --- | --- | --- |
| Rust | Código nativo; ecossistema e compilação MSVC | Escolhido para núcleo; verificar SDK, compilador C++, profiling, SBOM e builds reproduzíveis. `cargo`/`rustc` não encontrados no PATH desta sessão. |
| Iced | MIT; runtime nativo, widgets próprios, wgpu/DX12 e fallback tiny-skia; upstream ainda se declara experimental | Primeira candidata à UI. Medir memória, IME, clipboard, acessibilidade/UI Automation, seleção de texto longo, DPI 100/150/200%, múltiplas janelas e vídeo. Não prometer acessibilidade completa antes do spike. [README upstream](https://github.com/iced-rs/iced), [manifesto](https://github.com/iced-rs/iced/blob/master/Cargo.toml). |
| Slint | GPLv3, licença royalty-free com obrigação de atribuição, ou comercial; UI declarativa nativa | Alternativa se Iced não cumprir UI/consumo. Revisar termos exatos da versão, acessibilidade e texturas externas; gratuidade não significa ausência de condições. [Licenças oficiais](https://github.com/slint-ui/slint/blob/master/LICENSE.md). |
| Tokio / Serde | Runtime assíncrono MIT; serialização MIT/Apache-2.0 | Escolhidos conceitualmente, tarefas/canais com limites. Nunca executar I/O, mutex bloqueante ou alocação não limitada no callback de áudio. [Tokio](https://github.com/tokio-rs/tokio), [Serde](https://github.com/serde-rs/serde). |
| SQLite / rusqlite | SQLite em domínio público; wrapper MIT | Substituir sql.js/WASM por banco nativo, single writer, transações e WAL no destino; confirmar licença do wrapper e versão SQLite empacotada. [SQLite](https://sqlite.org/copyright.html), [rusqlite](https://github.com/rusqlite/rusqlite). |
| libwebrtc | PeerConnection, ICE/TURN, DTLS-SRTP, DataChannel, Opus, jitter/congestion control e processamento de áudio; BSD com dependências e avisos próprios | Primeira candidata de mídia pela necessidade de não regredir AEC/recuperação. Biblioteca C++ via fronteira FFI pequena, nunca navegador. Builds Windows, atualização de vulnerabilidades, peso e texturas nativas são riscos. [API nativa](https://webrtc.googlesource.com/src/+/refs/heads/main/docs/native-code/), [licença](https://webrtc.googlesource.com/src/+/refs/heads/main/LICENSE). Não baixar DLL de procedência desconhecida. |
| webrtc-rs / rtc | MIT/Apache-2.0; upstream atual descreve núcleo Sans-I/O e drivers async, inclusive Tokio | Alternativa Rust que merece comparação. Stack de protocolo não substitui automaticamente captura, codecs, AEC, jitter de reprodução e encoders de hardware. Validar a release exata e interop; não rejeitar com base em informação antiga sobre sua arquitetura. [Fonte atual](https://github.com/webrtc-rs/webrtc), [exemplos](https://github.com/webrtc-rs/webrtc/tree/master/examples). |
| CPAL | Apache-2.0; I/O de áudio com backend WASAPI | Candidata para caminho Rust e teste local. Não duplicar captura CPAL e AudioDeviceModule da libwebrtc. Não fornece sozinho codecs, DSP, resampling ou AEC. [Upstream](https://github.com/RustAudio/cpal). |
| Opus | Implementação de referência BSD-3-Clause e concessões de patentes documentadas | Escolhido como codec de voz; ponto inicial 48 kHz mono, frames de 20 ms, bitrate adaptativo, DTX/FEC sob teste. Valores não são desempenho medido. [Licença](https://opus-codec.org/license/). |
| WebRTC Audio Processing / RNNoise | APM integra processamento do WebRTC; RNNoise upstream BSD-3-Clause | AEC precisa referência do áudio realmente reproduzido e delays corretos. Preferir APM do mesmo build de mídia. RNNoise opcional, sem empilhar dois supressores por padrão; licença/origem dos pesos deve ser conferida separadamente. [APM](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/), [RNNoise](https://github.com/xiph/rnnoise). |
| windows-rs | MIT/Apache-2.0; bindings oficiais Windows | Escolhido para DPAPI, atalhos, tray, notificações, WASAPI, captura e Media Foundation; pequenas regiões `unsafe` revisáveis. [Microsoft](https://github.com/microsoft/windows-rs). |
| Bevy / wgpu | Bevy MIT/Apache-2.0, ECS/render/assets; wgpu MIT/Apache-2.0 com backend Windows | Bevy em processo opcional; migrations frequentes de APIs requerem pinning. wgpu sozinho exigiria reconstruir grafo de cena, animação e assets, esforço inadequado como primeira opção. Comparar build mínimo Bevy com renderização direta se memória/TV falharem. [Bevy](https://github.com/bevyengine/bevy), [wgpu](https://github.com/gfx-rs/wgpu). |

Os links foram consultados em 2026-11-16. A avaliação de desempenho acima é hipótese técnica, não benchmark das bibliotecas. Licenciamento de redistribuição será conferido na árvore efetivamente travada; não basta a licença do crate de topo. Assets Kuromi têm titularidade própria e exigem tratamento separado do código MIT.

## Estratégia de migração

1. Manter implementação e distribuição 1.x, perfis e atualizador estável intactos. Mudanças iniciais são documentação e ferramentas de medição.
2. Criar `native/` apenas ao abrir a Fase 1, em workspace Cargo independente, sem mudar o executável padrão da raiz. Versão experimental `2.0.0-alpha.N`, dados em `%APPDATA%/voxy-native-experimental` e appId distinto. O pacote Electron permanece 1.4.1 enquanto não houver atualização distribuível dele.
3. Migrar contratos e regras antes de telas completas; produzir fixtures de entrada/saída do TypeScript para testes diferenciais Rust. Node será oráculo de desenvolvimento, nunca dependência do produto final.
4. Medir core/voz sem UI, UI aberta, UI encerrada e 3D iniciado/encerrado. Comparar com baseline equivalente, incluindo todos os processos nativos.
5. Resolver rede pública para **dados e mídia** antes de investir no restante da interface e 3D. Falha nesta fase impede migração completa.
6. Portar as experiências atuais com referências visuais lado a lado e preservação de assets. Não substituir jogos 3D por popups nem trocar modelos atuais pelos GLB antigos.
7. Migração de dados em cópia verificável; ensaio de atualização Electron → Rust exclusivamente em instalação descartável. Canal estável só após homologação e autorização do usuário.

## Fases e critérios de saída

| Fase | Entrega incremental | Critério verificável para avançar |
| --- | --- | --- |
| 0 — auditoria | Inventário, baseline, arquitetura, pesquisa de custos | Fontes e gaps documentados; medições reproduzíveis; completar baseline multiplayer/PTT/latência/soak ou registrar dependência externa explícita. Decisões de UI/mídia permanecem condicionais. |
| 1 — PoC Rust | Desktop nativo mínimo + core sem GUI + captura/reprodução/Opus + voz entre dois processos + PTT global | Binários MSVC sem Electron/WebView/Node; loopback e dois PCs; microfone físico e headset; mute/deafen seguros; fechar UI não encerra voz; todos os processos medidos; comparar Iced/Slint e caminho de mídia. Nenhuma promessa de paridade nesta fase. |
| 2 — sem VPN | Worker/DO local e depois staging, convites autenticados, DataChannels, ICE/STUN/TURN e reconexão | Chat/anexo/estado/jogos de teste e voz sem IP manual, duas redes reais, CGNAT/NAT simétrico/IPv4/IPv6/firewall UDP bloqueado; relay comprovado por stats; abuso/cotas/expiração/renovação testados. Modelo de custo com corte efetivo validado; se não for possível, fase permanece bloqueada. |
| 3 — comunicação | Identidades, host autoritativo, servidores/canais, mensagens, DMs, amizades/cargos/avisos | Cada linha correspondente em FEATURE_PARITY tem evidência Rust; autoria/ACL/privacidade/replay/rate limit testados; reconexão não duplica ações. |
| 4 — UI e desktop | Launcher, design system, temas, configurações, tray e integrações | Comparação visual 900×640/1024/1600 e DPI; teclado, IME, contraste e movimento reduzido; atalhos Mouse 4/5 em jogo; UI pode encerrar e reabrir sem perder chamada. |
| 5 — mídia | Tela/janela, áudio por processo, câmera, grade, fullscreen e PiP | Testes físicos de áudio de chamada + som de app conhecido; chamada nunca entra no stream de tela; fechamento da fonte, hotplug, múltiplas streams e hardware encode/decode medidos. |
| 6 — mundo | Lounge/Cinema/Rooftop, personagens, animação/IK, assentos/emotes/TV/voz espacial | Paridade visual e funcional de todas as aparências; sem simplificar ambientes; FPS/GPU/memória, TV e fallback; encerrar mundo libera processo e recursos, preservando voz. |
| 7 — jogos | Sinuca Rotação 7, Truco Paulista, xadrez no cenário | Oráculos diferenciais, autoridade host, cartas privadas, espectadores, reconexão, regras e animações verificadas em multiplayer real. |
| 8 — migração/qualidade | Importador, segurança, benchmarks e sessões longas | Cópia/backup/rollback, integridade e contagens; execução ≥8 h e ciclos repetidos sem crescimento não explicado; testes com dispositivos/redes distintas; nenhuma linha obrigatória de paridade pendente. |
| 9 — homologação | NSIS/adaptador de updater Rust, catálogo assinado, Actions e documentação | Instalação/upgrade interrompido/downgrade/tamper testados em VM; notas uma vez; pacote/catálogo/tag alinhados; aprovação explícita de publicação. Só então executar e acompanhar workflow de release. |

## Riscos e respostas

| Risco | Resposta / bloqueador |
| --- | --- |
| TURN necessário em redes restritivas, sem garantia financeira rígida | Nenhum serviço faturável ativado; política em INFRASTRUCTURE. Sem relay gratuito com teto verificável, não prometer conexão universal grátis. |
| FFI libwebrtc pesa ou impede captura eficiente | Experimento comparativo CPAL+webrtc-rs+APM; medir qualidade e recursos antes de escolher definitivamente. |
| UI nativa insuficiente para acessibilidade/vídeo/design | Spike com chat longo, IME, DPI, tema Kuromi e textura de vídeo; Slint como alternativa. Não recorrer a WebView. |
| Perda de geometria procedural/gestos no 3D | Portar algoritmos ou exportar glTF com materiais/rigs; fixtures de medidas/poses e capturas das três salas. |
| Novo protocolo expõe autenticação legada à internet | Não publicar host HTTP atual; identidade assinada e ligação ao fingerprint DTLS. Somente dados autenticados atravessam o plano de controle. |
| 30–80 MB inviáveis com mídia/FFI | Meta aspiracional somada para todos os processos; registrar resultado real. Não retirar AEC/segurança para caber. |
| DPAPI Electron não abre diretamente em Rust | Estudar formato safeStorage e ensaiar leitor compatível somente em cópias; ponte temporária de exportação 1.x apenas se necessária e revisada. UUID sozinho não recupera identidade. |
| Atualização substitui app antes de homologar | Canal experimental separado e rollout estável fechado; preservar appId/caminho final só no ensaio aprovado. |

Dependências externas: toolchain Rust/MSVC/Windows SDK, dispositivos físicos, segundo PC e redes distintas, confirmação das capacidades/condições da conta Cloudflare. Nenhuma delas foi presumida disponível ou concluída.
