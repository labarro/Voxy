# Direção artística e assets das salas · 1.1.0

O lounge segue a ideia de um clube de bairro: madeira de tom nogueira, estofados ameixa, poltronas sálvia, tecidos claros, luminárias âmbar, janela e arte abstrata. O cinema usa a mesma linguagem de materiais, com contraste menor nas paredes, assentos ameixa e painéis acústicos. A arquitetura e a iluminação organizam o ambiente em torno da conversa e da tela; não há editor de mapas.

Foram avaliados os pacotes **Furniture Kit 2.0** e **Mini Characters 2.0** do Kenney. Os modelos escolhidos ficam junto ao aplicativo, sem CDN nem download durante o uso. As fontes oficiais identificam ambos como CC0: [Furniture Kit](https://kenney.nl/assets/furniture-kit) e [Mini Characters](https://kenney.nl/assets/mini-characters). Os textos originais das licenças estão em `src/renderer/public/assets/room3d/furniture/LICENSE.txt` e `characters/LICENSE.txt`. Não há uso da marca Kenney na interface nem indicação de endosso.

Subset incluído: nove modelos de mobiliário/decoração, cinco personagens com esqueleto e animações, uma paleta de textura e duas licenças. Total: **1.331.298 bytes**, antes da compressão de distribuição. A seleção de corpo/roupa é independente do cabelo. O renderer combina geometria e rig compatíveis, recolore regiões da paleta e acrescenta acessórios leves; esses ajustes ocorrem em memória, preservando os arquivos originais.

Os estofados complementares, perfis arquitetônicos, materiais de madeira/tecido, arte, paisagem da janela, painéis, letreiro da TV e luzes foram construídos no próprio renderer. Texturas procedurais são determinísticas e pequenas. Instancing reúne painéis acústicos, ripas e inserts repetidos de assentos. As sombras usam um mapa direcional, atualizado em frequência reduzida; o nível baixo preserva sombras de contato leves e desliga as dinâmicas/luzes de apoio.

`manifest.json` lista os arquivos e seus SHA-256. Recrie-o com `npm run assets:rooms3d` depois de alterar o subset. `npm test` confere os hashes, as licenças, o limite de 2 MiB e a existência de animações idle/walk/sit. Hashes dos ZIPs de origem usados na avaliação:

- Furniture Kit: `e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0`.
- Mini Characters: `add348e98ab9e23d9973c4740ef2c5cceb229c742106aca2d56b30a8f1241bb7`.
