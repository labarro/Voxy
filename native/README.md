# Voxy nativo 2.0.0 — desenvolvimento

Desktop Rust/Iced e processo Rust de sessão. Sem Electron, Chromium, WebView, Tauri ou Node no aplicativo nativo. A 1.4.1 continua estável/publicada; esta versão não foi distribuída e ainda não possui paridade integral.

## Executar

Rust 1.100.0 MSVC x64, Build Tools C++/Windows SDK e CMake foram instalados nesta máquina. Na raiz: npm run native:dev. O script compila o workspace e executa o desktop; voxy-core.exe serve é iniciado sem janela quando necessário. npm run native:test e npm run native:check validam testes/Clippy; npm run native:build compila release. Binários em native/target/release.

Dados em %APPDATA%/voxy-native-experimental ou VOXY_NATIVE_DATA_DIR explicitamente isolado. Nunca usar diretórios da instalação Electron. O empacotador Electron e a publicação estável 2.0 permanecem bloqueados.

## Fluxo utilizável

1. Criar um servidor na Home.
2. Configurar sinalização WSS em Configurações → Rede e privacidade, ou definir VOXY_SIGNAL_URL antes de iniciar. VOXY_STUN_URLS permite separar URLs STUN por vírgula; padrão stun:stun.cloudflare.com:3478.
3. Abrir o servidor e escolher Hospedar servidor. Copiar o convite para os participantes.
4. O convidado usa Entrar por convite. Não precisa digitar endereço IP ou endpoint.
5. Mensagens, edição/exclusão próprias, canais, solicitações de amizade e DMs são comandos reais do host. Amigos e histórico privado estão vinculados ao servidor/host, não a um diretório global.
6. Selecionar um canal de voz abre captura/saída, DSP e Opus; a confirmação do servidor libera mídia com participantes do mesmo canal. PTT, mute/deafen e volume individual operam no processo de sessão.
7. Fechar a janela preserva a sessão e a chamada. Abrir o executável novamente reanexa a UI. Para sair, usar Sair da chamada/Desconectar. A bandeja ainda não foi migrada.

Sem um serviço WSS implantado pelo administrador, o fluxo completo pode ser exercitado usando o Worker local: iniciar Wrangler local com VOXY_DEPLOYMENT_ENABLED=true no ambiente de emulação, mantendo relay false. A configuração versionada vem desabilitada para implantação. Não usar serviços pagos. [Requisitos externos](../INFRASTRUCTURE.md).

## Testes

~~~powershell
npm ci --prefix infra/signaling --ignore-scripts
npm run check --prefix infra/signaling
npm test --prefix infra/signaling
npm run test:native --prefix infra/signaling
npm run test:host --prefix infra/signaling
npm run test:session --prefix infra/signaling
~~~

Os testes de sessão iniciam emulador e processos Rust isolados, verificam IPC autenticado, host/chat, reanexação da UI e malha Opus com isolamento de canais. São marcados como ignorados nos testes Cargo comuns e executados explicitamente pelo script do emulador. Node existe somente nas ferramentas de desenvolvimento e no emulador, não no desktop ou núcleo distribuído.

O teste adicional de dispositivos requer **VOXY_TEST_PHYSICAL_AUDIO=1**. Abre as APIs de entrada/saída padrão e troca Opus/SRTP entre dois processos na mesma máquina, com volume de reprodução remoto zero para evitar retorno; confirma codificação, decodificação, callbacks de saída e continuidade após descarregar os clientes UI. Não grava áudio, não usa rede pública e não certifica eco/inteligibilidade/volume/latência acústica. VOXY_TEST_CORE_BINARY aponta opcionalmente para o executável release ao medir recursos. VOXY_TEST_ONLY_AUDIO=1 isola esse cenário.

## Revisão visual

O renderer possui --smoke-dir <pasta-evidências>, somente com VOXY_NATIVE_DATA_DIR explícito e vazio. Esse modo semeia fixtures claramente identificadas e desativa o bridge de sessão; **não abre microfone nem rede**. Consulta bounds reais de avatares/sidebar/caption e gera capturas de Home, chat, participantes, configurações, temas, administração, DM e modais em 1240×820 e 900×640. A execução normal nunca semeia esses dados.

O redesign não foi aprovado pelo usuário. [Design system](../DESIGN-SYSTEM.md) e [evidências atuais](../evidence/native-2.0/liquid-glass-reviewed/ui-smoke.json). Captura interna não é teste de cliques humanos, de acessibilidade ou de DPI físico.

## Limitações abertas

Rede pública/CGNAT/NAT simétrico/IPv6/firewall e fallback TURN seguro financeiramente ainda não foram homologados. TURN é bloqueado no código e a implantação permanece desativada. Reconexão tem oito tentativas e recria peers; ICE restart e conexões de sinalização presas ainda exigem testes reais/revisão. Ao esgotar a sessão, o áudio é liberado e a UI mostra o erro. A associação inicial UUID↔chave é TOFU e precisa da revisão/migração de identidade planejada.

AEC3 é uma porta Rust experimental; libwebrtc segue alternativa se não passar na homologação. Teste privado local continua sem AEC, requer fones e não pode rodar junto da chamada. Hotplug, sons/atalhos completos, chamada privada reservada, cargos, imagens, respostas/reações, paginação/busca remotas completas, status/perfis completos, não lidas/notificações/DND, tray/autostart, vídeo/PiP, salas 3D, jogos, instalador/updater e migração integral ainda pendentes.

Importador: voxy-core import-legacy <origem-fechada> <destino-vazio>. Executar somente sobre cópias. Faz backup com hashes e converte inicialmente o perfil, preservando campos desconhecidos; não converte ainda todo o SQLite, envelopes Electron e presets LevelDB. A origem e dados estáveis não são alterados.

[Progresso](../PROGRESS.md) · [Paridade](../FEATURE_PARITY.md) · [Arquitetura](../ARCHITECTURE.md) · [Benchmarks](../BENCHMARKS.md). Nenhum deploy/release/assinatura do instalador foi executado.


## Execução contínua — 17/11/2026

Chat conectado: Responder e reagir no menu; Buscar consulta o host, Anteriores pede outra página. Menções usam @{UUID} ou Mencionar no participante. Home mostra notificações do servidor. DMs permitem edição/exclusão próprias e leitura explícita. Administração oferece cargos de identificação e atribuição a membros conectados, sem poderes administrativos novos. Revogar e gerar novo remove convidados atuais após confirmação.

Importação: somente sobre cópia fechada e destino vazio. Converte perfil, servidores com dono, canais, mensagens, respostas e reações; verifica integridade/FKs e contagens. Não reivindica servidores sem dono. Autores legados ficam reservados até migração autenticada. Anexos, DMs, amigos, DPAPI Electron e presets LevelDB continuam no backup, sem alegar conversão. Em erro, reverte a transação e mantém backup; repetir em outro destino vazio.
