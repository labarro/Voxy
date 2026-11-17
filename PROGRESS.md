# Progresso — Voxy 2.0.0 nativo

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

72 testes Rust comuns passaram (oito opt-in separados); Clippy com warnings negados passou. Sete testes Worker e tsc passaram. Integrações de sessão local 3/3 e pública 3/3 passaram; sem microfone físico. npm test 83/83 e npm run build passaram, com aviso de chunk Vite preexistente. Oráculos diferenciais existentes preservados. Novas coletas de recursos somente para core ocioso/Home; consultar BENCHMARKS antes de comparar.

Correções descobertas na validação: espera fixa do teste de admissão substituída por snapshot confirmado; teste de histórico não espera um snapshot adicional após consulta sem mutação; processo de probe empacotado passou a usar código de saída confiável; sintaxe /oname do NSIS corrigida. Falhas não foram contadas como aprovação.

Versões npm/lock/Cargo, catálogo completo e saída release/2.0.0 permanecem coerentes. Novidades persistidas por versão; teste legado verifica exibição única e teste Rust preserva reconhecimento após reabrir banco. Nenhuma homologação de atualizador instalado foi presumida.

## Próxima tarefa

Integrar captura/publicação/recepção H.264 ao processo de sessão e à UI com seleção explícita, filas limitadas, preview e liberação. Em seguida áudio WASAPI isolado, webcam e grade. Preservar motores de regras e catálogos; não substituir mundo/jogos por popups. Continuar pelos gates de FEATURE_PARITY.md. Para amigos/dispositivos/redes externas e VM, usar [roteiro de homologação](native/PUBLIC-TESTING.md). Sem conectividade universal, qualidade acústica ou paridade completa declaradas.
