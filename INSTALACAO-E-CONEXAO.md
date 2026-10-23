# Voxy — instalação e conexão com os amigos

Versão atual: **0.7.0**. Para atualizar sem apagar dados, siga [GUIA-DE-ATUALIZACAO.md](GUIA-DE-ATUALIZACAO.md). Não desinstale a versão anterior. Depois desta atualização, as futuras podem ser iniciadas pela seção **Atualizações** da engrenagem.

**Atualize o host e todos os amigos para 0.7.0** para usar os recursos novos. Versões até 0.3.0 são incompatíveis com a trilha de webcam. Dentro da chamada, **Ativar câmera** permite escolher a fonte; **Trocar câmera** e **Desligar câmera** preservam voz e tela. As webcams podem ser ampliadas em fullscreen. Resolução alvo: até 720p/30, conforme câmera e conexão. O áudio continua vindo do microfone.

No menu **… → Gerenciar servidor e canais**, somente o criador pode gerenciar a imagem do servidor. Para servidores antigos sem criador registrado, o host assume essa função na migração. A imagem aparece na barra lateral e na Home.

O botão **Home** mostra os servidores recentes e permite reconectar sem colar o convite. A lista continua disponível sem Radmin e após reiniciar. Convites são protegidos pelo Windows; remover o recente não remove o servidor do host. Para uma sala própria, **Hospedar novamente** usa o endereço e a porta salvos; se o IP mudou, hospede manualmente e compartilhe um novo convite. A disponibilidade é uma verificação momentânea, não garantia de acesso futuro.

O megafone **Novidades do Voxy** abre o canal oficial, mesmo desconectado, com versões, datas, funcionalidades, melhorias e correções. O conteúdo está incluído no aplicativo e recebe novas publicações quando você instala uma versão nova.

Novidades: na engrenagem, clique em **alterar tecla**, pressione a tecla desejada e salve para configurar o Push-to-Talk. Ajuste **Volume de entrada**, ative a **detecção de voz** e ajuste o limite acima do ruído ambiente usando o medidor durante a chamada. −70 dBFS é mais sensível; −10 dBFS exige sons mais fortes. O filtro vem desligado por padrão e não distingue voz de outros sons fortes. As mensagens próprias têm botões para editar/excluir. No fullscreen, a HUD some após 2,5 segundos e reaparece ao mover o mouse. Iniciar transmissão toca um aviso para o canal; desligue os sons nas configurações se preferir.

Na engrenagem, **Escolher foto do computador** permite selecionar PNG/JPEG/WebP de até 5 MB, com prévia de recorte central e miniatura de 128 px. Salve para aplicar ou escolha um emoji para remover a foto. Todos devem usar a versão 0.4.0 para ver fotos. O clique direito em uma pessoa oferece **Mutar voz para mim**; só você deixa de ouvir essa voz, mantendo o volume da transmissão separado. Fone cortado indica áudio silenciado; o selo vermelho **AO VIVO** indica transmissão ativa.

Na versão 0.4.0, a engrenagem também permite escolher Push to Talk, tecla para falar, avatar 👴 e sons de entrada/saída. Volumes das vozes ficam nos cartões; o áudio da transmissão tem controle próprio no player. No chat, use **Enviar imagem** para PNG/JPEG/WebP de até 2 MB. A primeira abertura apresenta as novidades apenas uma vez por versão.

## 1. Qual arquivo instalar e enviar

