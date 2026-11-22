# Salas 3D · Voxy 1.6.0 (3D Overhaul)

A 1.6.0 reformula toda a experiência tridimensional sobre a base Electron 1.5.0: personagens, ambientes, iluminação, câmera, sinuca e uma nova área de bar. Voz por proximidade, compartilhamento/TV, webcam, Truco, xadrez e a sincronização pelo host continuam os mesmos mecanismos. **Host e participantes precisam estar na 1.6.0**: o layout (bar e banquetas), os campos novos da pose (`held`, emotes `drink`/`toast`) e a Bola 8 são validados no host; clientes antigos não desenham as bebidas nem as 16 bolas.

## Personagens

- **Modelos:** corpos estilizados (base masculina e feminina) com malha contínua, esqueleto de 65 ossos e animações esqueléticas reais, a partir dos pacotes CC0 da Quaternius ([créditos](THIRD-PARTY-NOTICES.md)). A cabeça é levemente ampliada para leitura à distância; o corpo masculino de origem, musculoso demais, é suavizado em todas as variações.
- **Roupas:** cada peça é uma "casca" contínua derivada do próprio corpo e presa aos mesmos ossos, por isso acompanha qualquer animação sem juntas aparentes. As bainhas seguem linhas limpas; a superfície passa por cima dos sulcos musculares sem afundar no corpo; a pele coberta é removida para não atravessar o tecido. Camiseta, suéter, moletom (com capuz), jaqueta, camisa, sobretudo, terno e jaqueta college; calça, short e saia; tênis, botas e sapatos.
- **Cabelos:** curto, longo, chanel, ondulado, cacheado, afro, rabo de cavalo, tranças, coque, raspado, moicano e sem cabelo, com cor e mechas. Chapéus comprimem o volume do cabelo para dentro da copa. Barba, barba rala e bigode acompanham a mandíbula.
- **Rosto:** olhos em malha com piscadas, sobrancelhas presas a um osso próprio (expressões discretas), mandíbula adicionada ao rig para falar. Formato do rosto e olhos ajustam escala sem tirar os elementos do lugar.
- **Animações:** parado, caminhar, correr (Shift), sentar, falar sentado e em pé, dançar, comemorar, acenar com a mão aberta, aplaudir, apontar, pose, surpresa, cigarro virtual, sentar no chão, segurar e beber. A velocidade das pernas acompanha o deslocamento real (também dos outros participantes), reduzindo pés deslizando.
- **Criador:** acrescenta **Base Masculina/Feminina**. Todas as opções e aparências salvas continuam válidas; perfis antigos escolhem a base pelo cabelo/saia.

## Ambientes

- **Lounge:** parede da TV em ripas de nogueira com luz indireta, console baixo e caixas de som, estantes com livros, sofá modular, mesa de centro, poltronas e pufes, cantinho de leitura com mesa redonda, área de jogos com tapete e pendentes, janelas com vista noturna, quadros, plantas, aparador, gabinete de discos, suporte de tacos e o **bar**.
- **Cinema:** palco com cortinas de veludo, proscênio, painéis acústicos, arandelas, céu estrelado, luz de corredor, carpete estampado, cabine de projeção com feixe e poltronas reclináveis com porta-copos.
- **Rooftop:** entardecer com céu em degradê, lua e skyline em três camadas; deck de madeira, guarda-corpo de vidro, dois pergolados, varal de luzes, lareira externa com poltronas, floreiras, tela externa no núcleo de serviço e **bar** com cobertura.
- **Luz e materiais:** madeira, tecidos, couro, metal escovado, mármore e vidro com texturas procedurais pequenas; reflexos suaves de ambiente (PMREM), tone mapping ACES, sombras da luz principal, emissivos discretos e luzes pontuais (desligadas no nível Baixo). Peças estáticas são agrupadas por material e repetições usam instancing.

## Bar e bebidas

Aproxime-se do balcão (lado oeste do Lounge e do Rooftop) e pressione **E · Pegar bebida**: escolha **Lata (1)**, **Garrafa (2)** ou **Caneca (3)**. O personagem segura a bebida, pode caminhar, correr e sentar com ela. **Q** ou **Beber** levanta o braço, leva a borda aos lábios, inclina a cabeça e o recipiente e volta ao repouso (cerca de 3,5 s), com um som discreto de gole. **Brindar** ergue a bebida; quando duas pessoas brindam a menos de ~1,9 m, toca um tilintar. **Guardar** ou **Devolver ao balcão** solta o recipiente. Tudo é sincronizado pela pose existente (`held` e emotes), sem estado novo no host além da validação. As banquetas são assentos reserváveis comuns. Não há marcas comerciais, embriaguez nem efeito em controles: é uma interação cosmética.

