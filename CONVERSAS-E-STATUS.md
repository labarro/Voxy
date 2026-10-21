# Conversas, presença e navegação — Voxy 0.5.0

## Definir seu status

Abra **Configurações**, escolha **Seu status** e clique em **Salvar perfil e dispositivos**:

- **Online:** indicador verde.
- **Ausente:** indicador amarelo em forma de lua.
- **Ocupado:** indicador vermelho com traço; mantém mensagens não lidas e silencia os avisos de novas DMs.

A escolha é manual, fica salva e é compartilhada com os demais participantes. Não depende do mute do microfone nem do áudio silenciado. Ao desconectar, os outros veem você offline; a escolha reaparece ao reconectar. Para compartilhar presença, o host precisa estar na 0.5.0 ou posterior.

## Iniciar uma mensagem privada

1. Conecte-se à sala privada dos seus amigos.
2. Clique no **balão de mensagens** na barra esquerda.
3. Escolha uma pessoa na lista ou use a busca. Também é possível clicar no nome de outra pessoa em **Participantes** ou abrir **Mensagem privada** no menu de áudio da chamada.
4. Escreva e envie. O histórico funciona como o chat de um canal: imagens PNG/JPEG/WebP de até 2 MB, ampliação, edição e exclusão das suas próprias mensagens.

As DMs independem do servidor/canal selecionado dentro da sala. Você pode conversar em privado e continuar na chamada de voz. As conversas são agrupadas pela sala do host, sem misturar históricos de hosts diferentes.

Atualize o host e as pessoas que usarão DMs para a **0.5.0**. Cada pessoa precisa conectar uma vez com essa versão para registrar sua identidade. A interface informa quando um host ou destinatário ainda não oferece o recurso.

## Notificações e mensagens não lidas

O balão na barra mostra a quantidade de mensagens não lidas; a lista mostra o contador por conversa. Uma mensagem nova fora da conversa aberta gera um aviso clicável. Em segundo plano, o Windows pode mostrar uma notificação conforme suas permissões; clicar nela abre a conversa.

Abrir uma conversa com o aplicativo em foco marca suas mensagens como lidas. Os marcadores são locais, persistem ao reiniciar e não enviam confirmação de leitura ao interlocutor. **Ocupado** silencia os popups, sem ocultar os contadores e sem mutar a chamada. Voltar a Online não reapresenta avisos já silenciados.

## Quando alguém está offline

- **Destinatário offline, host conectado:** você pode enviar para alguém que já registrou sua identidade. O host guarda a mensagem e a entrega quando a pessoa voltar.
- **Host offline ou VPN desconectada:** o histórico local de texto e as fotos de perfil continuam disponíveis; o envio fica desativado. Reconecte à sala pelo servidor salvo na barra para continuar.
- **Imagens de mensagens:** os anexos são buscados no host. Uma imagem ainda não carregada, ou após reabrir o aplicativo, pode exigir reconexão para ser visualizada.

O aplicativo carrega até 500 mensagens recentes por conversa, com um teto de 5.000 por perfil/sala no cache. O banco do host mantém as mensagens anteriores; ainda não existe paginação na interface. Não há entrega entre hosts diferentes nem um serviço global de DMs na nuvem.

## Servidores na lateral

A barra continua **à esquerda**, com servidores conectados e salvos. Os salvos permanecem após fechar o aplicativo ou desligar o Radmin. Verde indica disponível; cinza indica fora de alcance; amarelo indica sala cheia. O tooltip explica convites expirados e servidores removidos.

Clique no ícone salvo para tentar reconectar mesmo se estiver fora de alcance. Isso pode significar host fechado, VPN desligada ou firewall — não prova que o servidor foi excluído. Para remover um acesso salvo, use a Home; isso não apaga dados do servidor nem conversas privadas.

Novidades, Home e DMs são páginas separadas dos canais. Clicar em um canal de texto ou voz abre essa área diretamente, e a seleção visual acompanha a página atual. Clicar em um servidor volta aos seus canais. A voz continua até você sair da chamada ou desconectar da sala.

## Privacidade, identidade e backup

O host entrega cada DM apenas ao remetente e ao destinatário. Imagens privadas têm verificação de acesso separada; não ficam disponíveis pelo endpoint de imagens dos canais. Edição e exclusão exigem autoria, inclusive para o cliente que hospeda a sala.

Na primeira conexão da 0.5.0, o perfil registra no host uma credencial derivada de um segredo do dispositivo protegido pelo Windows. Depois desse registro, conhecer apenas o UUID e o convite não basta para assumir esse perfil. Esse primeiro registro exige confiança nas pessoas convidadas; não existe conta global nem criptografia ponta a ponta.

**O host é confiável por definição:** ele mantém o banco e pode ler as mensagens. O histórico local e o banco não são cifrados em disco. Use a VPN e contas Windows protegidas para seu grupo privado.

Os backups iniciados pelo atualizador incluem `direct-inbox.json` e `profile-identity.bin`, além de perfil, banco e configurações anteriores. Não apague a identidade nem copie somente `profile.json` para outro computador: a identidade é protegida para o usuário/instalação Windows que a criou. Atualizar sobre a instalação existente preserva esses arquivos. Consulte [o guia de atualização](GUIA-DE-ATUALIZACAO.md) antes de restaurar dados ou migrar de computador.