Baixe o [instalador oficial 0.7.0](https://github.com/labarro/Voxy/releases/download/v0.7.0/Voxy-Setup-0.7.0-x64.exe). Se empacotar localmente, a pasta de saída será:

```text
C:\projects\Voxy\release\0.7.0
```

O arquivo que você deve instalar no seu computador e enviar aos amigos é:

```text
Voxy-Setup-0.7.0-x64.exe
```

Caminho completo ao empacotar localmente:

```text
C:\projects\Voxy\release\0.7.0\Voxy-Setup-0.7.0-x64.exe
```

**Envie somente esse instalador aos amigos.** Não é necessário enviar o código do projeto, a pasta `node_modules`, arquivos `.blockmap`, nem as pastas `build-*` ou `win-unpacked`. Não use o instalador antigo da versão 0.1.0.

O mesmo instalador serve para quem vai hospedar e para quem vai entrar na sala. O Voxy aceita até **dez pessoas no total: você e mais nove amigos**.

## 2. Instalar o Voxy

Cada pessoa deve seguir estes passos no próprio computador Windows 10/11 de 64 bits:

1. Salve o arquivo `Voxy-Setup-0.7.0-x64.exe` em uma pasta do computador.
2. Abra o instalador com dois cliques.
3. Escolha a pasta de instalação e conclua o assistente.
4. Abra o Voxy pelo atalho criado ou pelo menu Iniciar.
5. Clique na engrenagem para definir seu nome, avatar e dispositivos de áudio. Salve as configurações.

Não é necessário instalar Node.js nem executar comandos de desenvolvimento.

O aplicativo ainda não possui assinatura digital. O Windows pode mostrar um aviso de editor desconhecido. Confira se o arquivo veio de você ou de alguém de confiança antes de permitir a execução; não é necessário desativar o antivírus.

## 3. Instalar e configurar o Radmin VPN

Todos precisam instalar o **Radmin VPN**, que é separado do Voxy:

https://www.radmin-vpn.com/

Não é necessário instalar Radmin Server nem Radmin Viewer para usar o Voxy.

### No seu computador

1. Instale e abra o Radmin VPN.
2. Use a opção de criar uma rede.
3. Escolha um nome para a rede e uma senha.
4. Envie o nome e a senha dessa rede aos amigos por uma conversa privada.
5. Anote o endereço IP que o Radmin exibe para o seu computador. Ele normalmente começa com `26.`.

### Nos computadores dos amigos

1. Instalem e abram o Radmin VPN.
2. Usem a opção de entrar em uma rede existente.
3. Informem o nome e a senha da rede que você criou.
4. Confirmem que você e os demais aparecem conectados no Radmin.

Mantenham o Radmin VPN aberto e conectado enquanto usam o Voxy. A senha da rede Radmin e o convite do Voxy são autorizações diferentes: seus amigos precisam dos dois.

## 4. Hospedar a sala no Voxy

Somente uma pessoa precisa hospedar a sala. Essa pessoa deve permanecer com o computador ligado, o Voxy aberto e o Radmin conectado.

1. Abra o Voxy.
2. Clique em **Hospedar sala**.
3. Informe o nome do servidor, se solicitado.
4. Em **Endereço de escuta**, selecione seu IP do Radmin VPN, começando com `26.`. Confirme que é o mesmo endereço exibido no Radmin.
5. Mantenha a porta padrão **43120**, a menos que ela esteja ocupada.
6. Clique em **Criar sala / Hospedar servidor**.
7. Clique em **Copiar convite**.
8. Envie o convite completo aos amigos por uma conversa privada.

**Não escolha `127.0.0.1` para conectar seus amigos.** Esse endereço funciona somente no próprio computador.

O convite tem este formato:

```text
voxy://26.12.34.56:43120/segredo
```

O exemplo acima é apenas ilustrativo. Use o convite gerado pelo aplicativo, que contém um segredo maior. Não remova nem altere nenhuma parte dele. Quem receber o convite pode entrar na sua sala enquanto ele for válido.

Se o endereço do Radmin não aparecer, confira se a VPN está conectada e reabra a janela de hospedagem. O Voxy identifica a interface pelo nome contendo `Radmin`; se o adaptador foi renomeado, restaure um nome contendo essa palavra.

## 5. Os amigos entram na sala

Cada amigo deve:

1. Confirmar que está conectado à sua rede no Radmin VPN.
2. Abrir o Voxy.
3. Clicar em **Entrar em sala**.
4. Informar seu nome.
5. Colar o convite completo que você enviou.
6. Clicar em **Conectar à sala**.

O convite deve ser colado dentro do Voxy. Não é necessário abri-lo no navegador.

## 6. Conversar por voz

1. Todos clicam no mesmo canal de voz, como **Sala dos amigos**.
2. Permitam o acesso ao microfone quando solicitado.
3. Confiram se os participantes aparecem no canal.
4. Usem o botão de microfone para mutar ou desmutar.
5. Usem o botão de fones para silenciar ou restaurar o áudio recebido.
6. Para trocar microfone ou saída de áudio, abram a engrenagem, escolham os dispositivos e salvem.

O host pode criar outros canais pelo botão **+** na categoria de voz. Pessoas em canais de voz diferentes não recebem a mídia umas das outras.

## 7. Compartilhar e assistir à tela

### Quem transmite

1. Entre no canal de voz dos amigos.
2. Clique em **Compartilhar tela**.
3. Escolha o monitor ou a janela desejada.
4. Comece com **720p / 30 FPS**.
5. Deixe o áudio do sistema desligado no primeiro teste.
6. Clique em **Iniciar transmissão**.

### Quem assiste

1. Entre no mesmo canal de voz de quem está transmitindo.
2. Clique em **Assistir à tela** no participante.
3. Continue conversando normalmente enquanto assiste.

Fechar a visualização não sai da voz. Quem transmite pode clicar em **Parar transmissão** e iniciar outra depois, sem encerrar a conversa.

Com dez pessoas, quem compartilha envia uma cópia da tela para cada um dos nove espectadores. Se houver travamento, reduza para **720p / 15 FPS** e evite várias transmissões simultâneas durante o diagnóstico.

O áudio do sistema é opcional e pode recapturar as vozes dos amigos, causando eco. Se isso acontecer, desmarque essa opção e reinicie a transmissão.

## 8. Se não conectar ou não houver áudio/vídeo

1. Verifiquem se todos aparecem online na mesma rede Radmin.
2. Confirmem que o host está com o Voxy aberto e hospedando no IP `26.x.x.x`, e não em `127.0.0.1`.
3. Copiem novamente o convite completo.
4. Confirmem que todos estão no mesmo canal de voz.
5. Confiram os dispositivos selecionados, mute e silenciar áudio.
6. No Windows, verifiquem se o acesso ao microfone está permitido para aplicativos da área de trabalho.
7. Se necessário, configurem o Firewall do Windows para permitir o Voxy na interface Radmin, restrito aos IPs dos amigos. A sinalização usa TCP na porta escolhida; a mídia usa UDP em portas dinâmicas. Não desativem o firewall inteiro.
8. Abram o diagnóstico pelo ícone de rede do Voxy para conferir o estado da conexão e do ICE.
9. Depois de uma queda e reconexão, entrem novamente no canal de voz e reiniciem a transmissão, se necessário.

Não é necessário abrir portas públicas no roteador. A prévia da própria tela não comprova que os amigos a receberam: confirmem a imagem no computador de um espectador.

## 9. Encerrar

- Para sair apenas da voz, clique no botão de encerrar chamada.
- Para sair da sala, use o botão de desconectar.
- Se o host fechar o Voxy ou desligar o computador, a sala é encerrada para todos.
- Para usar novamente, o host abre o Voxy, hospeda a sala e envia o convite. Seus servidores, canais e histórico ficam salvos no computador do host.

## Estado da validação

A versão 0.4.0 passou nos testes locais com dez clientes WebRTC e nove espectadores. O executável empacotado também é verificado. A conexão entre computadores físicos pelo Radmin VPN ainda precisa ser validada pelo grupo.

## Próximas versões

A 0.4.0 inclui o atualizador remoto. O canal já está configurado: novas versões são verificadas e baixadas automaticamente. Clique em **Reiniciar e atualizar** quando puder encerrar a chamada. Não desinstale o aplicativo. O instalador manual permanece como alternativa. Veja [GUIA-DE-ATUALIZACAO.md](GUIA-DE-ATUALIZACAO.md) para usuários e [ATUALIZACOES-REMOTAS.md](ATUALIZACOES-REMOTAS.md) para configurar publicação e domínio.

## Conversas e presença na 0.7.0

O instalador está na [release publicada 0.7.0](https://github.com/labarro/Voxy/releases/tag/v0.7.0); ao gerar localmente, fica em `C:\projects\Voxy\release\0.7.0\Voxy-Setup-0.7.0-x64.exe`. Instale sobre a versão existente, sem desinstalar. Atualize o host e os interlocutores para compartilhar presença e usar DMs. A barra esquerda agora mantém também os servidores salvos/offline. Veja o passo a passo de [status e mensagens privadas](CONVERSAS-E-STATUS.md).
