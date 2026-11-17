# iced_tiny_skia 0.14.1 — patch local do Voxy

Cópia de `iced_tiny_skia 0.14.1` (MIT, crates.io) aplicada via `[patch.crates-io]`.

Defeito: sombras de quads eram pintadas fora da região de dano. `Layer::damage`
usava apenas `quad.bounds.expand(1)` e `Engine::draw_quad` desativava a máscara de
recorte quando o quad cabia na região de dano, mesmo com a sombra excedendo-a. A
cada redesenho parcial (hover, tooltip) a sombra era composta de novo sobre
pixels não limpos, escurecendo a área de forma acumulativa.

Alteração: `engine::painted_bounds` (quad ∪ sombra) no cálculo de dano e na
decisão de recorte. Nenhuma outra mudança. Remover quando o upstream corrigir.
Regressão: cenário `hover-50` do voxy-e2e (pixels do desktop composto).

Causa principal: o pixmap da sombra era desenhado com máscara `None` em
`Engine::draw_quad`, sem nenhum recorte. Como o pixmap cobre também a área sob
o quad, qualquer redesenho parcial que tocasse um painel com sombra escurecia o
painel inteiro (alfa 0,24 por redesenho); só as regiões de dano limpas eram
restauradas. Agora usa a mesma máscara do quad.
