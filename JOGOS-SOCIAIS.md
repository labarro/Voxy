# Jogos sociais · Voxy 1.4.1

Atualize o host e todos os participantes para 1.4.1. Lounge e Rooftop têm mesas físicas de sinuca, Truco e xadrez. Use os botões da sala para caminhar até uma mesa, ou aproxime-se e pressione **E**. Assentos de jogos são reservados pelo host; os parceiros do Truco ficam frente a frente. Espectadores podem circular e conversar por proximidade.

## Sinuca: modos Rotação 7 e Bola 8

A mesa tem dois modos independentes. **Rotação 7** continua sendo o padrão e funciona como antes. **Bola 8** usa o jogo oficial de 15 bolas, com regras baseadas nas [regras de Bola 8 da WPA](https://wpapool.com/rules-of-play/). As simplificações estão listadas abaixo. A física, os turnos e as regras rodam só no host; os clientes apenas interpolam os snapshots.

**Escolha do modo.** Quem entra primeiro numa mesa vazia escolhe o modo no seletor da HUD antes de clicar em **Entrar na partida**. Jogadores sentados podem trocar o modo enquanto esperam o adversário ou depois do fim da partida. No fim, escolher o outro modo inicia na hora uma nova partida nele. **Revanche** mantém o modo e alterna quem abre. Durante uma partida o modo não muda. Se um jogador sair, o modo fica para o próximo adversário.

### Rotação 7

É uma modalidade recreativa própria: sete bolas numeradas, o primeiro contato deve ser sempre na menor bola da mesa e cada bola encaçapada legalmente vale um ponto. Combinações valem depois desse primeiro contato. Quem encaçapa continua; quem não encaçapa passa a vez. A abertura segue as mesmas regras, sem exigência de tabelas ou caçapa anunciada.

Não tocar a menor bola primeiro, não tocar nenhuma bola ou encaçapar a branca é falta. As bolas encaçapadas nessa tacada voltam à mesa, sem pontuar, e o adversário recebe bola na mão em qualquer área livre do feltro. Ao terminar as sete bolas, vence quem tiver mais pontos (não há empate). A HUD também mostra um contador informativo de faltas.

### Bola 8: o que foi implementado

- **Bolas:** branca, lisas 1–7, bola 8 preta e listradas 9–15, nas cores oficiais (1/9 amarela, 2/10 azul, 3/11 vermelha, 4/12 roxa, 5/13 laranja, 6/14 verde, 7/15 bordô, 8 preta).
- **Triângulo:** bola da frente sobre o ponto do pé, bola 8 no centro da terceira fileira, uma lisa e uma listrada nos dois cantos de trás. As outras posições são embaralhadas a partir de uma semente: o host sorteia a semente e os testes usam sementes fixas, o que torna as partidas reproduzíveis.
- **Abertura:** quem abre tem bola na mão atrás da linha de cabeceira (a área destacada no feltro). Na revanche, abre o outro jogador.
- **Abertura legal:** é preciso encaçapar uma bola ou levar ao menos quatro bolas numeradas às tabelas. Se quem abriu encaçapou alguma bola sem falta, continua jogando.
- **Mesa aberta:** a mesa fica aberta depois da abertura, mesmo que bolas tenham caído nela. Com a mesa aberta, qualquer bola pode ser o primeiro contato, exceto a 8.
- **Grupos:** a primeira bola encaçapada legalmente depois da abertura define o grupo do jogador (Lisas ou Listradas); o adversário fica com o outro.
- **Continuação:** o jogador só continua se encaçapar legalmente ao menos uma bola do próprio grupo. Bolas do adversário que caiam junto ficam encaçapadas. Se caírem só bolas do adversário, a vez passa.
- **Primeiro contato:** deve ser numa bola do próprio grupo, ou na 8 quando o grupo acabou.
- **Regra da tabela:** depois do contato, alguma bola precisa cair numa caçapa ou qualquer bola (incluindo a branca) precisa tocar uma tabela. O host registra cada toque nas tabelas no passo da física.
- **Faltas:** branca na caçapa, primeiro contato errado (incluindo a 8 cedo demais), nenhum contato e falta de tabela. Bolas encaçapadas numa falta continuam fora. O adversário recebe bola na mão em qualquer lugar livre da mesa; depois de uma branca na caçapa na abertura, só atrás da linha de cabeceira. Cada jogador tem um contador de faltas; como na WPA, não há regra de três faltas na Bola 8.
- **Bola 8:** com o grupo concluído, o jogador anuncia uma das seis caçapas na HUD antes da tacada (o host recusa a tacada sem anúncio). Encaçapar a 8 legalmente na caçapa anunciada vence a partida.
- **Derrota:** encaçapar a 8 antes de concluir o grupo, inclusive na mesma tacada da última bola do grupo; encaçapar a 8 com falta (por exemplo, com a branca); ou encaçapar a 8 numa caçapa diferente da anunciada. Uma falta na vez da 8 sem que ela caia não perde a partida: o adversário recebe bola na mão.
- **Saída:** sair ou desconectar durante a partida dá a vitória ao adversário.

### Bola 8: simplificações adotadas

- **Sem anúncio geral de tacadas:** só a caçapa da 8 é anunciada. Qualquer bola do grupo que caia legalmente vale, inclusive por tabela, combinação ou sorte. Com a mesa aberta, o grupo vem da primeira bola que entrou na tacada.
- **Abertura ilegal:** é sempre falta. O triângulo é remontado e o adversário abre com bola na mão atrás da linha de cabeceira. Não há a escolha da WPA entre aceitar a mesa ou pedir nova abertura.
- **Bola 8 na abertura:** volta sempre ao ponto do pé ou ao ponto livre mais próximo na linha longa, atrás dele. Sem falta, quem abriu continua; se a branca também caiu, o adversário recebe bola na mão atrás da linha de cabeceira. Não há opção de remontar o triângulo.
- **Branca na caçapa na abertura:** as bolas encaçapadas continuam fora e a mesa fica aberta. Não há a restrição de jogar primeiro uma bola que esteja atrás da linha de cabeceira.
- **Bola na mão:** o jogador escolhe a posição com um clique. Depois de colocada, a branca não pode mais ser movida naquela vez.
- **Física:** bolas não saltam nem saem da mesa, então não há faltas de salto, de bola fora da mesa, de tacada dupla ou de toque com o taco, nem regras de empurrão. Não há tempo de tacada nem impasse (stalemate).

### Física e controles

O host simula a 120 passos por segundo, com atrito, colisões entre bolas, tabelas e seis caçapas. O impulso entra no contato do taco, depois de 650 ms de preparação. O controle opcional **Efeito** (−100% puxar a +100% seguir) guarda uma rotação limitada na branca: depois do primeiro contato, até 70% da velocidade normal do choque volta ou segue, liberada em 0,15 s na direção da tacada. É determinístico e não há efeito lateral. Sem efeito, a simulação é idêntica à da Rotação 7 anterior (há um teste de impressão digital para isso).

Entre na partida perto da mesa. Clique ou arraste com o botão esquerdo sobre o feltro para mirar e solte para fixar a direção; mover o cursor até a HUD não altera a mira. Ajuste força, efeito e, se quiser, a direção fina na HUD. O avatar caminha e ajusta a postura antes de liberar a tacada. Use **Dar tacada** ou, com o canvas em foco, **Espaço/Enter**. **Esc** desfaz a última seleção, e outro clique ou arraste reajusta a mira. Arraste com o botão direito para orbitar e use a roda para zoom. Com bola na mão, clique no feltro (na área destacada, na abertura). Na vez da 8, clique numa caçapa do mini diagrama da HUD; a caçapa escolhida fica marcada em dourado na mesa para todos.

A HUD mostra o modo, os jogadores, de quem é a vez, o grupo de cada um (Lisas, Listradas ou Mesa aberta) com fichas das bolas restantes, as faltas, a mensagem do host, a indicação de bola na mão, a caçapa anunciada, o vencedor e os botões **Revanche** e **Sair**. Quem está na sala e não joga vê tudo isso sem controles ("Assistindo"). A mesa tem moldura em nogueira, tabelas com perfil, feltro texturizado, caçapas forradas de couro, diamantes e pernas torneadas. As bolas rolam conforme o deslocamento interpolado, e os sons de choque, tabela e caçapa são sintetizados localmente.

**Compatibilidade:** os campos novos são opcionais. Um host antigo continua enviando partidas de Rotação 7, que os clientes novos mostram normalmente. Já os clientes antigos não sabem desenhar a Bola 8 e podem falhar ao recebê-la: atualize o host e todos os participantes antes de usar o modo.

## Truco Paulista: duas duplas até 12

Baralho de 40 cartas, sem 8, 9, 10 ou coringas. Cada jogador recebe três cartas e há uma vira pública. Ordem comum: **3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4**. Valores comuns iguais empatam, independentemente do naipe.

A próxima carta da sequência circular **4, 5, 6, 7, Q, J, K, A, 2, 3** é manilha. Entre manilhas, **paus > copas > espadas > ouros**. São manilhas variáveis paulistas, não as fixas mineiras.

Os assentos 1/3 enfrentam 2/4. A distribuição começa depois do pé; o pé avança um assento por mão. Joga-se em sentido anti-horário visto de cima. O vencedor da vaza começa a seguinte; na primeira empatada, o mão inicia novamente. Empate posterior conserva o iniciador da vaza anterior. Carta coberta só existe a partir da segunda vaza e não disputa força. Clique na carta física na sua mão; os adversários recebem apenas seu verso e a quantidade restante.

A mão começa valendo 1. Pedidos alternam entre duplas: **Truco (3), Seis (6), Nove (9), Doze (12)**. O jogador da vez pode pedir. A outra dupla pode aceitar, correr ou aumentar. Correr concede o valor anterior ao pedido: 1, 3, 6 ou 9. A primeira resposta válida de um parceiro prevalece; revisão de estado, turno e dupla são validados no host. Não há dois pedidos simultâneos nem aumento consecutivo da mesma dupla sem alternância.

O regulamento adotado para empates e mão de onze toma como referência a seção 19.7 do [Torneio FENAFISCO/CONAFISCO 2022](https://www.conafisco.org.br/wp-content/uploads/2022/10/Regulamento-Torneio-Desportivo-Ajustado.pdf). As regras gerais também podem ser comparadas ao [regulamento AFIA 2024](https://afiasoccer.com/wp-content/uploads/2024/11/Regulamento-Truco-BA24.pdf). Há variantes regionais; estas são as decisões desta implementação:

- Primeira vaza empatada: a segunda decide, ou a terceira se também houver empate.
- Segunda empatada: ganha quem venceu a primeira.
- Uma vaza para cada dupla e terceira empatada: ganha quem venceu a primeira.
- Três empates: ninguém pontua; outra mão é distribuída, com rotação do pé.
- Mão de onze: somente a dupla com 11 recebe também as cartas do parceiro. Ambos precisam aceitar jogar por 3; qualquer recusa concede 1 ao adversário. Não há aumentos.
- Mão de ferro, 11×11: mão cega valendo 3, sem carta coberta e sem pedidos. Nem o próprio dono recebe os valores de sua mão antes de jogar. Três empates repetem uma mão cega, sem sorteio de vencedor. Esta explicitação digital complementa a referência regional.

A distribuição usa `crypto.randomInt` no host. Cartas privadas ficam em campos privados do motor e são serializadas individualmente por identidade autenticada. Espectadores não recebem mãos; cartas cobertas não são reveladas. O computador do host é a autoridade confiável, não um serviço independente de arbitragem.

## Xadrez

As regras rodam no host com **chess.js 1.4.0**, licença BSD-2-Clause. Clique numa peça e depois no destino destacado. Escolha previamente dama, torre, bispo ou cavalo no controle de promoção. Roque, captura, en passant, promoção, xeque, mate e afogamento são validados no motor; os clientes não podem impor um FEN ou resultado.

Há desistência, proposta/aceitação de empate e revanche. Tripla repetição e cinquenta lances permitem reivindicação, inclusive indicando um lance legal que completará a condição. Cinco repetições e 75 lances sem captura ou movimento de peão encerram automaticamente; mate tem precedência. Material insuficiente segue o detector da biblioteca. Não há relógio competitivo, regra de peça tocada ou árbitro presencial. Referências: [chess.js](https://jhlywa.github.io/chess.js/) e [Leis FIDE, artigos 9.2–9.6](https://handbook.fide.com/chapter/e012023).

## Emotes e comunicação

**G** abre o menu radial por padrão; mouse ou setas/Enter escolhem uma ação, **Esc** cancela. Acenar, rir, dançar, aplaudir, comemorar, cumprimentar, apontar, sentar no chão, fazer pose e surpresa são sincronizados. Cigarro virtual e parar ação ficam na mesma roda. A prévia é local; a seleção é transmitida. Movimentar cancela sentar no chão. As preferências permitem escolher outra tecla livre dos atalhos de voz, desativar cigarro/fumaça e silenciar sons dos jogos. Durante jogos, animações de mãos e objetos têm prioridade.

Voz, PTT, Mute, Deafen, webcam, chat e compartilhamento continuam nos serviços existentes. O controle do jogo não captura o microfone. Sons dos jogos são sintetizados localmente, sem arquivos remotos, e respeitam Deafen e as preferências da sala.

## Reservas, reconexão e limites

Truco e xadrez reservam os assentos por 60 segundos quando a conexão cai e pausam a partida. Reconectar com a mesma identidade e voltar ao mesmo canal 3D restaura o assento e o estado; outro perfil ou credencial não pode tomar a mão. Sair voluntariamente de uma partida/canal é abandono. No Truco, abandonar concede vitória à dupla adversária. Reiniciar exige os participantes necessários reunidos.

As partidas vivem na memória do host. Encerrar o host, remover o canal ou trocar o ambiente encerra a sessão; não há retomada de partida após reiniciar o host. Não há matchmaking, editor de mapas, apostas com dinheiro, ranking ou persistência competitiva. A sinuca (Rotação 7 ou Bola 8) encerra por desconexão, sem reserva de 60 segundos.
