# Interface do Voxy · 2.0 em preparação e histórico 1.x

## Voxy 2.0 nativo — revisão atual, ainda não aprovada

Esta seção substitui a direção anterior para o desktop Rust. Base Voxy: grafite #111214, carvão #1c1e21, superfície elevada #32353b, prata #dedfe3 e texto #e9e9ec. Oceano/Bosque/Kuromi alteram fundo, materiais, reflexos e acentos; a arte temática licenciada completa ainda não foi migrada.

Home é uma central social, sem hero publicitário. Sidebar: 64 px; itens: 44×44, ícone vetorial 22 px; servidores: 38×38. Caption: 36 px; cada controle: 46×36, glifo vetorial de 12 px, close com hover vermelho e restaurar com estado real da janela. Avatar é sempre quadrado com alinhamento central, sem centralização que transforme largura/altura em Fill. Chat: canais 210 px, conversa flexível, participantes 172 px; rolagem independente e espaço reservado para scrollbar. Ações de mensagem aparecem no hover ou menu contextual.

Tipografia Segoe UI: corpo 13–14 px, auxiliares 11–12 px, títulos 20–25 px. Campos e toggles/sliders/selects/menus/scrollbars têm estilos próprios. Reservar separação entre estrutura de navegação, superfícies de conteúdo e controles; não usar botões primários como seleção de canal. Evitar banners, áreas de marketing e painéis elevados vazios.

Material implementado: composição Acrylic do Windows por janela + superfícies localizadas no renderer, com fallback opaco se DWM não aceitar e opção de redução de efeitos. Não equivale a refração óptica do Liquid Glass da Apple. [APIs documentadas da Microsoft](https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops) foram usadas; não há API privada de composição, WebView nem shader animado permanente. Um render pass wgpu com refração/blur próprio ainda precisaria ser prototipado/medido, especialmente pela integração futura do vídeo/3D; não está anunciado como entregue.

QA usa fixtures explícitas e pasta experimental vazia, dez participantes e histórico. Capturas em evidence/native-2.0/liquid-glass-reviewed; geometria real via Operation do Iced verifica avatares, itens de navegação e caption. Não são cliques humanos ou homologação de DPI/acessibilidade. Erros dos primeiros prints foram reconhecidos e corrigidos; a aprovação artística permanece pendente.

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
