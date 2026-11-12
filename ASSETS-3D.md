# Direção artística e assets das salas · 1.2.0

## Reconstrução da 1.2.0

A inspeção dos GLB e do renderer identificou móveis já completos recebendo assentos/encostos adicionais e uma rotação extra de π em `prop()`. A 1.2 remove essa composição: sofás, poltronas e puffs agora são construções próprias, com uma base, almofadas, um encosto, braços e pés, no mesmo grupo e eixo frontal +Z. Decoração continua usando o subset CC0. [Inspeção estrutural dos modelos originais](evidence/rooms3d-1.2.0/model-inspection.json).

Os avatares atuais são modelos procedurais próprios, sem novos assets externos ou dependências. Pivôs de cabeça, ombros, cotovelos, quadril e joelhos articulam roupas e acessórios; a saia acompanha o quadril ao sentar. Cabeça redonda/oval usa elipsoide e a quadrada usa caixa arredondada. Olhos achatados, sobrancelhas e curva da boca calculam a profundidade pela superfície da cabeça. Cabelos, peças superiores/inferiores/calçados, barba e acessórios usam geometrias distintas. Os GLB de personagem da 1.1 permanecem no acervo/licenças, mas não são carregados pelos avatares da 1.2.

A sinuca usa mesa e tacos próprios, bolas de baixa complexidade, tecido verde e madeira da paleta do Lounge. A fumaça usa sprites pequenos com textura radial procedural, transparência e dissipação, sem luzes ou física adicionais. Peças rígidas do avatar e assentos são unidas por material dentro de cada pivô para reduzir chamadas de desenho; geometrias arredondadas têm subdivisões limitadas. Não há arquivos novos de modelo ou textura para baixar.

## Acervo preservado e licenças

O lounge segue a ideia de um clube de bairro: madeira de tom nogueira, estofados ameixa, poltronas sálvia, tecidos claros, luminárias âmbar, janela e arte abstrata. O cinema usa a mesma linguagem de materiais, com contraste menor nas paredes, assentos ameixa e painéis acústicos. A arquitetura e a iluminação organizam o ambiente em torno da conversa e da tela; não há editor de mapas.

Foram avaliados os pacotes **Furniture Kit 2.0** e **Mini Characters 2.0** do Kenney. Os modelos escolhidos ficam junto ao aplicativo, sem CDN nem download durante o uso. As fontes oficiais identificam ambos como CC0: [Furniture Kit](https://kenney.nl/assets/furniture-kit) e [Mini Characters](https://kenney.nl/assets/mini-characters). Os textos originais das licenças estão em `src/renderer/public/assets/room3d/furniture/LICENSE.txt` e `characters/LICENSE.txt`. Não há uso da marca Kenney na interface nem indicação de endosso.

Subset incluído: nove modelos de mobiliário/decoração, cinco personagens com esqueleto e animações, uma paleta de textura e duas licenças. Total: **1.331.298 bytes**, antes da compressão de distribuição. Na 1.1, o renderer combinava geometria e rig compatíveis, recoloria regiões da paleta e acrescentava acessórios em memória. A 1.2 preserva esses arquivos como acervo, mas usa a modelagem própria descrita acima.

Os estofados complementares, perfis arquitetônicos, materiais de madeira/tecido, arte, paisagem da janela, painéis, letreiro da TV e luzes foram construídos no próprio renderer. Texturas procedurais são determinísticas e pequenas. Instancing reúne painéis acústicos e ripas. Os inserts adicionais de assentos da 1.1 foram removidos na 1.2. As sombras usam um mapa direcional, atualizado em frequência reduzida; o nível baixo preserva sombras de contato leves e desliga as dinâmicas/luzes de apoio.

`manifest.json` lista os arquivos e seus SHA-256. Recrie-o com `npm run assets:rooms3d` depois de alterar o subset. `npm test` confere os hashes, as licenças, o limite de 2 MiB e a existência de animações idle/walk/sit. Hashes dos ZIPs de origem usados na avaliação:

- Furniture Kit: `e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0`.
- Mini Characters: `add348e98ab9e23d9973c4740ef2c5cceb229c742106aca2d56b30a8f1241bb7`.
