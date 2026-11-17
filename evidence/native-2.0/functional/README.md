# Regras nativas e evidências funcionais — 17/11/2026

`voxy-games` contém as regras nativas dos três jogos, separadas da apresentação. `voxy-core::game_service` liga comandos autenticados a mesas por canal de voz. Isso **não conclui a paridade dos jogos físicos em 3D**: cenários, avatares, IK, animações, mira vinculada ao feltro e integração visual ainda precisam ser migrados. Nenhum popup substitui o ambiente.

## Oráculos diferenciais

Execute na raiz, com as dependências de desenvolvimento existentes:

```powershell
node --import tsx evidence/native-2.0/functional/generate-truco-fixtures.ts
node --import tsx evidence/native-2.0/functional/generate-pool-fixtures.ts
node --import tsx evidence/native-2.0/functional/generate-chess-fixtures.ts
node evidence/native-2.0/functional/verify-game-oracles.mjs
```

Depois execute `npm run native:test` e `npm run native:check`. Somente o desenvolvimento usa TypeScript/Node; não integram os executáveis Rust. Fixtures incluem hashes dos fontes de referência. Modificar o oráculo exige regeneração e revisão das diferenças, não apenas substituir a saída esperada para aprovar um teste.

| Jogo | Evidência efetivamente executada |
| --- | --- |
| Truco Paulista | 4 cenários, 742 operações, 3.710 snapshots específicos de espectadores/jogadores; 1.600 comparações de cartas/manilhas e 40 combinações de resultados de vaza. Partida inteira, cartas cobertas, 3/6/9/12, onze/ferro, privacidade de cartas, pausas, reservas de 60 s, abandono e revanche. Valores/erros/snapshots comparados integralmente. |
| Sinuca Rotação 7 | 4 cenários, 176 operações, 10.278 passos de física de 1/120 s. Abertura natural e vinte tacadas, bordas/colisões/atrito, vitória/revanche, primeiro contato incorreto, branca encaçapada e reposição sem colisão. Números comparados com tolerância absoluta 1e-7; estados, placar e mensagens exatos. Layouts controlados de teste constam explicitamente como `fixture.patch`; não são partidas físicas homologadas. |
| Xadrez | 17 cenários, 198 operações, 594 snapshots: turnos, deadline, mate, roques e ataque no caminho, en passant/expiração, quatro promoções explícitas, afogamento, material insuficiente, repetição 3/5, cinquenta/setenta e cinco lances, acordos, desistência, reconexão e revanche. Somente a ordem de enumeração de movimentos legais é normalizada; conteúdo, FEN, SAN, flags e demais estados são exatos. |

O caso legado de afogamento inicia com o rei preto já em xeque no turno branco (`7k/5K2/5Q2/...`); enumerar movimentos do jogador branco permite ao oráculo tentar capturar o rei e falhar na reconstrução do FEN. O diferencial usa uma posição legal equivalente, com a dama em f5 antes de `f5-g6`, preservando o mesmo resultado final. O legado não foi modificado. Não se afirma equivalência para posições iniciais inválidas que a biblioteca nativa recusa.

## Autoridade, privacidade e recursos

`Action::Game { channel, command }` exige sessão autenticada e participação no canal de voz correspondente. O ator deriva da sessão; não existe campo para escolher outro jogador. Ações validam assento, turno, revisão e fase. Snapshots de jogos são filtrados por canal/identidade; cartas privadas de Truco nunca entram em um snapshot compartilhado. Espectadores recebem mão vazia; onze revela apenas o parceiro autorizado; ferro oculta inclusive a mão do próprio jogador.

O teste `room::tests::game_authority_scopes_voice_channels_hands_replay_and_departure` usa seis identidades locais, nega espectadores/atores incorretos, confere cartas únicas e filtragem entre canais, repete comandos sem duplicar entradas e valida saída/reserva/expiração. `game_service::tests::failed_joins_cannot_exhaust_arenas_and_fractional_steps_are_preserved` confirma limpeza após quarenta entradas inválidas, conservação de frações de tempo e catch-up limitado a doze passos. São testes de código local; não equivalem a partidas em vários computadores.

Partidas permanecem voláteis, como a referência. Recibos de jogos têm limite de 1.024 por serviço e não prometem recuperação após reiniciar o host. Há no máximo 32 arenas. `advance_games` é chamado pelo ator de rede; `games_need_fast_tick` distingue animação/física de espera. Catch-up após travamento fica limitado a 100 ms para impedir laços ilimitados; a simulação desacelera durante stalls em vez de consumir tempo ilimitado. Sair explicitamente do canal abandona os assentos; interrupção de rede mantém a reserva de Truco/xadrez por 60 s, enquanto a sinuca conserva a política de abandono imediato.

## Dependências e licença

Movimentos legais, validação de xeque e SAN usam **cozy-chess 0.3.4**, fixado exatamente em Cargo.toml e Cargo.lock, com **cozy-chess-types 0.2.2** transitivo. Ambos têm licença MIT nos pacotes obtidos pelo Cargo. Fontes upstream: [cozy-chess 0.3.4, manifesto/licença](https://docs.rs/crate/cozy-chess/0.3.4/source/Cargo.toml), [API](https://docs.rs/cozy-chess/0.3.4/cozy_chess/), [cozy-chess-types 0.2.2](https://docs.rs/crate/cozy-chess-types/0.2.2/source/Cargo.toml). A biblioteca limita o relógio de cinquenta lances a 100; o adaptador Voxy mantém contador próprio e preserva a política legada de reivindicação em 100 e empate automático em 150, sem usar `Board::status()` para declarar empate prematuro.

Truco e sinuca são portes do código MIT existente do Voxy. A revisão de toda a árvore transitiva e o pacote de avisos da distribuição permanecem necessários antes de publicar.
