# Interface do Voxy

## Voxy 1.5 — "Nocturne glass" no Electron

A 1.5.0 (Visual Update) leva para a arquitetura Electron a identidade criada nas betas nativas do Voxy 2.0 (`native/crates/voxy-desktop/src/design.rs` na branch `migration/2.0-native-audit`, hoje congelada). A referência foi usada apenas visualmente: voz, mídia, rede, IPC, persistência, 3D e jogos continuam os da 1.4.1.

### Arquivos

| Arquivo | Papel |
| :-- | :-- |
| `src/renderer/styles/tokens.css` | Tokens: superfícies, texto, estados de comunicação, tipografia, espaçamento, raios, sombras, camadas (z-index), movimento e "Reduzir efeitos". |
| `src/renderer/styles/nocturne.css` | Componentes (botões, campos, switch, slider, tooltip, avatar, presença, badges, diálogos, menus) e telas (barra de título, trilho, lateral, Home, chat, chamada, compartilhamento, hubs, mini perfil). Carregado por último. |
| `components/Personalization.tsx` | Paletas dos quatro temas e `themeVariables`, que aplica os tokens em tempo de execução (shell e prévia das configurações). |
| `style.css`, `design-system.css`, `room3d/rooms.css` | Estilos de funcionalidades da 1.x. As cores fixas foram convertidas para tokens por `scripts/tokenize-css.mjs` (Kuromi preserva sua paleta própria). |

Telas não definem cores, tamanhos ou sombras fora dos tokens.

### Tokens

| Papel | Voxy | Uso |
| :-- | :-- | :-- |
| `--vx-base` | `#0a0c11` | Barra de título e piso da janela |
| `--vx-rail` | `#0b0d12` | Trilho de servidores |
| `--vx-sidebar` | `#10131a` | Lateral (canais, DMs), navegação dos hubs |
| `--vx-canvas` | `#13161e` | Área principal, com recorte de 14 px no canto |
| `--vx-panel` | `#1a1e28` | Cartões, tiles, compositor |
| `--vx-elevated` | `#222734` | Menus, tooltips, diálogos, dock |
| `--accent` / `--accent-ink` | `#9b8cff` / `#06051a` | Ação principal, seleção, foco |
| `--text-primary` / `--text-muted` / `--vx-faint` | `#eceef3` / `#a3a8b6` / `#6c7180` | Texto principal, secundário, terciário |
| `--vx-speaking` | `#3ddc84` | Anel de fala, presença, conexão ok |
| `--vx-danger` | `#f2555a` | Mudo, ensurdecido, desconectar, destrutivo |
| `--vx-warning` | `#f5b94a` | Conectando, reconectando, ausente |
| `--vx-live` | `#ff4d5e` | Transmissão ao vivo |

Oceano (`#5fc8e6`), Bosque (`#a3cf7e`) e Kuromi (`#f39bcb` + lilás `#b89cf2`, superfícies ameixa e texto rosado) trocam acento e superfícies; fala, perigo, alerta e ao vivo são fixos. A cor principal personalizada continua sobrepondo o acento, com versão legível calculada. `tests/ui-themes.test.ts` verifica o contraste em todos os temas.

Tipografia Segoe UI Variable (local): 11, 12, 13, 14 (corpo), 15, 18, 22, 28. Controles e navegação em peso regular; rótulos e ações em 500–600. Espaçamento em passos de 4 px. Raios 6/10/14/20 e pílula. Área clicável mínima de 36 px (ícones de 30–34 px só em barras densas, sempre com tooltip).

### Materiais e efeitos

"Liquid glass" adaptado ao desktop, como na nativa: superfícies opacas com brilho superior de 3,5–5 % (`--vx-sheen-card`, `--vx-sheen-float`) e contorno de 1 px. Sombras só em camadas flutuantes (tooltips, menus, diálogos, dock da chamada). Não há `backdrop-filter`: o desfoque do fundo dos diálogos da 1.4 foi removido para não custar GPU durante jogos. "Reduzir efeitos"/modo de baixo consumo remove brilho e sombras. Animações limitadas a respostas de ação (abertura de diálogo 160 ms, tooltip 120 ms, switches); `prefers-reduced-motion` zera as durações.

### Componentes

- **Botões:** Primary (acento), Secondary (preenchimento discreto, padrão), Ghost, `icon-button`, estados `is-alert` (mudo/ensurdecido) e `is-active` (ligado). Estado nunca depende só de cor: microfone mudo troca o ícone.
- **Tooltip** (`components/Tooltip.tsx`): uma camada global lê o `title` existente, mostra um balão após 380 ms, ajustado à janela, sem alterar layout; preserva o nome acessível enquanto aberto.
- **Avatares:** sempre circulares e recortados (`object-fit: cover`); anel verde de fala com espaço reservado (sem deslocar layout); ponto de presença.
- **Switch:** todos os checkboxes são interruptores; **slider** com trilho de 4 px e preenchimento por `--fill`.
- **Dock da chamada** (`components/CallDock.tsx`): microfone e ensurdecer | câmera, trocar câmera, tela e qualidade | configurações | sair (vermelho). Mesmos handlers da 1.4.1.
- **Painel de participantes** (`components/MembersPanel.tsx`): no chat, "Em chamada" e "Online"; clique abre DM, botão direito abre o mini perfil.
- **Seletor de compartilhamento** (`components/ShareForm.tsx`): abas Aplicativos/Telas, miniaturas reais, aplicativo e título derivados do nome da janela, resolução do monitor (campo opcional `display` enviado pelo processo principal), qualidade segmentada e interruptor de áudio. Captura e seleção continuam as da 1.4.1.

### Estrutura

Barra de título 36 px (ícone original, "Voxy", versão, contexto; controles nativos do Windows, sem duplicação). Trilho 72 px: Início, Conversas, Amigos, Avisos, servidores (ícone circular com cor estável, pílula de seleção, disponibilidade, não lidas), criar e entrar; Novidades no rodapé. Lateral 252 px: cabeçalho do servidor com status, canais de texto/voz com participantes, cartão de voz (estado, sala, servidor, latência, diagnóstico, sair) e painel de perfil (microfone e ensurdecer ficam ocultos na tela da chamada, onde o dock os oferece).

Chamada: cabeçalho com canal, contagem e pílula de qualidade; grade 16:9 centralizada (tile até 440 px); com câmera ou tela ao vivo, a galeria ocupa o palco e os tiles viram uma faixa; a própria prévia local aparece usando o stream já existente. No modo 3D, a cena ocupa o palco e usa seu próprio dock.

### Verificação

Capturas antes (1.4.1) e depois em `evidence/1.5/visual/`, geradas por `tests/visual-tour.e2e.ts` com dois clientes Electron reais, perfis isolados e fontes de captura sintéticas. Comparação com `evidence/native-2.0/visual/after`. Escalas de DPI diferentes de 100 % dependem de homologação manual.

## Histórico visual 1.3–1.4 (substituído na 1.5)


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
