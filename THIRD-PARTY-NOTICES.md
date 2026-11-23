# Componentes dos jogos sociais

O Voxy 1.4.0 usa chess.js 1.4.0 para validar xadrez no host. Fonte: https://github.com/jhlywa/chess.js/tree/v1.4.0. A [licença BSD-2-Clause integral](src/renderer/public/assets/licenses/chess.js.txt) acompanha os assets empacotados e a dependência. Mesas, peças de xadrez, arte do baralho, Rooftop e sons sintetizados desta atualização são construídos pelo próprio código do Voxy; não introduzem imagens ou gravações externas.

# Personagens e animações 3D (1.6.0)

Os corpos dos avatares (base masculina e feminina), cabelos, sobrancelhas, barba e clipes de animação vêm de **Universal Base Characters (Standard)** e **Universal Animation Library (Standard)**, de [Quaternius](https://quaternius.com), publicados sob **CC0 1.0 Universal** (domínio público). O texto da licença e a descrição das conversões ficam em [`src/renderer/public/assets/room3d/avatars/LICENSE.txt`](src/renderer/public/assets/room3d/avatars/LICENSE.txt); o manifesto `assets/room3d/manifest.json` registra tamanho e SHA-256 de cada arquivo. Os arquivos foram convertidos para GLB, com texturas reduzidas e reencodadas em WebP, e só um subconjunto das animações é incluído (`tools/avatar-assets/build.mjs`). Roupas, penteados adicionais, rig de mandíbula/olhos/sobrancelhas, acessórios, bebidas, móveis, ambientes e texturas procedurais são criados pelo próprio código do Voxy. O crédito é voluntário; não há endosso do autor.

# Codificador GIF (1.7.0)

Fotos e capas animadas que excedem o limite são reencodadas com **gifenc 1.0.3**, de Matt DesLauriers, sob licença **MIT** (https://github.com/mattdesl/gifenc). O [texto da licença](src/renderer/public/assets/licenses/gifenc.txt) acompanha os assets empacotados.
