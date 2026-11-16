# Materiais e interface nativa 2.0

Direção solicitada em 16/11/2026: produto novo, profundidade, vidro fosco controlado e acabamento nativo; preservar legibilidade e baixo consumo. A 1.x deixa de ser referência obrigatória de aparência, mas continua referência funcional.

Implementação: `voxy-desktop/src/design.rs`, `art.rs` e `platform.rs`. Home, navegação, chat, diálogo de criação, configurações, novidades e prévia dos temas compartilham os mesmos materiais. Não há animação contínua na Home. O fundo vetorial é cacheado; Windows Acrylic é opcional por janela e tem fallback, sem mudar configurações do sistema. O HRESULT de aplicação do material foi aceito nesta máquina; composição visual do sistema ainda exige avaliação humana.

| Papel | Valor base |
| --- | --- |
| Fundo profundo | `#10131e` |
| Vidro principal | `#202738`, alpha controlado |
| Vidro elevado | `#333e55`, gradiente/reflexo discreto |
| Acento de frequência | `#9bbdff` |
| Reflexo secundário | `#c0a9ec` |
| Texto | `#f0f2fa` |
| Texto secundário | `#a9b2c8` |

Tipografia Segoe UI, títulos semibold 30/48 px, corpo 14–16 px e labels 12–13 px. Navegação compacta de 88 px, conteúdo alinhado à esquerda e hero com assinatura de frequência vetorial. As cores dos temas Oceano, Bosque e Kuromi substituem acento/reflexo/fundo; a paleta Kuromi nativa ainda não inclui todas as ilustrações e personalizações da 1.x.

Ícones de navegação são vetores próprios com traço consistente, sem depender de emojis/fontes de símbolos. O atalho “Configurar minha voz” abre diretamente a seção de áudio. Trocar de seção ou dispositivo encerra o teste privado; desfazer restaura também o material visual salvo.

Botões têm estados normal/hover/pressionado/desabilitado; campos têm foco visível. O modo reduzido remove translucidez/gradientes/sombras dos painéis e desativa Acrylic. Overlays 3D, mini perfis, menus contextuais, notificações e vídeo terão de adotar os mesmos componentes ao serem migrados; não estão considerados prontos por existir este design system.

[Capturas da renderização nativa](../evidence/native-2.0/ui/ui-smoke.json), incluindo Home, chat, configurações e 900×640. Foram geradas pelo próprio aplicativo, sem navegador. A inspeção encontrou e corrigiu a altura do avatar na navegação. O controle externo da janela foi recusado pela ferramenta de Computer Use; as ações do smoke test são mensagens internas do aplicativo, não cliques humanos ou validação de acessibilidade do Windows.
