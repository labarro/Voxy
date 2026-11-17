# Interface do Voxy · 2.0 em preparação e histórico 1.x

## Voxy 2.0 nativo — "Nocturne glass" (implementado, 2.0.0 em preparação)

Código: `native/crates/voxy-desktop/src/design.rs` (tokens e estilos), `ui.rs` (componentes), `icons.rs` (Lucide), `chrome.rs` (janela e navegação), `call.rs`, `chat.rs`, `direct.rs`, `home.rs`, `admin.rs`. Telas não devem definir cores, tamanhos ou estilos fora desses módulos.

### Direção

Comunicação primeiro: a chamada, quem está falando e o estado da mídia são sempre legíveis. Interface escura em camadas opacas com leve brilho superior ("vidro" sem desfoque real), profundidade apenas em camadas flutuantes, acento por tema e estados de comunicação com a mesma cor em todos os temas. Sem cards em tudo, sem bordas em todo elemento, sem gradientes arbitrários, sem neon.

**Liquid Glass adaptado ao desktop:** superfícies opacas com gradiente vertical sutil (`sheen`, 3,5–5 % de branco no topo) e contorno de 1 px; sombras somente em tooltips, menus, popovers, diálogos e no dock da chamada. Não usamos Acrylic/Mica nem transparência da janela: com cliente translúcido o DWM desenhava os botões nativos atrás dos personalizados e o alfa acumulava em redesenhos parciais. Funciona no renderer de software tiny-skia, sem GPU. "Reduzir efeitos" remove brilho e sombras.

### Tokens

| Papel | Voxy | Uso |
| :-- | :-- | :-- |
| `base` | `#0a0c11` | Barra de título e piso da janela |
| `rail` | `#0b0d12` | Trilho de servidores |
| `sidebar` | `#10131a` | Lateral contextual (canais, DMs, seções) |
| `canvas` | `#13161e` | Área principal (recorte de 14 px no canto) |
| `panel` | `#1a1e28` | Cartões, tiles, compositor |
| `elevated` | `#222734` | Menus, tooltips, diálogos, dock |
| `accent` / `on_accent` | `#9b8cff` / `#06051a` | Ação principal, seleção, foco |
| `secondary` | `#6fd6c9` | Apoio |
| `ink` / `muted` / `faint` | `#eceef3` / `#a3a8b6` / `#6c7180` | Texto principal, secundário, terciário |
| `speaking` | `#3ddc84` | Anel de fala, presença online, conexão ok |
| `danger` | `#f2555a` | Mudo, ensurdecido, desconectar, destrutivo |
| `warning` | `#f5b94a` | Negociando, reconectando, ausente |
| `live` | `#ff4d5e` | Transmissão de tela ao vivo |

Temas Oceano (`#5fc8e6`), Bosque (`#a3cf7e`) e Kuromi (`#f39bcb` + lilás `#b89cf2`, superfícies ameixa) trocam acento e superfícies; `speaking`, `danger`, `warning` e `live` são fixos. Teste `design::tests::every_theme_keeps_readable_contrast`: texto ≥ 10:1 em todas as superfícies, texto secundário ≥ 4,5:1 (AA), texto sobre acento ≥ 7:1, indicadores ≥ 3:1.

Tipografia Segoe UI: 11 (micro), 12 (legenda), 13 (pequeno), 14 (corpo), 15 (destaque), 18 (cabeçalho), 22 (título), 28 (display). Espaçamento em grade de 4 (4, 8, 12, 16, 24, 32). Raios 6/10/14/20 e pílula. Área clicável mínima 36 px (ícones de 28–30 px só em barras densas, com tooltip).

### Componentes

- **Ícones:** Lucide (ISC) em SVG embutido no executável (`assets/icons`, extraídos por `scripts/extract-lucide-icons.mjs`), traço 2 em grade 24, renderizados por resvg e tingidos por estado. Nenhum caractere Unicode substitui ícone principal; nenhum acesso à internet.
- **Botões (`Tone`):** Primary (acento), Secondary (preenchimento discreto), Ghost (só no hover), Danger (desconectar/excluir), Active (alternância ligada), Alert (estado de risco ligado, ex.: microfone mudo). Estado nunca depende só de cor: microfone mudo troca o ícone para `mic-off`; pendente mostra `loader-circle`.
- **`icon_button`:** ícone + tooltip + id acessível `btn-<rótulo>` (usado também pelo E2E).
- **Tooltip:** fundo `elevated`, borda clara, sombra, atraso de 350 ms, ajuste aos limites da janela; nunca altera layout.
- **Avatar:** círculo com iniciais e cor estável por pessoa; anel verde de fala com espaço reservado (sem deslocar layout); selo vermelho com `mic-off`/`headphone-off`; ponto de presença.
- **Indicador de fala:** ativa com qualquer amostra confirmada (gate local após mute/PTT/sensibilidade ou nível decodificado do participante) e mantém 450 ms (suavização/histerese contra piscadas). Aparece na lista de canais, tiles, painel de membros, mini perfil, Home e painel de perfil.
- **Estados vazios:** ícone em selo de acento, título, explicação e ações reais; nunca conteúdo fictício.

