# Homologação experimental 2.0.0

Última versão estável: 1.4.1. Este roteiro testa o aplicativo nativo experimental em diretórios separados. Não substitua a instalação estável e não importe os dados originais. Não existe promessa de conectividade universal: TURN permanece desligado.

## Instalação e comunicação

1. Use o instalador local `release/2.0.0/native-experimental/Voxy-Native-Experimental-Setup-2.0.0-win-x64.exe` quando gerado, ou o ZIP desse diretório. Confira o SHA-256 em `artifacts.json`. O pacote experimental não tem assinatura Authenticode; sua procedência precisa ser conferida diretamente com o operador. Instalação/desinstalação em VM ainda precisam de homologação.
2. Instale em dois computadores, preferencialmente em provedores distintos. O destino é `%LOCALAPPDATA%/Programs/VoxyNativeExperimental`; dados em `%APPDATA%/voxy-native-experimental`. Confirme que a 1.4.1 abre e conserva seus dados.
3. No primeiro, crie um servidor e escolha **Hospedar**. O endpoint padrão é `wss://voxy.devbarros.com`; não configure IP, Radmin ou portas. Copie o convite `voxy-native://join/…` e compartilhe somente com os participantes.
4. No segundo, use **Entrar por convite**. Registre a etapa e o erro mostrado se falhar. Sinalização conectada não comprova que a rota P2P abriu.
5. Envie texto nos dois sentidos, responda, reaja, busque mensagens e carregue páginas anteriores. Envie PNG/JPEG; confira a imagem do outro lado. Troque de conversa durante o seletor e confirme cancelamento seguro.
6. Envie solicitação de amizade pelo ID, aceite e teste DM, imagem, edição/exclusão próprias, leitura e **Mensagens anteriores/Recentes**. A conta do host mantém o histórico; não há diretório global nem inbox offline completo.
7. O dono deve conseguir renomear um canal; convidados devem ter alterações administrativas recusadas. Em outro canal, confirme isolamento de voz.
8. Em um canal de voz, teste primeiro mute/deafen, depois libere o microfone e converse com headset. Teste PTT, Mouse 4/5 e combinações durante um jogo, volumes individuais, ruído e eco. Nunca certifique acústica por teste sintético ou reprodução em zero.
9. Feche completamente a interface, conserve a chamada e reabra o aplicativo. A UI deve recuperar a mesma sessão. Teste abrir/mute/deafen/sair pela bandeja. Encerrar tudo deve liberar microfone e processos.
10. Interrompa e restaure a rede. Verifique reconexão, histórico e ausência de mensagens duplicadas. Revogue o convite no host: conexões anteriores devem cair e o convite antigo deve ser recusado; compartilhe o novo para reconectar.
11. Desconecte um servidor salvo e use **Remover salvo**. Isso não deve excluir dados ou histórico no computador do dono. Sem o convite, a reconexão exige recebê-lo novamente.

## Matriz externa a preencher

| Rede/caso | Estado atual | Registrar |
| --- | --- | --- |
| Mesmo computador → WSS público | Testado automaticamente com chat/imagens/voz sintética | Evidência pública no repositório; DNS via HTTPS no teste |
| Dois PCs na mesma LAN | Pendente | Versões, conexão/voz, perdas e tempo |
| Dois provedores IPv4 | Pendente | Rota direta, reconexão e permissões |
| IPv6 e dual-stack | Pendente | DNS A/AAAA, rota escolhida e falhas |
| CGNAT/NAT simétrico | Pendente | Se conectou diretamente ou falhou |
| UDP bloqueado/firewall restritivo | Pendente | Diagnóstico claro; nenhum relay pago |
| Hotplug e troca de dispositivos | Pendente físico | Captura/saída recuperadas, gate mute preservado |
| Suspender/retomar e sessão ≥8 h | Pendente | Áudio, reconexão, memória/handles/processos |
| Instalar/desinstalar/reinstalar em VM | Pendente | Atalhos, diretórios, dados e 1.4.1 preservados |

Não compartilhar convites, chaves, perfil, SDP ou logs brutos com IPs. Relate versão, etapa, horário, mensagem de erro e se o host permaneceu disponível. O teste público automatizado não captura microfone nem comprova outras redes. O resolvedor Windows desta máquina não encontrou o hostname novo; o teste resolveu por HTTPS e verificou TLS com o hostname original. O executável release usa DNS normal do sistema. Não desative a validação TLS para contornar falhas.

## Funcionalidades que ainda não devem ser homologadas como completas

Captura WGC/H.264 e catálogos 3D possuem componentes reais, mas compartilhamento, webcam, áudio por processo, grade/PiP, mundo multiplayer, avatares e mesas físicas dos jogos ainda não possuem o fluxo completo exigido. Não use prévias estáticas como teste dessas experiências. Migração privada e instalação automática/rollback de updates também continuam pendentes. Teste somente as funcionalidades realmente disponíveis e registre as demais separadamente.
