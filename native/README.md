# Voxy nativo 2.0.0 — desenvolvimento

Desktop Rust/Iced e processo Rust de sessão. Sem Electron, Chromium, WebView, Tauri ou Node no aplicativo nativo. A 1.4.1 continua estável/publicada; esta versão não foi distribuída e ainda não possui paridade integral.

## Executar

Rust 1.100.0 MSVC x64, Build Tools C++/Windows SDK e CMake foram instalados nesta máquina. Na raiz: npm run native:dev. O script compila o workspace e executa o desktop; voxy-core.exe serve é iniciado sem janela quando necessário. npm run native:test e npm run native:check validam testes/Clippy; npm run native:build compila release. Binários em native/target/release.

Dados em %APPDATA%/voxy-native-experimental ou VOXY_NATIVE_DATA_DIR explicitamente isolado. Nunca usar diretórios da instalação Electron. O empacotador Electron e a publicação estável 2.0 permanecem bloqueados.

## Fluxo utilizável

1. Criar um servidor na Home.
2. A sinalização já usa wss://voxy.devbarros.com por padrão; Configurações → Rede e privacidade e VOXY_SIGNAL_URL são overrides opcionais de desenvolvimento. VOXY_STUN_URLS permite separar URLs STUN por vírgula; padrão stun:stun.cloudflare.com:3478.
3. Abrir o servidor e escolher Hospedar servidor. Copiar o convite para os participantes.
4. O convidado usa Entrar por convite. Não precisa digitar endereço IP ou endpoint.
5. Mensagens, edição/exclusão próprias, canais, solicitações de amizade e DMs são comandos reais do host. Amigos e histórico privado estão vinculados ao servidor/host, não a um diretório global.
6. Selecionar um canal de voz abre captura/saída, DSP e Opus; a confirmação do servidor libera mídia com participantes do mesmo canal. PTT, mute/deafen e volume individual operam no processo de sessão.
7. Fechar a janela preserva a sessão e a chamada. Abrir o executável novamente reanexa a UI. Para sair, usar Sair da chamada/Desconectar. A bandeja oferece abrir/mute/deafen/sair.

O serviço WSS público está disponível. Para exercitar o mesmo fluxo no Worker local: iniciar Wrangler local com VOXY_DEPLOYMENT_ENABLED=true no ambiente de emulação, mantendo relay false. A configuração versionada vem desabilitada para implantação. Não usar serviços pagos. [Requisitos externos](../INFRASTRUCTURE.md).

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

Rede pública/CGNAT/NAT simétrico/IPv6/firewall e fallback TURN seguro financeiramente ainda não foram homologados. TURN é bloqueado no código; a sinalização experimental está implantada. Reconexão tem oito tentativas e recria peers; ICE restart e conexões de sinalização presas ainda exigem testes reais/revisão. Ao esgotar a sessão, o áudio é liberado e a UI mostra o erro. A associação inicial UUID↔chave é TOFU e precisa da revisão/migração de identidade planejada.

AEC3 exige homologação acústica. O teste privado usa NS/AGC/ganho/VAD, sem rede/AEC, requer fones e não pode rodar junto da chamada. Estado completo e lacunas em [PROGRESS](../PROGRESS.md): não confundir backends de captura/codecs e prévias de mundos com transmissão/experiência completa. Chat/imagens/cargos/respostas/reações/histórico/bandeja já têm implementação integrada; perfis completos, DM respostas/reações/inbox offline e chamadas reservadas continuam abertos.

Importador: voxy-core import-legacy <origem-fechada> <destino-vazio>. Executar somente sobre cópias. Faz backup com hashes, converte perfil/IDs, servidores com dono/canais/mensagens/respostas/reações com transação e rollback; dados privados, envelopes Electron e presets LevelDB integrais ainda pendentes. A origem e dados estáveis não são alterados.

