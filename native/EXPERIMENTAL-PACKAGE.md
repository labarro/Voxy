# Voxy Native Experimental 2.0.0

Pacote local de testes, sem publicação e sem assinatura Authenticode. A versão estável continua sendo a 1.4.1. Confira o SHA-256 do instalador/ZIP em `artifacts.json`, recebido diretamente do operador.

Execute `voxy-desktop.exe`, crie um servidor e escolha **Hospedar**. Compartilhe o convite **voxy-native://join/**; os amigos usam **Entrar por convite**. A sinalização já usa **wss://voxy.devbarros.com** e STUN, sem configurar IP, VPN ou portas. O host deve permanecer ligado. TURN está desativado; redes restritivas podem impedir a conexão direta e mostrar erro.

Disponível: chat/imagens, canais, amizades/DMs/histórico, notificações do host, voz Opus/SRTP, dispositivos, PTT/mute/deafen e volumes individuais. Fechar a interface conserva a sessão; reabrir recupera a chamada. Use a bandeja para encerrar tudo. Configurações e dados experimentais são separados da versão estável.

O instalador usa somente `%LOCALAPPDATA%/Programs/VoxyNativeExperimental`; os dados ficam em `%APPDATA%/voxy-native-experimental`. Não aponte `VOXY_NATIVE_DATA_DIR` para dados da versão estável e não copie seus bancos para cá. A desinstalação experimental conserva os dados. O instalador não registra `voxy://` nem modifica a instalação 1.4.1.

Compartilhamento, webcam, áudio de aplicativo, grade/PiP, mundo 3D multiplayer, avatares e mesas dos jogos ainda não estão completos. Prévias de ambientes e backends de mídia não equivalem a essas funcionalidades. O atualizador ainda não aplica pacotes. Homologação em redes diferentes, acústica, hotplug, instalação/desinstalação em VM e sessão prolongada continuam pendentes.

Siga `PUBLIC-TESTING.md` para o teste com amigos. Não envie convites, dados pessoais ou logs brutos ao relatar erros; informe versão, etapa, horário e a mensagem exibida. Não desative TLS ou habilite relay pago para contornar falhas.
