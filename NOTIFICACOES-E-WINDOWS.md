# Notificações, PiP e Windows — 0.8.0

## Central e indicadores

O sino na barra esquerda abre até 500 notificações locais. Menções inseridas pelo autocomplete de `@`, respostas às suas mensagens, DMs e amizades recebidas/aceitas têm tipos próprios. Mensagens próprias, snapshots repetidos e a conversa aberta em uma janela com foco não geram alertas desnecessários. Uma mensagem com menção e resposta gera um único aviso.

Clique na entrada para abrir a conversa e destacar a mensagem, inclusive buscando mensagens anteriores quando conectado. Amizades abrem Amigos. Notificações de canal de outra sala tentam reconectar pelo servidor salvo; servidor removido, convite inválido ou host offline podem impedir a navegação. DMs guardadas continuam acessíveis offline.

**Marcar como lida** e **Marcar todas como lidas** controlam o histórico. Abrir uma conversa com foco também limpa suas pendências. Os contadores de canais/servidores representam mensagens novas observadas; os de DMs usam os marcadores persistentes da caixa privada. Marcar a central como lida não equivale a abrir todos os canais e DMs.

O histórico e os cursores ficam em `notifications.json`, separados por sala e perfil, e entram no backup do atualizador. Na primeira conexão, mensagens antigas não geram alertas. Ao reconectar, o Voxy considera as mensagens disponíveis no snapshot do host (até 100 por canal); não há push quando Voxy ou host estão desligados. Atualize também o host para identificar respostas a mensagens antigas fora do snapshot atual.

## Preferências e Não Perturbe

Em **Configurações → Notificações**, escolha tipos, sons e alertas do Windows. Os alertas nativos são solicitados em segundo plano, minimizado ou na bandeja. Permissões e Não Perturbe do Windows podem impedir sua exibição. Clicar no aviso restaura o Voxy e navega ao destino.

O Não Perturbe do Voxy pode durar 30 minutos, 1 hora, 8 horas ou 24 horas. **Ocupado** também silencia alertas. Você pode silenciar servidores/canais da sala conectada. Isso retira sons e avisos, mantendo histórico e não lidas. Desativar um tipo impede novas entradas daquele tipo. Salve para aplicar. Sons de notificações, PTT, mute/Deafen e chamada têm opções independentes.

Alertas têm intervalo mínimo de 1,2 segundo para evitar excesso; todas as entradas continuam no histórico.

## Picture-in-Picture

No player de tela ou webcam, clique em **Picture-in-Picture (sempre no topo)**. A janela nativa pode ser movida e redimensionada pelas bordas e fica sobre outros aplicativos. Há uma fonte em PiP por vez. Os controles nativos permitem fechar/retornar; o player também oferece **Retornar do PiP**.

O PiP usa o vídeo já recebido, sem nova captura, encoder ou conexão WebRTC. A fonte destacada continua recebendo quadros com a janela na bandeja; os demais vídeos seguem a pausa em segundo plano. Áudio, volumes e Deafen continuam no motor da chamada. Terminar a fonte, sair da chamada ou desmontar sua visualização encerra o PiP.

O modo nativo é sempre no topo enquanto ativo; não alterna para janela comum. Geometria, limites e controles são definidos pelo Chromium/Windows. [Especificação de Picture-in-Picture](https://www.w3.org/TR/picture-in-picture/).

## Bandeja e inicialização

O ícone da bandeja (às vezes em **Mostrar ícones ocultos**) oferece **Abrir Voxy**, **Mutar/desmutar microfone**, **Deafen** e **Sair**. Mute/Deafen ficam disponíveis durante a chamada e mostram o estado atual. Um clique no ícone restaura a janela.

Em **Configurações → Windows**:

- **Iniciar com o Windows:** configura o login automático na versão instalada.
- **Iniciar minimizado na bandeja:** inicia com a janela oculta.
- **Botão fechar minimiza para a bandeja:** o X oculta sem desconectar. Desativado por padrão, mantém o encerramento convencional.
- **Minimizar para a bandeja agora:** oculta imediatamente.

**Sair** encerra conexões, host, leitores de atalhos e a bandeja e salva o banco. Abrir novamente restaura a instância existente. A inicialização automática não é aplicada em desenvolvimento ou com `VOXY_DATA_DIR`, para não alterar o login pessoal durante os testes. As preferências podem ser desfeitas nas configurações. [API de inicialização do Electron](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows).

## Verificação

`npm run test:system` usa dois clientes para menções, replies, DMs, amizades, navegação à mensagem, leitura/persistência, callbacks reais do menu da bandeja, chamada preservada e encerramento por Sair. PiP local e remoto de webcam/tela recebe novos quadros com a janela oculta e fecha ao terminar a fonte. A exibição de notificações do Windows é interceptada no teste; isso verifica o encaminhamento ao objeto nativo, sem comprovar um toast com toda configuração pessoal possível.

`npm test` cobre migração, deduplicação após reinício, isolamento por perfil, tipos, Não Perturbe, silêncios e leitura. Câmeras e microfones de integração são sintéticos. Login real do Windows, geometria/hover dos controles nativos, jogos elevados e avaliação humana entre computadores distintos ainda precisam de verificação manual.