[Progresso](../PROGRESS.md) · [Paridade](../FEATURE_PARITY.md) · [Arquitetura](../ARCHITECTURE.md) · [Benchmarks](../BENCHMARKS.md). Deploy experimental autorizado foi executado; nenhuma release ou assinatura do instalador foi publicada.


## Execução contínua — 17/11/2026

Chat conectado: Responder e reagir no menu; Buscar consulta o host, Anteriores pede outra página. Menções usam @{UUID} ou Mencionar no participante. Home mostra notificações do servidor. DMs permitem edição/exclusão próprias e leitura explícita. Administração oferece cargos de identificação e atribuição a membros conectados, sem poderes administrativos novos. Revogar e gerar novo remove convidados atuais após confirmação.

Importação: somente sobre cópia fechada e destino vazio. Converte perfil, servidores com dono, canais, mensagens, respostas e reações; verifica integridade/FKs e contagens. Não reivindica servidores sem dono. Autores legados ficam reservados até migração autenticada. Anexos, DMs, amigos, DPAPI Electron e presets LevelDB continuam no backup, sem alegar conversão. Em erro, reverte a transação e mantém backup; repetir em outro destino vazio.


## Consolidação da retomada

Enviar imagem: no chat conectado ou DM, escolher Enviar imagem, selecionar PNG/JPEG até 3 MiB; o host confirma o arquivo validado. Abrir imagem busca blocos autenticados e mostra a galeria; Esc fecha. Trocar o destino durante o seletor cancela o envio. Transferências têm cancelamento e timeout. As prévias de mundo exigem voxy-world.exe e world-assets; confirmam o primeiro frame, preservam a sessão de voz e são encerradas com a UI. As configurações de áudio incluem NS/AEC/AGC/VAD/sensibilidade e atalhos nativos; o teste privado não usa rede nem AEC e exige fones. Windows oferece início automático/minimizado, fechamento configurável, fullscreen e protocolo experimental separado.

## Estado da execução pública — 17/11/2026

2.0.0 continua em preparação; última distribuição 1.4.1. Worker voxy-native-signaling-experimental implantado em wss://voxy.devbarros.com; SignalRoom e AdmissionBudget SQLite, deployment=true, relay=false, 1.000 admissões/dia e dez salas. Domínio configurado com override de DNS/origem explicitamente false e changeset sem conflitos. Credencial local Wrangler não entra nos artefatos. Não houve push, tag, release, alteração de main ou do protocolo estável.

Testes públicos executam os fluxos reais de sessão (IPC/P2P), imagens, chat/DMs, malha Opus sintética de três peers, canais isolados, revogação e quatro reconexões. Evidência: evidence/native-2.0/public/session-integration.json. Todos os peers estão nesta máquina; não é homologação de redes distintas ou dispositivos. O resolvedor do sistema retorna ENOTFOUND para o novo domínio; DNS sobre HTTPS encontra A e HTTPS/TLS são válidos. Somente o teste debug permite endereço resolvido externamente, mantendo SNI/certificado; release não lê esse override.

Integrado neste conjunto: endpoint público/STUN padrão; convites voxy-native:// com leitura compatível de convites nativos anteriores; renomeação de canal na UI; páginas privadas de DMs com cursor tempo+ID, limites de bytes e sem recibos persistentes; lista/remoção de recentes. Não reimplementados motores de jogos ou catálogos. Compartilhamento/webcam completos, mundo dinâmico, avatares/mesas, migração privada e updater transacional permanecem abertos. Design & Release Polish congelado.

## Recuperação de áudio em chamada ativa

Falha/watchdog força mute, remove temporariamente a associação de voz no host e tenta reabrir a mesma seleção até três vezes (2/4/8 s, timeout de 12 s por tentativa). O retorno exige desmutar explicitamente. Sair/desconectar/remover o canal cancela a geração. Seleção nomeada não troca de microfone; Padrão segue o Windows. Implementação e testes lógicos não homologam hotplug, drivers ou acústica.
