# Interface nativa 2.0

A especificação vigente está em [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md). A direção azulada/editorial do primeiro incremento foi substituída por grafite/prata, Home social compacta, navegação fixa, caption vetorial, chat em três colunas e estilos próprios. Não há aprovação artística do usuário ainda.

[Capturas preenchidas e bounds do renderer](../evidence/native-2.0/liquid-glass-reviewed/ui-smoke.json). Fixtures são explícitas e não carregam rede/microfone. Somente uma pasta de dados experimental vazia é aceita pelo smoke; o uso normal não semeia dados simulados.

O acabamento usa Acrylic documentado, translucidez localizada e fallback opaco. Refração física/custom shader wgpu não foi implementada nem prometida. Sem renderização contínua quando estático. DPI físico, acessibilidade e validação humana ainda precisam de homologação.