### Estrutura

Barra de título 38 px (marca, contexto, controles únicos 46×38 com fechar vermelho). Trilho 72 px (Início, servidores com pílula de seleção, criar, entrar por convite, Novidades). Lateral 252 px: canais do servidor com participantes de voz; DMs na Home; seções nas Configurações. Rodapé da lateral: painel de conexão (sala, estado efetivo, latência, diagnóstico, sair) e painel de perfil (avatar, presença, microfone/ensurdecer — ocultos na tela da chamada para não duplicar o dock —, configurações).

Chamada: cabeçalho com canal, contagem e pílula de qualidade; grade adaptativa 16:9 (tile de voz limitado a 440 px), destaque com faixa lateral (≥ 900 px) ou inferior; tiles de vídeo real com "AO VIVO"/"CÂMERA", resolução e FPS; menu do participante com volume 0–200 %, mencionar e mensagem; dock flutuante: microfone, ensurdecer | câmera, tela | dispositivos, configurações | sair (vermelho).

### Verificação

Capturas antes/depois em `evidence/native-2.0/visual/before` e `after` (instâncias reais, tour com cliques). Regressão de renderização: `tests/render_damage.rs` e cenário `hover-50` sobre os pixels apresentados. QA geométrico do fixture visual verifica tamanhos de avatar, itens do trilho e controles de janela. Escalas de DPI diferentes de 100 % e homologação de acessibilidade com leitor de tela não foram testadas.

## Histórico visual 1.x



A direção é um espaço de comunicação entre amigos: discreto na estrutura e reconhecível na assinatura de frequência. O launcher oferece dois caminhos claros, entrar e hospedar. Ardósia e azul mineral substituem a base roxa; âmbar identifica acolhimento e conexão, verde indica presença e vermelho sinaliza ações destrutivas. Temas pessoais continuam disponíveis, sem copiar a composição de outro aplicativo.

## Fundamentos

| Papel | Valor padrão | Uso |
| :-- | :-- | :-- |
| Fundo de conteúdo | `#222c33` | Conversas e páginas |
| Superfície | `#1b252d` | Navegação, blocos e rodapés |
| Camada profunda | `#141e26` | Trilho e campos |
| Acento mineral | `#8dc7df` | Seleção, foco e ação principal |
| Sinal âmbar | `#d9b17c` | Hospedagem e assinatura gráfica |
| Texto principal | `#e9eff1` | Identidade e títulos |

Os papéis estão centralizados em `src/renderer/design-system.css`. Superfícies elevadas, seleção e hover derivam desses papéis por `color-mix`, acompanhando temas e cores pessoais. Os quatro temas existentes ficam em `components/Personalization.tsx`; não há fontes remotas ou novas bibliotecas.

Cada tema fornece todos os papéis semânticos por `themeVariables`, consumidos tanto pelo shell quanto pela prévia das configurações. Voxy usa ardósia/azul mineral; Oceano, azul profundo/névoa; Bosque, verde folha/madeira; Kuromi, grafite ameixa com **rosa luminoso `#ffa4d7`**, lavanda e texto rosado. Trocar de tema substitui a paleta completa, sem deixar cores do tema anterior. Cores pessoais são preservadas; o texto de acento recebe uma versão legível quando a cor escolhida tem pouco contraste, sem alterar sua cor salva.

