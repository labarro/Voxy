# Salas 3D · Voxy 1.1.0 em preparação

O código 1.1.0 está em desenvolvimento local, sem release ou instalador. A última versão publicada continua sendo [1.0.0](https://github.com/labarro/Voxy/releases/tag/v1.0.0). Execute `npm run build` e `npm start` para avaliar o código local; o perfil de desenvolvimento é separado da instalação. Não há editor de mapas nem construção livre.

## Entrar no lounge ou cinema

O host abre **… ao lado do servidor → Gerenciar servidor e canais** e escolhe **Lounge 3D** ou **Cinema 3D** em **Ambiente de [canal de voz]**. Entre no canal e clique em **Entrar na sala 3D**. Em Configurações → Salas 3D, escolha entrada automática, pergunta ou modo tradicional. Hosts anteriores continuam oferecendo chamadas tradicionais; para os novos estilos compartilhados, atualize o host e os participantes para 1.1.

**Voltar ao canal**, no topo da sala, mantém o microfone e a mesma chamada. Quem usa o modo tradicional permanece na lista e continua audível normalmente. O carregamento mostra o progresso dos modelos locais; falhas retornam à chamada tradicional sem abrir outra conexão de voz.

## Movimento e câmera

- Clique no ambiente para dar foco. **WASD ou setas** movimentam o personagem com aceleração e desaceleração suaves.
- **Arraste com o botão esquerdo** para girar; **roda** aproxima e afasta, respeitando os limites da câmera.
- **C** alterna acompanhamento e exploração. Na exploração, **arraste com o botão direito** para deslocar o foco pelo ambiente.
- **R** reposiciona a câmera. O menu de câmera no topo oferece as mesmas ações.
- **F** ou **Tela cheia da sala** abre fullscreen real. **Esc** sai. Redimensionar ou alternar fullscreen preserva personagem e câmera.

A câmera tem amortecimento, limites de inclinação e proteção contra obstáculos. As paredes laterais usam apresentação em corte quando vistas de fora; o modo livre permite inspecionar a arquitetura. A sensibilidade e a câmera inicial ficam em Configurações → Salas 3D.

Ao se aproximar de um lugar livre, um indicador no chão e a ação **E · Sentar** aparecem. Pressione **E** ou clique na ação contextual. O host reserva o assento; outra pessoa não pode ocupá-lo simultaneamente. Pressione novamente para levantar. O personagem usa transição de animação e procura um ponto livre ao sair. Sair do modo 3D ou mudar de canal libera o lugar. Digitar em menus não move o personagem.

## Seu personagem

Abra o ícone de personagem na HUD ou **Configurações → Salas 3D → Personalizar personagem**. O criador funciona fora de uma chamada e contém preview 3D com iluminação própria; arraste para girar e use Parado/Andando/Sentado para testar as animações.

Corpo, rosto, cabelo, roupas, acessórios e cores têm cards e paletas. Há cinco cabelos, quatro roupas e cinco opções de acessórios, além de proporções e expressões. Uma cor personalizada continua disponível. **Aplicar personagem** salva e sincroniza o visual, sem reiniciar o microfone. **Cancelar** descarta o rascunho; **Restaurar padrão** altera apenas o rascunho até aplicar. O preview pode ser recarregado após uma interrupção gráfica sem perder as escolhas.

Os campos básicos da 1.0 são preservados junto das extensões de estilo. Assim, conectar a um host antigo continua possível; ele pode mostrar apenas a personalização básica. O mesmo renderer de avatar atende preview e ambiente. [Modelos e licenças](ASSETS-3D.md).

## Assistir na TV

Compartilhe pelo botão da HUD. A TV exibe o fluxo já recebido no WebRTC. A escolha no seletor é sincronizada pelo host para todo o canal; se uma fonte encerra, outra ativa é escolhida de forma estável. Quando não há transmissão, a tela mostra sua apresentação de espera.

**Assistir na TV** faz uma transição suave para o enquadramento da tela. **Ampliar TV** abre o player na própria sala, ocupando a área disponível; o player tem fullscreen e controles existentes. **Voltar à sala** ou **Esc** retorna à exploração. A proporção do vídeo é preservada. Nenhuma captura nem conexão WebRTC adicional é criada; durante a ampliação, a renderização do ambiente e o vídeo da textura pausam para reduzir trabalho. O áudio continua no mecanismo existente, preservando saída selecionada, volume da transmissão e Deafen.

Webcams continuam na galeria da chamada, abaixo do ambiente. Em fullscreen da sala, volte ao layout do canal para ver essa galeria. A voz não é adicionada ao compartilhamento; continuam as regras de [captura segura](AUDIO-E-CONEXAO.md).

## Voz, HUD e qualidade

A HUD reúne mute, Deafen, transmissão, webcam, personagem, configurações e saída. O menu de participantes preserva o acesso ao mini perfil. Informações secundárias ficam mais discretas após alguns segundos de inatividade; os controles reaparecem ao interagir. Os temas continuam sendo aplicados à interface.

A voz por proximidade usa as tracks da mesma chamada: ganho integral até 1,5 m, atenuação até o alcance escolhido e panorama estéreo conforme a câmera. A opção é local; não é uma barreira de privacidade. Mute, Deafen, PTT e volumes individuais mantêm prioridade. Quem usa a interface tradicional continua audível sem atenuação.

Baixo limita a 24 FPS, desliga luzes adicionais/sombras dinâmicas e mantém contatos leves; médio limita a 40 FPS com sombras suaves; alto limita a 60 FPS e permite maior resolução. São tetos, não garantias. A antisserrilha é escolhida ao abrir o ambiente; reentre para reaplicá-la após mudar de nível. A renderização pausa com a janela oculta, minimizada, com diálogo aberto ou com o player ampliado, mantendo atualização de posição/áudio. Geometrias, materiais, texturas, skeletons e listeners são liberados ao sair.

Os cenários usam assets locais pequenos, instancing nos elementos repetidos e mapas de sombra atualizados em frequência reduzida. A posição continua sendo enviada somente quando muda, até cerca de nove vezes por segundo, com validação de limites/ocupação no host e interpolação nos demais clientes. Posições e assentos são transitórios; perfil e ambiente do canal são persistentes.

## Limites da avaliação

O 3D requer WebGL 2. As medições e testes usam mídia sintética e processos reais do navegador/Electron, sem substituir a instalação pessoal. Testes acústicos com microfones físicos, GPUs de entrada, PCs distintos pela VPN e sessões prolongadas continuam necessários. Resultados, capturas e roteiro: [TESTING.md](TESTING.md).
