# Salas 3D · Voxy 1.2.0 em preparação

Código 1.2.0 em validação para publicação autorizada. A última versão publicada é [1.1.0](https://github.com/labarro/Voxy/releases/tag/v1.1.0). Execute `npm run build` e `npm start` para avaliar o código local; o perfil de desenvolvimento é separado da instalação. Não há editor de mapas nem construção livre.

Os dois ambientes têm arquitetura de 26 × 24 m. O Lounge tem área de TV, conversa e jogos; o Cinema tem 12 poltronas em três fileiras, com corredores central e laterais. Móveis e personagens mantêm suas proporções. Cada assento tem uma única construção com frente local +Z; o layout e as colisões são compartilhados entre host e renderer.

## Sinuca Rotação 7

Aproxime-se da mesa no Lounge e use **E · Jogar sinuca**, ou abra **Sinuca** e **Entrar na partida**. Dois usuários próximos à mesa iniciam a partida. A interface indica jogador da vez, próxima bola e placar. Clique na representação da mesa ou use **Direção**, ajuste **Força** e escolha **Dar tacada**. Somente o jogador da vez pode jogar, e somente após as bolas pararem.

- Há uma branca e sete bolas numeradas. O primeiro contato deve ser com a menor bola ainda na mesa.
- Cada bola encaçapada em tacada válida vale um ponto; quem encaçapa continua. Sem encaçapar, passa a vez.
- Encaçapar a branca, não acertar nenhuma bola ou tocar outra bola primeiro é falta. As bolas encaçapadas nessa tacada voltam a posições livres e a vez passa. Não há bola na mão, regra de tabela obrigatória, efeito ou salto.
- Vence quem somar mais pontos quando as sete bolas terminarem. **Sair da partida**, desconectar, trocar de canal ou sair do 3D reinicia o placar, preservando o adversário na espera. Para revanche, saia e entre novamente.

O host executa física 2D com passos de 1/120 s, atrito, colisões bola/bola, tabelas e seis caçapas. Snapshots a cada 100 ms vão somente aos participantes do canal; clientes interpolam a apresentação sem recalcular o resultado. Turno, distância, força e revisão são validados no host. Um atraso do processo host desacelera a partida igualmente para todos. Partidas são transitórias, sem salvamento após encerrar o host. Atualize host e participantes para 1.2.0.

## Interações sociais

Em **Interação**, escolha acenar, rir, dançar, comemorar, cumprimentar ou cigarro virtual. **Parar ação** interrompe a ação. Emotes terminam após seis segundos; cigarro virtual termina após dois minutos ou ao parar/sair. A pose e o início são sincronizados pelo host. Cigarro e fumaça são apenas visuais, sem vantagens ou efeitos de gameplay. Em **Configurações → Salas 3D**, desmarque **Mostrar cigarro virtual e fumaça** para ocultar o efeito e sua pose de todos os personagens localmente.

## Entrar no lounge ou cinema

O host abre **… ao lado do servidor → Gerenciar servidor e canais** e escolhe **Lounge 3D** ou **Cinema 3D** em **Ambiente de [canal de voz]**. Entre no canal e clique em **Entrar na sala 3D**. Em Configurações → Salas 3D, escolha entrada automática, pergunta ou modo tradicional. Hosts anteriores continuam oferecendo chamadas tradicionais; para os novos estilos compartilhados, atualize o host e os participantes para 1.2.

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

Corpo, rosto, cabelo, roupas, acessórios e cores têm cards e paletas. Há quatro tipos físicos com altura ajustável; três formatos de cabeça, olhos, sobrancelhas e nariz; três expressões e opções de barba/bigode. Os 12 cabelos incluem curto, longo, topete, chanel, coques cacheados, raspado, afro, rabo de cavalo, tranças, ondulado, preso e sem cabelo, com cor e mechas opcionais. Combine oito peças superiores com calça/shorts/saia e tênis/botas/sapatos, em cores independentes. Óculos, óculos escuros, fones/headset, gorro/boné/chapéu, brincos, colar, pulseira e mochila podem ser combinados. Chapéus, óculos e fones substituem peças de seu grupo; chapéus também ocultam volumes altos do cabelo para reduzir sobreposição.

Arraste a prévia para girar e use a roda para aproximar os detalhes. **Desfazer** guarda até 30 alterações; **Salvar visual** guarda até seis aparências neste computador, com aplicação e exclusão individuais. Os presets ficam no armazenamento local do renderer; a aparência aplicada fica no perfil e é sincronizada. **Aplicar personagem** salva sem reiniciar o microfone. **Cancelar** descarta o rascunho; **Restaurar padrão** altera apenas o rascunho até aplicar. O preview pode ser recarregado após uma interrupção gráfica sem perder as escolhas.

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