O Kuromi usa duas ilustrações reais da [página oficial da Sanrio](https://www.sanrio.co.jp/characters/kuromi/), em arquivos locais, substituindo o emblema geométrico anterior. Há uma composição ilustrada no launcher, miniatura no seletor e galeria na página de aparência. Brilho rosa nos cards e um breve movimento da ilustração/estrelas respondem ao hover; não há partículas contínuas sobre mensagens nem animação infinita. `prefers-reduced-motion` desativa esses movimentos. Os créditos e fontes estão em [CREDITS.md](src/renderer/public/assets/themes/kuromi/CREDITS.md); as imagens pertencem à Sanrio e não integram a licença do código.

Tipografia: Segoe UI Variable Text no Windows compatível, Segoe UI como alternativa local. Corpo de 14 px, controles de 12–14 px, títulos de página de 25 px e título do launcher de 32–54 px. Textos longos do chat têm largura limitada a 78 caracteres aproximados. Informação secundária mantém peso menor e contraste próprio.

Espaçamento segue passos de 4 px, com 12–20 px entre controles e 24–36 px nas páginas. Controles usam raio de 7 px; painéis, 14 px. Bordas distinguem camadas e estados; sombras ficam reservadas a diálogos, menus e ações elevadas. Ícones Lucide mantêm a mesma linguagem dos controles existentes.

## Arquitetura de informação

O trilho principal identifica Início, Conversas, Novidades, Amigos e Avisos, seguido dos servidores e ações de acesso. A coluna contextual contém filtro de canais, conversas, salas e participantes. Identidade, mute, Deafen e configurações permanecem no rodapé. O cabeçalho Windows conserva os controles nativos sobre a mesma superfície e cor do tema.

Configurações usam um hub, com navegação, conteúdo e rodapé independentes. A busca procura nomes, descrições e palavras relacionadas, ignorando acentos. Trocar de seção mantém o rascunho. Salvar usa a persistência e os serviços existentes; desfazer restaura o perfil inicial; fechar descarta alterações não aplicadas. Temas são pré-visualizados dentro do hub e só alteram o aplicativo ao salvar.

| Grupo | Seções |
| :-- | :-- |
| Você no Voxy | Conta, Perfil, Aparência |
| Sua experiência | Áudio e Voz, Vídeo, Notificações, Atalhos, Salas 3D |
| Aplicativo | Windows, Privacidade, Atualizações, Avançado |

Áudio separa Dispositivos, Processamento e Sensibilidade. O teste privado de microfone continua acessível durante os ajustes. Conta cuida de nome e presença; Perfil concentra foto, emoji, cor do nome e capa. Atualizações têm uma seção própria. Privacidade explica o armazenamento e a transmissão atuais; não representa novos controles de privacidade nem criptografia adicional.

Administração usa a mesma estrutura: Geral, Imagem, Cargos, Canais de texto, Salas de voz, Ambientes 3D e Convites. Criar canais acontece dentro da página, sem abrir outro modal nem perder o contexto. Renomear, imagem, cargos e ambientes são aplicados imediatamente; exclusão de espaços continua exigindo confirmação. As permissões do host e do criador são preservadas no servidor. Cargos são identificadores e não concedem poderes administrativos novos.

## Estados e adaptação

Controles oferecem hover, foco por teclado e estado desabilitado. Campos de busca têm foco no conjunto, sem anéis duplicados. Seleção de página usa `aria-current`; alternância de áudio e temas usa `aria-pressed`. Diálogos nativos conservam Escape, contenção de foco e o mecanismo de retorno do navegador. Erros de edição preservam o rascunho e apresentam o motivo. A animação de abertura dura 150 ms; `prefers-reduced-motion` reduz transições.

Em janelas mais estreitas, o launcher passa de duas colunas para uma composição vertical; formulários reduzem colunas e o cabeçalho remove descrições secundárias. Os hubs limitam altura à janela, mantendo ações visíveis. A janela principal conserva o mínimo nativo de 900 × 640; não há promessa de layout de telefone. A partir de 1600 px, a navegação ganha espaço e as mensagens preservam largura confortável.

`style.css` conserva os estilos específicos das funcionalidades existentes; `design-system.css`, carregado depois, define os papéis e a composição compartilhada. `HubNavigation`, `ProfileForm` e `ServerManager` concentram a nova navegação. A camada de IPC, o motor de mídia e a sincronização de salas continuam os mesmos.

Capturas, testes executados e limitações ficam em [TESTING.md](TESTING.md). Não foram introduzidas dependências externas ou alterações nos modelos 3D nesta atualização.


## Execução contínua — 17/11/2026

**Design & Release Polish** obrigatório e adiado até conclusão funcional. Liquid Glass, paletas, reflexos e animações decorativas estão congelados. Implementar apenas interfaces necessárias aos fluxos e corrigir impedimentos de uso. Capturas verificam renderização/geometria, sem aprovação estética automática.


## Consolidação da retomada

Interfaces de anexo, galeria, controles de áudio/Windows e abertura de prévias foram adicionadas para uso funcional, preservando o congelamento estético. Não representam aprovação artística, paridade do avatar ou Design & Release Polish executado.
