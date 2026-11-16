# Voxy nativo 2.0.0 — desenvolvimento experimental

Executáveis Windows x64 compilados em Rust/MSVC. UI Iced/tiny-skia, áudio WASAPI via CPAL, Opus nativo, protocolo webrtc-rs, SQLite nativo e identidade Ed25519/DPAPI. Nenhum navegador, WebView, Electron ou processo Node integra estes executáveis. A versão estável continua sendo **1.4.1**; este incremento ainda não a substitui.

## Executar

Ferramentas necessárias: Rust **1.100.0** com alvo `x86_64-pc-windows-msvc`, Visual Studio C++ Build Tools 2022/Windows SDK e CMake. Foram instaladas nesta máquina durante o desenvolvimento. O script PowerShell atualiza o PATH da execução para encontrar as ferramentas sem depender de reiniciar o terminal.

Na raiz do repositório:

```powershell
npm run native:dev
npm run native:test
npm run native:check
npm run native:build
npm run native:core -- status
```

Ou dentro de `native/`: `cargo run -p voxy-desktop`, `cargo test --locked --workspace` e `cargo build --locked --release --workspace`. Não utilizar o empacotador Electron para gerar um instalador da 2.0; o caminho foi bloqueado até existir instalador nativo homologado.

Binários: `native/target/release/voxy-desktop.exe` e `voxy-core.exe`. Dados próprios em `%APPDATA%/voxy-native-experimental`. Para testes, definir `VOXY_NATIVE_DATA_DIR` para uma pasta descartável. Não apontar para dados da 1.x. Não há migração automática de dados existentes nem alteração de inicialização automática do Windows.

## O que já funciona

- Home, navegação, criação de espaços, canais padrão, chat local persistente e exclusão das próprias mensagens.
- Perfil com rascunho/salvar/desfazer, quatro paletas, vidro escuro em camadas, Acrylic opcional do Windows e modo de efeitos reduzidos.
- Seleção de dispositivos e teste privado de microfone, iniciado somente por ação explícita. Ao parar/sair das configurações, libera captura e saída.
- Núcleo sem GUI com SQLite, chave Ed25519 protegida por DPAPI, sessões canceláveis e host autoritativo para comandos de mensagens/canais/presença de voz.
- Convites assinados com expiração, admissão com prova de posse, SDP/ICE assinados e vinculados à sessão, framing limitado, backpressure, autoria e comandos idempotentes.
- Pipeline de voz independente da UI: captura/reprodução, Opus, gate, PTT global/Mouse 4/5, AEC3/NS/AGC em worker próprio, mixer e buffer de jitter. A integração de chamada completa na UI e a qualidade acústica continuam pendentes.

O teste privado da UI utiliza monitoramento direto e **ainda não usa o novo AEC3**: requer fones e informa isso na tela. O processamento duplex é uma API separada em `voxy-voice::call::CallAudio`. A porta Rust do AEC3 é experimental; os testes sintéticos não autorizam distribuir áudio como equivalente à 1.4.1.

## Testar conectividade sem serviço externo

O serviço em `infra/signaling` é apenas infraestrutura remota de sinalização, não backend Node do desktop. Nenhuma conta Cloudflare ou cartão é necessário para os testes locais:

```powershell
npm ci --prefix infra/signaling --ignore-scripts
npm run check --prefix infra/signaling
npm test --prefix infra/signaling
# Compilar também o core em debug para os testes de dois processos:
cargo build --manifest-path native/Cargo.toml -p voxy-cli
npm run test:native --prefix infra/signaling
npm run test:host --prefix infra/signaling
```

`test:native` troca SDP/ICE assinados pelo emulador e confirma DataChannel nativo. `test:host` inicia dois executáveis Rust com perfis temporários, gera convite, admite o participante, envia mensagem e recebe confirmação do host. O Node/Miniflare existe somente no computador de desenvolvimento para emular a infraestrutura que será remota. Não confundir isso com teste entre provedores ou CGNAT.

O Worker vem com implantação desativada. Para uma execução manual **apenas local**, habilitar `VOXY_DEPLOYMENT_ENABLED` no emulador, mantendo `VOXY_RELAY_ENABLED=false`; nunca mudar a conta para Paid. O CLI aceita:

```text
voxy-core status
voxy-core network-check
voxy-core signaling-check ws://127.0.0.1:8787
voxy-core host ws://127.0.0.1:8787 "Meus amigos" 3600
voxy-core join <convite-gerado-pelo-host> "Mensagem de teste"
voxy-core ptt-check Mouse4
voxy-core audio-probe 5
```

`audio-probe` abre entrada e saída, executa o pipeline e codifica com mute antes do encoder; não grava áudio nem transmite pela rede. Ele verifica acesso às APIs/dispositivos, não qualidade acústica. `ptt-check` não abre o microfone. Convites no CLI ficam visíveis no terminal e nos argumentos do processo convidado; esse caminho é de desenvolvimento, não o fluxo final da GUI. Não copiar convites para relatórios, logs ou issues.

A sondagem release produziu 150 frames em três segundos ([evidência](../evidence/native-2.0/audio-probe.json)). A inicialização de `CallAudio` só retorna sucesso após produzir o primeiro frame; apenas abrir o dispositivo não comprova captura. Underrun/aviso de prioridade recuperáveis não encerram a sessão; invalidação permanente fecha o envio. Não há homologação física de eco, volume, inteligibilidade ou latência.

## Dados legados

`voxy-core import-legacy <origem-1.x-fechada> <destino-nativo-vazio>` faz backup verificado dos arquivos conhecidos e importa inicialmente o perfil, preservando campos desconhecidos. Recusa destino já preenchido. Não converte ainda histórico, cargos, amigos, DMs, credenciais Electron ou seis visuais do Local Storage; o relatório lista essas pendências. Dados originais não são alterados. Use primeiro cópias de teste, nunca a instalação pessoal como laboratório.

## Limites do incremento

Rede pública, CGNAT/NAT simétrico, fallback TURN com corte financeiro, reconexão completa, UI conectada ao host, amigos/DMs/cargos/reação/anexos completos, notificações/tray, vídeo/PiP, salas 3D, jogos e atualização/instalador nativos ainda não estão homologados ou implementados integralmente. `RoomHost` permite presença em canal de voz, mas essa confirmação não comprova recepção de áudio. O host continua confiável e pode ler mensagens; não há alegação de E2EE contra ele.

CI experimental em `.github/workflows/native.yml` testa e compila sem deploy, release ou segredos. Nesta sessão o workflow foi criado, mas não executado no GitHub. [Progresso](../PROGRESS.md), [paridade](../FEATURE_PARITY.md), [infraestrutura](../INFRASTRUCTURE.md) e [benchmarks](../BENCHMARKS.md) distinguem implementação, teste local e homologação.
