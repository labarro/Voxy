# Jogos sociais · Voxy 1.4.0

Atualize o host e todos os participantes para 1.4.0. Lounge e Rooftop têm mesas físicas de sinuca, Truco e xadrez. Use os botões da sala para caminhar até uma mesa, ou aproxime-se e pressione **E**. Assentos de jogos são reservados pelo host; os parceiros do Truco ficam frente a frente. Espectadores podem circular e conversar por proximidade.

## Sinuca: Rotation 7 do Voxy

É uma modalidade recreativa própria, sem misturar regras de bola oito ou sinuca brasileira: sete bolas numeradas, primeiro contato sempre na menor bola ainda na mesa, um ponto por bola legalmente encaçapada. Combinações são válidas depois desse primeiro contato. Encaçapar mantém a vez; não encaçapar passa a vez. A abertura segue as mesmas regras, sem exigência adicional de tabelas ou caçapa anunciada.

Não tocar a menor bola primeiro, não tocar nenhuma bola ou encaçapar a branca é falta. As bolas encaçapadas nessa tacada voltam à mesa, sem pontuar. O adversário recebe bola na mão em qualquer área livre do feltro; não pode sobrepor outra bola, colocar na caçapa ou fora da mesa. Ao terminar as sete bolas, vence quem tiver mais pontos. Sair ou desconectar durante uma partida concede vitória ao adversário. O placar não empata, pois há sete pontos disponíveis.

Entre na partida perto da mesa. Mova o mouse sobre o feltro para mirar; o avatar caminha e ajusta a postura antes de liberar a tacada. Ajuste força e, opcionalmente, direção fina pela HUD. Arraste com o botão direito para orbitar e use a roda para zoom. Clique no feltro quando houver bola na mão. A física recebe o impulso no contato do taco, após a preparação de 650 ms. O host simula a 120 passos por segundo; os clientes interpolam snapshots, sem física concorrente. A saída de um participante e o reinício são decididos pelo host.

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

As partidas vivem na memória do host. Encerrar o host, remover o canal ou trocar o ambiente encerra a sessão; não há retomada de partida após reiniciar o host. Não há matchmaking, editor de mapas, apostas com dinheiro, ranking ou persistência competitiva. A sinuca encerra por desconexão, sem reserva de 60 segundos.
