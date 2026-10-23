# Áudio e reconexão — Voxy 0.6.0

## Ajustar e testar o microfone

1. Abra **Configurações → Áudio e Voz** pela engrenagem. Funciona antes de entrar em uma sala.
2. Escolha o microfone e a saída de áudio. Ative **Supressão de ruído** e **Cancelamento de eco** conforme sua necessidade; ambos ficam ativados por padrão para perfis antigos.
3. Use fones e clique em **Testar meu microfone**. A voz processada é reproduzida somente no seu computador. Durante uma chamada, o envio do microfone fica pausado até parar o teste ou fechar as configurações. Tela e webcam não são interrompidas.
4. Ajuste o volume de entrada e, se desejar, a detecção por sensibilidade. O medidor mostra o nível anterior ao ganho; aumentar o volume não abre o filtro para ruídos que estavam abaixo do limite. O teste ignora o Push-to-Talk, mas aplica ganho, ruído, eco e sensibilidade.
5. Clique em **Parar teste** e **Salvar perfil e dispositivos**. Os ajustes permanecem após reiniciar e são aplicados à track enviada aos amigos, sem reiniciar a chamada.

O teste permite experimentar valores ainda não salvos. Fechá-lo ou mudar de categoria libera a captura e restaura seu mute/PTT anterior. Negar a permissão ou perder o dispositivo exibe um erro; escolha uma entrada disponível e teste novamente. O suporte e a eficácia do processamento dependem do Chromium, do dispositivo e do ambiente. Nesta compilação, a captura usa mono e solicita normalização nativa por padrão. Um limitador suaviza os picos; aumentar o volume manual ainda pode tornar ruídos audíveis. Nenhum filtro recupera áudio que já chega distorcido do microfone.

## Push-to-Talk com o mouse

Ative o Push-to-Talk em **Configurações → Atalhos**. Clique em **Configurar tecla para falar** e pressione uma tecla ou o botão lateral Mouse 4/5. Também é possível escolher diretamente **Mouse 4 (lateral voltar)** ou **Mouse 5 (lateral avançar)** na lista **Atalho do Push-to-Talk**. Salve o perfil. O ícone de teclado identifica a espera; atividade de voz aparece em verde, e o mute manual mantém o microfone cortado. Sons locais de ativação e desativação têm opção própria em **Notificações**.

No Windows, o leitor global consulta somente o botão configurado, inclusive com outros programas em foco. Não bloqueia a função desse botão no jogo. O mute manual continua tendo prioridade; soltar o botão, sair da call ou encerrar o leitor fecha a fala. Não há registro das teclas pressionadas. Jogos com anticheat, sessões elevadas, desktop seguro ou software que remapeia o botão podem impedir a leitura; nesses casos, configure outra tecla. Não foi validado em todos os jogos.

## Volume e menu de participante

Clique com o botão direito no cartão ou no participante abaixo do canal de voz. O botão **•••** no cartão oferece a mesma ação pelo teclado/clique normal. O pequeno menu abre junto ao participante, com ajuste de **0% a 200%**, mute local e acesso à DM. Clique fora, pressione Esc ou use **Fechar** para fechá-lo.

O volume fica salvo pelo identificador do perfil, mesmo depois de sair, reconectar ou reiniciar. Mudar sua preferência não altera o que os outros ouvem. A amplificação usa um ganho separado por voz, com suavização de picos. O áudio da tela continua com controle próprio de 0% a 100% no player. Deafen silencia ambos; o mute local de um participante afeta apenas sua voz.

## Quedas de conexão

Após uma queda temporária, o aplicativo libera as conexões de mídia antigas, mostra **Reconectando** e tenta recuperar a sinalização até cinco vezes, com intervalo crescente e limite de seis segundos entre tentativas (cada conexão também tem timeout).

Quando a autorização continua válida, o host responde e o canal ainda existe, o Voxy reabre o microfone, retorna ao canal de voz e recria os peers. Perfil, mute/deafen, PTT, dispositivos e volumes permanecem. Tela e webcam ficam desligadas: inicie-as novamente quando desejar.

Se o canal foi excluído, a autorização foi recusada ou a entrada de áudio falha, o aplicativo informa o problema. Depois de esgotar as tentativas, confira internet, Radmin e o host; clique em **Reconectar** na lista de servidores. Sair ou desconectar voluntariamente cancela o retorno automático. O host precisa continuar aberto ou ser reaberto com a mesma sala/endereço/convite. O recurso não acrescenta relay/TURN nem garante conexão WebRTC em redes que bloqueiam o tráfego entre os amigos.

## Sons de eventos

Entrada e saída usam melodias de duas notas, com nível maior que na 0.5.0. Início e fim de tela usam melodias distintas de três notas. Snapshots repetidos não repetem o efeito; outros canais não disparam o som. A opção **Sons de entrada e saída da chamada e início/fim de transmissão** controla todos os efeitos; deafen também os silencia. O volume percebido depende da saída e do mixer do Windows.

## Links no chat

URLs completas iniciadas por `http://` ou `https://` são clicáveis em canais e DMs e abrem no navegador padrão. A aplicação valida novamente o endereço no processo principal; links de arquivos, comandos, esquemas personalizados e URLs com credenciais não são abertos. Pontuação ao redor do endereço permanece como texto. O conteúdo é tratado como texto, sem executar HTML das mensagens.

## Referências técnicas

- [Microsoft: GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate)
- [Microsoft: códigos de teclas virtuais](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes)
- [MDN: restrições de captura](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints)