## Voz e identificação

O selo de voz ao lado do nome e o anel no chão aparecem só quando o áudio real do participante abre o gate de fala do motor de voz (respeitando Mute, PTT e áudio ausente). Enquanto isso, a boca abre e fecha de forma estilizada; em silêncio, fica fechada. As placas de nome são pílulas compactas sobre a cabeça. Nenhum mecanismo de áudio foi alterado para os efeitos visuais.

## Controles

**WASD** caminha, **Shift** corre, **E** interage (sentar/levantar, bar, mesas), **Q** bebe, **G** abre a roda social, **C** alterna câmera, **R** reposiciona, **F** tela cheia. A câmera mira na altura do peito/cabeça das novas proporções, aproxima mais (zoom mínimo menor) e mantém a proteção contra paredes e contra entrar no personagem.

## Desempenho e qualidade

Os níveis Baixo/Médio/Alto mantêm os tetos de 24/40/60 FPS, sombras dinâmicas apenas em Médio/Alto e luzes pontuais desligadas em Baixo. Os avatares compartilham geometrias derivadas e texturas entre si; cada um cria apenas materiais e o esqueleto. O pacote local de modelos tem 8,4 MB (manifesto com SHA-256). Medições: [TESTING.md](TESTING.md#voxy-160--3d-overhaul).

## Revisão 1.4.1

Na revisão 1.4.1, clique/arraste no feltro e solte para fixar a mira da sinuca. Espaço/Enter no canvas executa; Esc desfaz a seleção. O modo de baixo consumo (Configurações → Windows) mantém a entrada tradicional por padrão e reduz a qualidade 3D quando você abrir um ambiente. Renderização e TV pausam quando o ambiente fica oculto; sair para o canal libera os recursos gráficos. [Medições e limites](STABILITY-1.4.1.md).

A [versão 1.4.1 está publicada](https://github.com/labarro/Voxy/releases/tag/v1.4.1), com instalador e auto update conferidos. Lounge e Rooftop oferecem sinuca, Truco Paulista e xadrez no cenário. O Cinema mantém a experiência de assistir. O Rooftop tem guarda-corpos, núcleo de acesso, pergolados, deck e cidade ao redor; é um ambiente externo pronto, sem editor de mapas.

Use E perto de móveis e mesas, ou os botões de jogos para caminhar até eles. G abre a roda social; a tecla pode ser alterada nas preferências, com reserva de uma tecla livre dos atalhos de voz. Mouse controla mira e seleção diretamente nos objetos. Voz e mídia continuam disponíveis durante as partidas. [Regras, controles e reconexão](JOGOS-SOCIAIS.md).

## Histórico da base visual


A [release 1.2.1](https://github.com/labarro/Voxy/releases/tag/v1.2.1) foi publicada pelo [workflow](https://github.com/labarro/Voxy/actions/runs/43330910485). Os cinco arquivos foram baixados; assinatura Ed25519, SHA-512, SHA-256, notas e endpoint público foram conferidos. [Evidência](evidence/publication-1.2.1.json). O perfil de desenvolvimento é separado da instalação. Não há editor de mapas nem construção livre.

Atualize o host e os participantes para 1.2.1 para que o layout, as colisões e os novos modelos coincidam entre os clientes. O protocolo e os perfis anteriores continuam compatíveis; versões antigas desenham os modelos e obstáculos antigos.

Na 1.2.1 os dois ambientes são interiores fechados, com teto, quatro paredes, portas, forro e luminárias. O Lounge organiza TV, conversa e sinuca e tem apoio de hospitalidade na parede traseira; o Cinema reúne carpete contínuo, poltronas com apoios de cabeça/porta-copos e cabine de projeção. Os tacos compartilham um pivô por objeto, com segmentos unidos e suporte próprio.

O avatar usa torso orgânico, braços/pernas contínuos deformados por ossos e calçados com perfil arredondado. Cabelos são superfícies desenhadas para o formato da cabeça, com tranças, rabo e coque por curvas. O rosto acompanha a superfície da cabeça; a saia deforma a própria malha ao sentar. Altura do assento, inclinação dos joelhos e contato dos pés foram calibrados para as alturas disponíveis. As opções e aparências já salvas permanecem compatíveis.

Os dois ambientes têm arquitetura de 26 × 24 m. O Lounge tem área de TV, conversa e jogos; o Cinema tem 12 poltronas em três fileiras, com corredores central e laterais. Móveis e personagens mantêm suas proporções. Cada assento tem uma única construção com frente local +Z; o layout e as colisões são compartilhados entre host e renderer.

## Sinuca: Rotação 7 e Bola 8

Aproxime-se da mesa no Lounge ou no Rooftop e use **E · Jogar sinuca**, ou abra **Sinuca**. Escolha **Rotação 7** ou **Bola 8** no seletor de modo e clique em **Entrar na partida**. Dois usuários próximos à mesa iniciam a partida. Somente o jogador da vez pode jogar, e somente depois que as bolas pararem. Quem não está jogando pode abrir a mesma HUD para acompanhar, sem controles. Regras completas, as regras WPA implementadas e as simplificações estão em [Jogos sociais](JOGOS-SOCIAIS.md).

- **Rotação 7:** uma branca e sete bolas numeradas. O primeiro contato é sempre na menor bola, e cada bola encaçapada legalmente vale um ponto. Em falta, as bolas da tacada voltam e o adversário recebe bola na mão.
- **Bola 8:** 15 bolas oficiais, triângulo da WPA, abertura com bola na mão atrás da linha de cabeceira, exigência de abertura legal, mesa aberta, grupos Lisas e Listradas, regra do primeiro contato e da tabela, bola na mão depois de faltas e anúncio da caçapa da 8.
- **Revanche** mantém o modo e alterna quem abre. O modo pode ser trocado antes do início ou no fim da partida.
- O controle **Efeito** aplica uma rotação para puxar ou seguir com a branca, limitada e determinística. Não há efeito lateral nem salto.

A mesa mantém as mesmas coordenadas, área de colisão e circulação de antes. Ela tem trilho de nogueira com bordas arredondadas, tabelas com bocas em ângulo, feltro com textura procedural e furos reais nas caçapas, forro e cantos de couro, diamantes, pernas torneadas, suporte de tacos corrigido e placar na cabeceira. As bolas compartilham uma única geometria e usam texturas de 256 × 128 px com os dois números. As partes fixas são agrupadas por material, e não há luz extra nem arquivo externo. A área da linha de cabeceira aparece destacada quando a bola na mão está restrita a ela. A caçapa anunciada para a 8 recebe um anel dourado.

O host executa física 2D com passos de 1/120 s, atrito, colisões bola/bola, tabelas (cujos toques ficam registrados para as regras) e seis caçapas. Snapshots a cada 100 ms vão somente aos participantes do canal; os clientes interpolam a apresentação, giram as bolas pelo deslocamento e tocam sons de choque, tabela e caçapa sem recalcular o resultado. Turno, distância, força, efeito, caçapa anunciada, posição da bola na mão e revisão são validados no host. Um atraso no processo do host desacelera a partida igualmente para todos. As partidas são transitórias e não ficam salvas depois que o host fecha. Atualize o host e todos os participantes: clientes antigos não exibem a Bola 8.

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

A câmera tem amortecimento, limites de inclinação e proteção contra obstáculos. A exploração permanece no interior; paredes e teto são opacos. Ao sentar, o pivô fica acima do encosto. Colisão com volume, busca de órbita livre e exclusão do volume do avatar impedem o colapso da câmera dentro do corpo. A trajetória suavizada também é conferida, incluindo ao levantar e voltar da TV. A sensibilidade e a câmera inicial ficam em Configurações → Salas 3D.

Ao se aproximar de um lugar livre, um indicador no chão e a ação **E · Sentar** aparecem. Pressione **E** ou clique na ação contextual. O host reserva o assento; outra pessoa não pode ocupá-lo simultaneamente. Pressione novamente para levantar. O personagem usa transição de animação e procura um ponto livre ao sair. Sair do modo 3D ou mudar de canal libera o lugar. Digitar em menus não move o personagem.

## Seu personagem

Abra o ícone de personagem na HUD ou **Configurações → Salas 3D → Personalizar personagem**. O criador funciona fora de uma chamada e contém preview 3D com iluminação própria; arraste para girar e use Parado/Andando/Sentado para testar as animações.

Corpo, rosto, cabelo, roupas, acessórios e cores têm cards e paletas. Há quatro tipos físicos com altura ajustável; três formatos de cabeça, olhos, sobrancelhas e nariz; três expressões e opções de barba/bigode. Os 12 cabelos incluem curto, longo, topete, chanel, cacheado, raspado, afro, rabo de cavalo, tranças, ondulado, preso e sem cabelo, com cor e mechas opcionais. Combine oito peças superiores com calça/shorts/saia e tênis/botas/sapatos, em cores independentes. Óculos, óculos escuros, fones/headset, gorro/boné/chapéu, brincos, colar, pulseira e mochila podem ser combinados. Chapéus, óculos e fones substituem peças de seu grupo; chapéus também ocultam volumes altos do cabelo para reduzir sobreposição.

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
