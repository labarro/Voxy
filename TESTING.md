# Validação do Voxy

## Versão 1.2.0 — 12/11/2026

Passaram `npm test` (**53 testes**), `npm run build`, `npm run pack`, `test:rooms3d`, `test:rooms3d:app`, `test:rooms3d:packaged`, `test:rooms3d:visual`, `test:audio`, `test:media`, `test:controls` e `test:ptt`. O build mantém o aviso conhecido do chunk Three.js carregado sob demanda. A [publicação externa](https://github.com/labarro/Voxy/releases/tag/v1.2.0) foi concluída pelo [workflow](https://github.com/labarro/Voxy/actions/runs/43309471907); os cinco arquivos e o endpoint foram verificados. [Assinatura e hashes](evidence/publication-1.2.0.json).

- **Causas estruturais:** inspeção dos GLB confirmou que os assentos importados já continham geometria completa. O renderer adicionava outro assento/encosto e uma rotação extra de π. Essa composição foi substituída por um único móvel por grupo. O rosto deixou de depender de offsets fixos de modelos diferentes; detalhes acompanham a superfície da cabeça própria. [Dados da inspeção](evidence/rooms3d-1.2.0/model-inspection.json).
- **Visual:** capturas de frente, lado, costas, rosto aproximado, postura sentada, cigarro e catálogo com 12 cabelos e roupas variadas foram inspecionadas. As inspeções levaram a correções de cabelo cobrindo olhos, mechas salientes, luminária sobre a mesa, drapeado da saia sentada e fumaça. Os ambientes foram capturados em visão ampla e pelo lado frontal dos assentos; caminhada, sentar/levantar, órbitas e enquadramento da TV passaram. As colisões de câmera têm testes geométricos, incluindo recuperação e restauração após assistir.
- **Sinuca:** testes de física exercitam contato, parada, tacada reproduzível, encaçapada válida, pontuação, vitória, branca encaçapada, contato errado e reposição. Dois clientes Socket.IO recebem o mesmo estado final; turno/revisão inválidos, usuário distante e outro canal são rejeitados. Observador tardio recebe a mesa atual; desconexão reinicia o jogo. Em **dois processos Electron**, também no pacote ASAR, os jogadores caminharam até a mesa, entraram pela interface e executaram uma tacada com mira/força. Os snapshots finais foram comparados integralmente. Isso é multiplayer local real, sem ensaio entre computadores pela VPN.
- **Criador e interações:** diferenças reais de geometria nas opções; rascunho/aplicar/cancelar/restaurar, desfazer, salvar/aplicar visual substituindo campos opcionais, acessórios combinados e recuperação de contexto gráfico. O segundo processo recebeu a personalização e o cigarro virtual. A preferência de ocultar cigarro/fumaça foi exercitada na interface e no modelo.
- **Regressões:** TV sintética decodificada por WebRTC, webcam, fullscreen, Esc, modo assistir e tradicional sem recapturar microfone; áudio privado/reconexão, volumes, mute/Deafen e atalhos globais. O ensaio de mídia conectou 45 pares e recebeu voz nos 90 sentidos, tela/webcam para nove espectadores e ciclos de saída/reentrada. PTT global verificou F9, Q, Mouse 4/5. Contratos verificam novidades 1.1 → 1.2 uma vez e igualdade de pacote, lock, saída, README e catálogo.

Capturas e resultados: [lounge](evidence/rooms3d-1.2.0/lounge.png), [cinema](evidence/rooms3d-1.2.0/cinema.png), [catálogo](evidence/rooms3d-1.2.0/character-catalog.png), [criador](evidence/rooms3d-1.2.0/creator.png), [sinuca no pacote](evidence/rooms3d-1.2.0/pool.png) e [relatório](evidence/validation-1.2.0.json).

### Desempenho e limites

Medição isolada, Edge/ANGLE, 1024 × 600, dez avatares (cinco andando), 2 s de aquecimento e 4 s de amostragem. A comparação carrega **todos os módulos da tag v1.1.0**, evitando misturar código antigo e novo. Na NVIDIA GeForce RTX 5060 Ti/D3D11:

| Qualidade | FPS 1.1 → 1.2 | Draw calls 1.1 → 1.2 | Triângulos 1.1 → 1.2 |
| :-- | :-- | :-- | :-- |
| Baixo | 23,0 → 23,0 | 145 → 344 | 25.850 → 47.080 |
| Médio | 37,5 → 37,5 | 171,9 → 423,4 | 31.730 → 58.541 |
| Alto | 54,2 → 54,7 | 163,6 → 398,4 | 29.914 → 54.930 |

O cenário maior e os avatares articulados custam mais chamadas/geometria; os FPS permaneceram equivalentes nesta GPU, sem afirmar ganho universal. A primeira implementação 1.2 tinha 472 chamadas/99.128 triângulos no baixo; união de peças por pivô/material e subdivisões limitadas reduziram esses custos. Geometrias e texturas registradas pelo renderer retornaram a zero no descarte. Isso não mede toda a RAM/VRAM do processo.

Com SwiftShader, a implementação otimizada mediu cerca de 23/11/11 FPS: mantenha **Baixo** ou o modo tradicional quando não houver aceleração. Faltam GPUs integradas/de entrada, sessões prolongadas, redes entre PCs físicos, microfones reais e avaliação acústica humana. As fontes de mídia são sintéticas. O pacote foi executado em diretórios isolados; o NSIS não foi instalado sobre a instalação pessoal. A sinuca usa regras simplificadas documentadas e não oferece efeitos, salto, persistência da partida ou física de competição.

## Versão 1.1.0 em preparação — 11/11/2026

Passaram `npm test` (**49 testes**), `npm run build`, `test:rooms3d`, `test:rooms3d:app`, `test:gallery`, `test:audio`, `test:controls`, `test:ptt` e `test:media`. O build mantém um aviso de tamanho do chunk Three.js, carregado sob demanda. Após autorização para publicação, `npm run pack` e `test:rooms3d:packaged` passaram localmente, tanto com GPU quanto com SwiftShader explícito. As primeiras execuções do CI pararam em timeouts e não publicaram. Os diagnósticos mostraram salas renderizadas e reconexão de mídia sob a carga dos dois renderizadores por software. A integração usa SwiftShader no nível Baixo recomendado e minimiza a janela inativa para exercer a pausa gráfica normal do aplicativo, mantendo os dois clientes e a chamada. Isso não equivale a medir dois renderizadores simultâneos em PCs físicos. As medições de médio/alto continuam separadas. A última versão distribuída continua sendo a 1.0.0 até concluir a release 1.1.0.

- **Salas e câmera:** renderização dos dois ambientes com GLB locais, caminhada real por teclado, sentar/levantar, reserva de assento no host, modos acompanhar/explorar, zoom/rotação com limites e amortecimento, colisão com obstáculos e recuperação. Testes de câmera verificam o enquadramento completo da TV em proporções largas e verticais e a restauração do ângulo/zoom/foco anterior após assistir.
- **Criador:** preview WebGL do mesmo avatar da sala, categorias/cards/paletas, roupas e cabelo independentes, animação, aplicar/cancelar/restaurar sem persistir o rascunho antes de aplicar. Perda de contexto gráfico induzida e recarga do preview preservaram as escolhas. Hashes, CC0, arquivos e clips idle/walk/sit dos assets foram conferidos.
- **Dois processos Electron reais:** configuração do preset pelo host, entrada automática, ocupação remota, movimento e troca tradicional/3D sem nova chamada a `getUserMedia`. Mudanças de cabelo/roupa foram salvas e recebidas no outro cliente durante a chamada, também sem recapturar o microfone. Fullscreen da sala, Esc nativo, abertura do criador a partir do fullscreen, mute/Deafen e mudança lounge/cinema passaram.
- **TV:** fonte sintética enviada por WebRTC entre os processos; pixels decodificados no player, enquadramento assistir, ampliação, fullscreen da transmissão, Esc e retorno. A TV usa a assinatura existente e o vídeo da textura é mudo; o áudio permanece no caminho de reprodução original. A webcam continua na galeria. A suíte espacial mede atenuação e panorama com oscilador/analisador Web Audio e restaura a mistura tradicional no fallback.
- **Regressões:** 45 pares mesh, pacotes de voz nos 90 sentidos, tela/webcam para nove espectadores, suspensão/retomada de vídeo sem cortar voz, dois ciclos de transmissão e três ciclos de saída/reentrada. Ganho, teste privado, reconexão TCP, volumes individuais, atalhos globais e Deafen passaram. PTT global verificou pressionar/soltar F9, Q, Mouse 4 e Mouse 5. A galeria verificou ampliação, controles, responsividade e liberação. Contratos confirmam novidades uma vez por versão, persistência após reinício e igualdade entre notas, README, pacote, lock e diretório de saída.

Capturas inspecionadas do aplicativo Electron: [lounge](evidence/rooms3d-1.1.0/lounge.png), [cinema](evidence/rooms3d-1.1.0/cinema.png) e [criador](evidence/rooms3d-1.1.0/character-creator.png). Foram refinados a iluminação, os estofados, o mapeamento de cores/cabelos, a orientação do preview, a altura de sentar e o piso sob a câmera após avaliar as imagens. O teste de caminhada espera a instrução contextual aparecer, evitando depender de uma duração fixa em renderização por software.

Na preparação da release, um bloqueio transitório `EPERM` na troca do arquivo SQLite foi reproduzido localmente. A persistência passou a usar temporários exclusivos e tentativas limitadas para EPERM/EACCES/EBUSY, sem excluir o destino. Três testes verificam recuperação, preservação do arquivo anterior em bloqueio persistente e propagação imediata de outros erros. O banco restaura as foreign keys após exportar mesmo se a gravação falhar.

Por decisão do mantenedor, o fluxo de publicação usa a integração 3D empacotada já aprovada localmente e não repete esse ensaio gráfico no runner virtual do GitHub. As tentativas no runner encontraram timeouts e limitações de janela/fullscreen; não são registradas como aprovação. O CI continua obrigatório para contratos, build/assinatura e persistência do executável empacotado. `npm run test:rooms3d:packaged` permanece disponível localmente.

### Desempenho antes/depois

`test:rooms3d:performance` compara a cena da tag **v1.0.0** com a implementação atual. Execuções isoladas e sequenciais, Edge/ANGLE, viewport **1024×600**, **dez avatares**, cinco caminhando, sem transmissão, aquecimento de 2 s e amostragem de 4 s por qualidade. Draw calls e triângulos são médias dos quadros, incluindo atualizações do mapa de sombra. É um ensaio curto e reproduzível, não um teste de duração nem de computadores medianos.

GPU real desta máquina: **NVIDIA GeForce RTX 5060 Ti / D3D11**.

| Qualidade | FPS 1.0 → 1.1 | Draw calls 1.0 → 1.1 | Triângulos 1.0 → 1.1 |
| :-- | :-- | :-- | :-- |
| Baixo | 23,0 → 23,0 | 240 → 145 | 42.156 → 25.850 |
| Médio | 37,5 → 37,5 | 240 → 172,6 | 42.156 → 31.888 |
| Alto | 54,7 → 54,7 | 240 → 163,4 | 42.156 → 29.877 |

Os limites configurados são 24/40/60 FPS; o agendamento real não garante alcançar esses tetos. No baixo houve cerca de **40% menos draw calls** e **39% menos triângulos**, apesar do ambiente mais detalhado. O número de geometrias caiu de 230 para 124–125; as texturas subiram de 12 para 36–39 com materiais, modelos e skeletons. Os contadores de geometrias/texturas retornaram a zero ao descartar cada cena; isso não mede a RAM do processo nem a VRAM total.

**Limite encontrado:** com SwiftShader, sem GPU acelerada, baixo manteve 23,0 FPS, mas médio caiu de 37,5 para **10,2 FPS**, e alto de 42,3 para **9,2 FPS**. Sombras, iluminação e materiais custam mais na emulação. Use **Baixo** ou a visualização tradicional nesse cenário; a 1.1 não deve ser apresentada como mais rápida em todo hardware. Medições completas, identificação do renderer, CPU de submissão e verificações estão em [validation-1.1.0.json](evidence/validation-1.1.0.json).

### Limites e verificação manual pendente

As fontes de mídia são sintéticas; estes resultados não equivalem a escuta humana ou microfones físicos. Faltam sessões prolongadas com PCs distintos pela VPN, GPUs integradas/de entrada, webcam e transmissões de alta resolução simultâneas, além de avaliação acústica. O modo tradicional permanece disponível e a perda de contexto da sala foi testada sem encerrar a chamada. Webcams ficam fora do fullscreen exclusivo do ambiente. Não foi executado um instalador nem um novo binário empacotado; o atualizador e sua assinatura não foram alterados.

Antes de autorizar uma publicação, validar esses cenários nos computadores de destino e revisar o acabamento visual com o grupo. O fluxo de distribuição permanece o de [AGENTS.md](AGENTS.md), após autorização específica.

## Correções de identidade incorporadas à 1.0.0 — 24/10/2026

Correção local confirmada pelo usuário: os atalhos de Menu Iniciar e Desktop apontam ao Voxy instalado, com ícone explícito de `resources/icon.ico` e AppUserModelID `dev.voxy.desktop`. O atalho Electron que apontava ao runtime do projeto foi guardado em backup, e sua entrada inválida retirada do Menu Iniciar. A interface instalada foi observada aberta com o título Voxy. Não houve troca do executável instalado ou remoção dos dados pessoais.

As correções separaram desenvolvimento/produção, mantiveram os dados instalados em `voxy-desktop`, definiram ícone e comando de reabertura da janela e recriaram o atalho do Menu Iniciar no instalador. Abertura manual e retorno após atualizar mostram a janela. A preparação 0.8.1 não foi publicada separadamente; essas correções integram a 1.0.0.

## Versão 0.8.0 publicada — 24/10/2026

Passaram `npm test` (34 testes), build e integrações de áudio, controles globais, captura, grade, sistema, UX, desktop com três instâncias e WebRTC com dez clientes. `npm run pack` e `npm run test:packaged` também passaram: o ASAR abre, o host funciona, o ícone da bandeja está incluído e perfil/servidores/DMs/leitura/novidades sobrevivem ao reinício.

O [Actions da release](https://github.com/labarro/Voxy/actions/runs/40116916004) concluiu testes, geração/assinatura dos metadados, instalador, teste do executável empacotado e [publicação dos cinco assets](https://github.com/labarro/Voxy/releases/tag/v0.8.0). O canal público entrega 0.8.0: assinatura Ed25519, hash do manifesto, notas e checksum do instalador em relação ao digest do GitHub foram conferidos com as funções de produção. Evidência: [publication-0.8.0.json](evidence/publication-0.8.0.json). Não houve instalação NSIS pessoal nem download local do instalador.

- Captura: loopback real do Windows em monitor e janela, sem substituir `getDisplayMedia`. Dois processos geraram tons de 440/880 Hz. A track confirmou `restrictOwnAudio: true`, estéreo a 48 kHz, sem filtros de voz. No ensaio concluído, o tom externo ficou próximo de −44 dB, e o tom do Voxy em −96/−83 dB (piso de ruído). Evidências em `test-results/capture-audio-*/result.json`. Não equivale a avaliação humana de áudio ou teste de microfone físico.
- Controles: combinação Ctrl+Shift+M e Mouse 4 globais com janela minimizada, ausência de repetição ao segurar, mute anterior restaurado ao sair de Deafen, prioridade sobre PTT, persistência e barra Kuromi. Maximizar/restaurar foram verificados por API nativa.
- Notificações: menções, respostas, DMs e amizades entre dois clientes, abertura e destaque da mensagem, supressão da conversa visível, leitura persistida. Testes de contrato cobrem reinício, tipos, DND e silêncios. Objetos nativos do Windows foram criados com `show` interceptado para conferir o encaminhamento sem exibir toasts no desktop do usuário.
- PiP: janela nativa com câmera local e webcam/tela remotas. Quadros continuam aumentando com o Voxy oculto; terminar a fonte fecha o PiP. Sem nova captura ou conexão para destacar o vídeo.
- Bandeja: callbacks reais de abrir/Deafen/Sair, fechar sem desconectar, restauração da janela e término do processo. Ambientes com `VOXY_DATA_DIR` não alteram a inicialização pessoal do Windows.
- WebRTC: 45 pares, voz nos 90 sentidos, tela/webcam para nove espectadores, pausa sem espectadores e limpeza dos dez clientes. Os cenários que medem sons da chamada desativam os novos sons de atalhos para isolar as verificações.

Pendentes de verificação manual: inicialização após login real, hover/arraste/redimensionamento nativos, avaliação acústica com hardware físico, jogos elevados/anticheat e uso prolongado em computadores distintos via Radmin. Guias: [áudio](AUDIO-E-CONEXAO.md), [notificações e Windows](NOTIFICACOES-E-WINDOWS.md).

## Versão 0.7.0 — 23/10/2026

O [Actions da release](https://github.com/labarro/Voxy/actions/runs/40014696269) concluiu com sucesso os 29 testes, a geração do instalador e dos metadados assinados, o teste do executável empacotado e a publicação dos cinco assets. [Release 0.7.0](https://github.com/labarro/Voxy/releases/tag/v0.7.0).

Passaram localmente: build, contratos, microfone Web Audio, PTT global, áudio/reconexão, desktop com captura nativa, três clientes sociais, grade de mídia e dez clientes WebRTC (45 pares / 90 sentidos de voz). O teste da grade verifica duas telas com webcam, foco/retorno, controle individual, segundo plano e liberação de trilhas. O teste social verifica temas, capas, cargos, amizade, aceite de chamada, respostas, menções, reações e busca.

O canal público de atualização entrega 0.7.0; a assinatura Ed25519 e o SHA-512 do manifesto foram conferidos com as funções de produção. O checksum publicado corresponde ao digest do instalador informado pelo GitHub. Evidência: `evidence/publication-0.7.0.json`. O binário não foi instalado na máquina pessoal; o smoke test do executável ocorreu no CI. Validação com os microfones físicos dos usuários e testes prolongados em computadores distintos continuam pendentes.


## Versão 0.6.0 — 21/10/2026

Passaram: `npm test` (**24 testes**), `npm run build`, `npm run test:ptt`, `npm run test:microphone`, `npm run test:audio`, `npm run test:media`, `npm run test:desktop`, `npm run test:ux`, `npm run dist` e `npm run test:packaged`.

- Microfone: teste privado antes da call e durante a call, edição de supressão de ruído/eco, ganho, persistência e encerramento de todas as capturas. Durante o teste, o microfone enviado ficou mutado; fechar as configurações restaurou o estado anterior. Os dispositivos de captura dessa suíte são os dispositivos de teste do Chromium. A qualidade acústica em hardware físico não foi aferida.
- Web Audio: oscilador/analisador reais verificaram ganho proporcional, gate, silêncio em volume zero e liberação de tracks. Dois participantes com grafos separados: 200% dobrou a amplitude de um e manteve o outro inalterado. O limitador é transparente para sinais baixos; não usa makeup gain automático.
- Windows: injeção Win32 de F9, Q, Mouse 4 e Mouse 5 detectada pelo leitor global, incluindo soltar, reconfigurar, validar entrada e fechar. Jogos elevados/anticheat específicos continuam pendentes.
- Reconexão: proxy TCP entre cliente Electron e host real interrompeu o transporte. Servidor e canal de voz foram restaurados, sem participantes duplicados e com volume/identidade mantidos. Desconexão voluntária cancelou o retorno. Indisponibilidade persistente encerrou em cinco tentativas e não voltou ao reabrir o transporte. O teste não substitui queda real de internet/Radmin entre máquinas físicas.
- Menu: cartão sem controles de áudio expostos, menu próximo ao clique, 0–200% salvo, mute local e fechamento ao clicar fora/Esc. Capturas do menu e do teste privado inspecionadas. Novidades/DMs/recentes continuam funcionando, inclusive em 900×620.
- Links: clicar no link do chat e no crédito chegou ao shell do Electron pelo IPC validado; a chamada ao shell foi interceptada somente no teste para evitar abrir o navegador pessoal. URLs de arquivos e esquemas perigosos foram rejeitados. Parsing preservou pontuação e texto original.
- Dez clientes: 45 pares e voz nos 90 sentidos, tela/webcam para nove espectadores, dois ciclos de tela, três reentradas e recursos liberados. Sons de início/fim geraram sequências distintas para todos; snapshots repetidos, efeitos desativados, deafen e outros canais não geraram sons extras. Uma execução concorrente atingiu timeout de pixels (10 s); a execução completa isolada passou. As asserções antigas das melodias foram atualizadas para os novos sons.
- Regressão desktop: três janelas com imagens, perfis, edição/exclusão, mute/deafen/PTT, volumes, captura desktop nativa, player/HUD e webcam com dispositivo de teste. Uma espera de ícones duplicados foi corrigida no teste, mantendo ambos os indicadores no produto.
- Pacote: executável abriu duas vezes com SQLite; Mouse 5, ganho/sensibilidade, ruído/eco desativados, volume individual 200%, mute local, recentes, identidade e DMs persistiram. Envelope Ed25519, manifesto e hashes SHA-512 conferidos com a chave pública de produção.

Build local anterior à publicação: `release/0.6.0/build-1792602244932/Voxy-Setup-0.6.0-x64.exe`, **126631173 bytes**, SHA-256 `375B4F8FF8B59F1F2688EC0D28B0A2ABEE73E9CEB0CA2F400AAB8E5F95E7C432`. Evidência em `evidence/validation-0.6.0.json`. O instalador na raiz `release/0.6.0` agora é a cópia verificada da publicação abaixo. O teste diferencial específico da linha 0.5 é histórico; a validação pública desta versão usou cache vazio e download completo.

### Publicação 0.6.0 — 21/10/2026

O [Actions](https://github.com/labarro/Voxy/actions/runs/39642305199) concluiu com sucesso: 24 testes, build NSIS, assinatura dos metadados, abertura/reabertura do executável e persistência de Mouse 5, ajustes de áudio e volume individual de 200%. A [release 0.6.0](https://github.com/labarro/Voxy/releases/tag/v0.6.0) contém os cinco assets obrigatórios.

O atualizador real, usando versão de origem 0.5.0, cache isolado, transporte HTTPS e chave pública de produção, passou por checking → available → downloading → ready pelo domínio. Catálogo e manifesto responderam 200; assinatura Ed25519, SHA-512, checksum e digests dos cinco assets foram conferidos. O histórico de novidades inclui a 0.6.0, e o crédito do criador permanece fora das notas da versão. Nenhum instalador foi executado.

Instalador público: `release/0.6.0/Voxy-Setup-0.6.0-x64.exe`, **126.631.101 bytes**, SHA-256 `A025A6DBDB55DF7A80367463C3102EF102F3F821F0D6C5A071C9959FB796DA6F`. Evidência: `evidence/publication-0.6.0.json`. O executável continua sem Authenticode; o envelope tem assinatura Ed25519.

Pendentes: avaliação audível com microfones/fones físicos e dos níveis dos efeitos, jogos/anticheat específicos, dez PCs pelo Radmin, chamadas prolongadas e instalação/reinício NSIS real sobre uma instalação existente. Nenhum instalador foi executado na instalação pessoal. Veja [Áudio e conexão](AUDIO-E-CONEXAO.md).


## Versão 0.5.0 — 20/10/2026

Passaram: `npm test` (**22 testes**), `npm run test:ux`, `npm run test:desktop` com webcam de teste, execução separada com `VOXY_TEST_NATIVE_MEDIA=1`, `npm run test:media`, `npm run test:dev`, `npm run dist`, `npm run test:packaged` e `npm run test:updater`.

- Navegação: Novidades → mesmo canal, outro canal e servidor; Home → canal; DMs → servidor/canal. Nenhum canal fica ativo enquanto a página de novidades está aberta. Servidores salvos aparecem na mesma barra esquerda e a reconexão funciona. Um servidor temporário foi fechado: tentar reconectar a ele preservou a conexão e a voz da outra sala.
- Presença: Online/Ausente/Ocupado escolhidos pela interface, salvos e vistos nos outros dois clientes. A voz permaneceu conectada durante as alterações. Perfis antigos recebem Online; valores desconhecidos são rejeitados.
- DMs: três processos Electron com renderer de produção. Texto, imagem, edição/exclusão, badge, aviso e leitura em foco funcionaram. Ocupado preserva contadores sem popup; voltar a Online não reapresenta o aviso silenciado. Reabrir o destinatário preservou identidade e histórico, e reconectar pela lateral entregou uma mensagem enviada durante sua ausência.
- Privacidade: o terceiro cliente não recebeu o conteúdo das DMs nem conseguiu buscar sua imagem privada. Autorias e escopos incorretos foram rejeitados; copiar UUID com credencial errada ou ausente foi recusado após o vínculo inicial. O histórico persistiu ao reabrir o SQLite. Cache rejeita mensagens destinadas a outro perfil e mantém leituras separadas por sala; arquivos corrompidos são preservados para diagnóstico. A chave local é protegida e a credencial difere entre salas.
- Offline/responsividade: host fechado manteve texto e miniaturas locais; envio ficou desativado, com orientação para reconectar. Lista de recentes e disponibilidade continuaram visíveis em 900×620, sem rolagem horizontal. Foto do servidor teve dimensões iguais às do botão e `object-fit: cover`, sem padding interno. Capturas locais foram inspecionadas visualmente.
- Regressão: dez clientes WebRTC, 45 pares, quatro transceivers por par e voz nos 90 sentidos; tela/webcam para nove espectadores, dois ciclos de tela e três saídas/reentradas. Três janelas Electron exercitaram imagens públicas, edição, mute local, deafen, PTT global, volume, fullscreen e HUD. A execução sem dispositivos de mídia de teste validou captura desktop nativa para dois espectadores; webcams físicas continuam pendentes.
- Pacote: abriu duas vezes com SQLite e dependências incluídas, preservando perfil, foto, volumes, PTT, filtro de entrada, webcam preferida, servidor, imagem, recentes e aviso de versão. Também preservou presença Ausente, identidade privada, histórico de DMs e marcador de não lidas. Backup inclui cache privado e identidade. O teste de atualização NSIS exercitou diferencial e fallback completo sem executar a instalação.

Evidência dos testes locais: `evidence/validation-0.5.0.json`. O pacote local original permanece na pasta de staging indicada por `latest-build.json`; o instalador na raiz `release/0.5.0` agora é a cópia verificada da publicação abaixo.

### Publicação 0.5.0 — 20/10/2026

O [GitHub Actions](https://github.com/labarro/Voxy/actions/runs/39525732143) concluiu com sucesso: 22 testes, build NSIS, assinatura Ed25519 dos metadados, abertura/reabertura do executável e persistência, incluindo identidade e DMs. Os cinco assets foram publicados na [release 0.5.0](https://github.com/labarro/Voxy/releases/tag/v0.5.0).

O atualizador real, simulando a versão instalada 0.4.1 em cache isolado, consultou o domínio público e passou por checking → available → downloading → ready. Catálogo e manifesto responderam 200; assinatura de produção, hashes SHA-512, digests dos cinco assets e checksum SHA-256 foram conferidos. Nenhum instalador foi executado.

Instalador publicado: `release/0.5.0/Voxy-Setup-0.5.0-x64.exe`, **126.626.487 bytes**, SHA-256 `84A029FEC3CF5ACDF7C8C87BF217F89058AAAE74913179726912CBBE38ADAB53`. Evidência: `evidence/publication-0.5.0.json`. O executável permanece sem Authenticode.

Pendentes: instalação/reinício NSIS real sobre uma instalação pessoal em Windows de teste, dez computadores físicos pelo Radmin, webcams físicas, áudio audível e chamadas prolongadas sob upload limitado. A notificação nativa depende das permissões e do modo de concentração do Windows; o aviso e os contadores dentro do aplicativo foram testados. DMs não são E2EE: o host é confiável e mantém o banco em texto claro. Os limites de cache e o funcionamento offline estão em [CONVERSAS-E-STATUS.md](CONVERSAS-E-STATUS.md). As seções abaixo são históricas.

## Publicação 0.4.1 — 20/10/2026

A [execução de publicação](https://github.com/labarro/Voxy/actions/runs/39516455777) terminou com sucesso: instalação limpa de dependências e binários verificados do Electron, 18 testes, build NSIS, assinatura dos metadados, teste de abertura/reabertura do ASAR e publicação dos cinco assets na [release 0.4.1](https://github.com/labarro/Voxy/releases/tag/v0.4.1). A tentativa 0.4.0 falhou antes de publicar porque Electron 44 não inclui mais o download implícito dos binários; a 0.4.1 adiciona o postinstall explícito e a etapa idempotente no workflow, preservando a tag anterior.

O `RemoteUpdates` e o `NsisUpdater` reais foram executados contra o domínio público, em perfil/cache isolados e com versão de origem 0.4.0 para exercitar o fluxo. Sem substituir o transporte nem a chave pública de produção, passaram por checking → available → downloading → ready. O catálogo assinado e o instalador público foram verificados; nenhuma instalação foi executada. Os dois endpoints responderam 200 depois dos redirects.

Instalador publicado: `release/0.4.1/Voxy-Setup-0.4.1-x64.exe`, **126.614.876 bytes**, SHA-256 `A98DCA686223F0720AB9A3831E0314D3FB9EA2EBFC163A2BC70D888D7F7C8283`. Os cinco arquivos públicos foram copiados e verificados nessa pasta; o build local original permanece na pasta de staging indicada por `latest-build.json`. O executável permanece sem Authenticode, e o envelope tem assinatura Ed25519.

Evidência: `evidence/publication-0.4.1.json`. Ainda pendentes: instalação/reinício NSIS real numa máquina de teste, dez PCs físicos pelo Radmin, webcams físicas, avaliação audível e duração prolongada. As validações locais e limitações abaixo são históricas e continuam aplicáveis.

## Versão 0.4.0 — 20/10/2026

Passaram: `npm test` (**18 testes**), `npm run test:microphone`, `npm run test:ptt`, `npm run test:media`, `npm run test:desktop`, `npm run test:dev`, `npm run dist`, `npm run test:packaged` e `npm run test:updater`.

- Contratos, migrações e autorização: imagem adicionada, removida e persistida; outro perfil impedido de alterá-la. Migração atribui servidores legados ao host sem apagar mensagens. O protocolo 2 é exigido para evitar misturar clientes com três e quatro trilhas de mídia.
- Recentes: convites cifrados com DPAPI/safeStorage, metadados disponíveis sem rede, remoção respeitada após novos snapshots, arquivo corrompido preservado e disponibilidade autenticada sem ocupar vaga. Home reconecta usando o convite salvo. O pacote reaberto mantém a imagem e pode hospedar novamente pelo recente.
- Dez clientes WebRTC reais no Edge, com fontes de teste: **45 pares, quatro transceivers por par e pacotes de voz nos 90 sentidos**. Pixels de webcam e tela recebidos por nove espectadores simultaneamente, dois ciclos de tela e três saídas/reentradas. Trocar/parar/reiniciar câmera, negar permissão e encerrar a track preservam a voz. As fontes de teste são canvas/áudio gerado, exclusivamente nos testes.
- Três janelas Electron: UI real de câmera, seleção/troca, prévia, recepção, fullscreen, desligamento e reinício em paralelo à tela. O modo padrão usa dispositivos de mídia de teste do Chromium para câmera/microfone. A execução separada com `VOXY_TEST_NATIVE_MEDIA=1` desativa esses dispositivos de teste e valida a captura desktop nativa em dois ciclos para dois espectadores; não testa webcam física. Regressões de PTT, mute local, deafen, volumes, imagens, modais, edição/exclusão de mensagens e HUD também passaram.
- Novidades: versões 0.2.0, 0.3.0 e 0.4.0 com data/categorias disponíveis sem sala; popup não repete na segunda abertura. Catálogo remoto só entra após validação de assinatura.
- Atualizador: testes rejeitam assinatura falsa, payload alterado, repositório diferente, caminho inesperado, metadados divergentes, replay de versão antiga e instalador modificado após download. Verificam fallback da consulta, cache offline e backup antes de reiniciar. Nenhum pacote é instalado durante download.
- Download diferencial **com NsisUpdater real**, instaladores NSIS reais 0.3.0/0.4.0 e servidor local com HTTP Range: **88 requisições Range**, **13.397.238 bytes transferidos** para um instalador de **126.614.367 bytes** (economia arredondada de **89%**). Sem instalador anterior no cache, houve fallback completo, com verificação final bem-sucedida. O teste usa chave efêmera isolada, não altera a confiança de produção e não executa o instalador.
- Produção: ASAR aberto duas vezes; perfil, foto, tecla Q, volumes, mute local, entrada/sensibilidade, câmera preferida, servidor/imagem e recentes preservados. Cinco arquivos de main/preload/renderer conferem byte a byte com o build empacotado. Envelope de publicação validado com a chave pública de produção e hashes SHA-512 conferidos.

Instalador: `release/0.4.0/Voxy-Setup-0.4.0-x64.exe`, **126.614.367 bytes**, SHA-256 `9CCBD31D11FE3C696DEC36C70529BFE64EEB6B1C96946B334C1632272CCA888A`. O `.exe` permanece **NotSigned** no Authenticode; os metadados remotos têm assinatura Ed25519. [Guia remoto](ATUALIZACOES-REMOTAS.md).

**Pendências reais:** publicar o código/workflow do Voxy e executar uma publicação pública pelo Actions e validar a instalação/reabertura automática sobre uma versão instalada em Windows de teste. Nenhuma instalação pessoal foi substituída. Também faltam dez PCs físicos pelo Radmin, webcams físicas diferentes, áudio audível entre máquinas, duração prolongada e qualidade sob upload limitado. A economia diferencial depende dos blocos/cache e não é garantia para outras versões. NSIS não oferece rollback automático de banco nem garantia de recuperação de instalação interrompida.

Infraestrutura configurada em 20/10/2026: portfólio publicado na main (`3ac5886`), duas rotas de atualização respondendo com 307 ao GitHub e site respondendo 200. Ambiente `release` com segredo de assinatura e acesso restrito a tags `v*` confirmado via API. O aplicativo foi reempacotado com o endpoint canônico `www.devbarros.com`, e os testes unitários, de pacote e de atualização diferencial/fallback passaram novamente.

Resumo de evidências sem imagens privadas em `evidence/validation-0.4.0.json`. Relatórios detalhados e capturas locais ficam em `test-results/`, ignorado pelo Git. As seções abaixo são históricas.

## Versão 0.3.0 — 20/10/2026

Executados com sucesso: `npm test` (10 testes), `npm run test:microphone`, `npm run test:ptt`, `npm run test:media`, `npm run test:desktop`, `npm run test:dev`, `npm run build`, `npm run dist` e `npm run test:packaged`.

- Contratos/host/SQLite: migração sem perder histórico, coluna de edição, autoria obrigatória inclusive para o host, rejeição de mensagem vazia sem imagem, propagação de edição/exclusão e remoção da imagem junto da mensagem. Foto validada por formato/dimensões/tamanho, deduplicada por hash, referenciada no estado e preservada após reabrir o banco. Preferências antigas recebem os novos padrões.
- Microfone em Web Audio real, com fonte senoidal de teste: sinal baixo bloqueado (RMS 0), sinal forte liberado (RMS ≈0,142), volume 25% entrega ≈0,035, redução de ruído abaixo do limiar volta a RMS 0, desativar detecção libera o sinal baixo e volume zero silencia. Tracks terminam ao fechar. Teste unitário verifica histerese, retenção e alternância da detecção.
- PTT Windows: F9 e Q detectadas globalmente ao pressionar/soltar, troca de configuração, entrada inválida rejeitada e estado limpo ao parar. No Electron, a tecla foi capturada pela interface e enviada ao helper/IPC; volume/limiar/detecção foram salvos.
- Dez clientes WebRTC: 45 pares e voz nos 90 sentidos, dois ciclos de tela para nove espectadores, voz mantida depois de parar e três reentradas. Mute local silencia somente uma voz, mantém volumes, sobrevive a deafen e não afeta o áudio da transmissão. O teste de pixels agora aguarda o quadro da nova fonte após `replaceTrack`, pois pode existir um quadro antigo no buffer.
- Sons: aviso de início de transmissão para os dez participantes, inclusive o transmissor, sem repetir em snapshots iguais; parar/reiniciar avisa novamente. Outros canais, opção desligada e deafen não geram o aviso. Entrada/saída continuam com sequências próprias.
- Três janelas Electron: foto escolhida de arquivo, reduzida para 128 px, salva e exibida nos outros clientes; emoji continua disponível. Imagem do chat ampliada, mensagem editada/excluída com atualização remota e cancelamento da confirmação preservando a imagem. Configurações, imagem, edição, confirmação e menu de áudio tiveram centralização verificada geometricamente.
- Mute local pelo clique direito: aparece só no cliente que o escolheu, permanece após reconectar o participante e pode ser removido. O ícone de deafen aparece em todos os clientes nos cartões e lateral, coexiste com microfone mutado e desaparece ao reativar a audição. Selo lateral **AO VIVO** verificado e inspecionado visualmente.
- Captura desktop nativa em dois ciclos, dois espectadores, áudio/transmissão independentes e fullscreen com vídeo igual à viewport. Após 2,5 s a HUD fica com `visibility: hidden`; mover o mouse a torna visível. Controles continuam acessíveis a 900×620.
- Pacote ASAR abre duas vezes, cria host SQLite, mantém foto, volumes, mute local, PTT Q, volume de entrada, detecção e limite após reinício; novidades aparecem somente na primeira abertura da versão. Código main/preload/renderer do ASAR confere com o build validado.

Instalador: `release/0.3.0/Voxy-Setup-0.3.0-x64.exe`, 126.944.290 bytes, SHA-256 `7124FC361DF7E09ED8715E2DAD3D31E4E69715AACA782EA57206B251599C397A`, sem assinatura (`NotSigned`). Guias: [atualização](GUIA-DE-ATUALIZACAO.md) e [instalação/conexão](INSTALACAO-E-CONEXAO.md).

Ainda precisam de validação humana: dez computadores físicos pelo Radmin, instalação NSIS por cima de uma instalação pessoal real, qualidade audível em ambientes ruidosos, detecção com diferentes microfones/ganhos do Windows, duração prolongada, layouts de teclado incomuns e jogos/programas elevados. Fn, atalhos interceptados pelo sistema e distinção de Enter numérico/principal não são garantidos. Fontes senoidais e canvas são usadas somente nos testes, não no produto.

## Versão 0.2.0

Testes locais passaram com dez clientes, 45 pares mesh, voz nos 90 sentidos e pixels corretos nos nove espectadores em dois ciclos. Push to Talk foi verificado no gate real do microfone, com prioridade do mute manual; o leitor global do Windows detectou F9 pressionada/solta e liberou o estado ao encerrar. A geração dos sons produziu sequências distintas de entrada/saída e ficou silenciosa com a preferência desligada ou deafen.

Na interface Electron, imagens foram enviadas/recebidas/ampliadas, o avatar 👴 foi escolhido como opção individual, o volume de voz foi mantido após nova sessão do participante e o volume/mute de transmissão funcionou separadamente. O retângulo do vídeo em fullscreen foi conferido contra a viewport: origem 0,0 e dimensões iguais às da tela. Captura nativa continuou em dois ciclos para dois espectadores.

Nove testes automatizados de serviço/contratos incluem migração do histórico antigo, imagens persistidas e limites de arquivo, rejeição do décimo primeiro participante, versão de atualização, SHA-256, detecção de alteração posterior, backup sem modificar os dados e notas apresentadas uma vez por versão. O teste de reinstalação NSIS sobre a instalação pessoal existente permanece manual; não foi executado para substituir a instalação do usuário. Dez computadores físicos pelo Radmin, qualidade audível, desempenho prolongado e atalhos com jogos/programas elevados também permanecem pendentes.

O fluxo completo de PTT foi exercitado no Electron: alteração da preferência, tecla F9 global no Windows, passagem pelo main/IPC, indicação de fala aberta e retorno ao estado fechado ao soltar. A janela de 900×620 foi inspecionada e os controles de chamada permaneceram visíveis, sem rolagem horizontal. O executável ASAR 0.2.0 abriu duas vezes: volumes de voz/transmissão, PTT, tecla e som desativado persistiram, e o popup só apareceu na primeira abertura. Main, preload e renderer do pacote foram comparados ao build validado.

Instalador final: `release/0.2.0/Voxy-Setup-0.2.0-x64.exe`, 126.937.176 bytes, SHA-256 `48430E89365EB4E6FD860F6C5205DBF6E0312BB417CF1E63B90E9D27E4612964`, sem assinatura digital (`NotSigned`).

Os relatórios de versões anteriores abaixo são históricos. O guia de distribuição e atualização atual é [GUIA-DE-ATUALIZACAO.md](GUIA-DE-ATUALIZACAO.md).

## Atualização 0.1.1 — Radmin VPN e cinco pessoas

`npm test` passou com validação de convites 26.x, rejeição de endereços malformados e seleção de interface: um 26.x de Ethernet comum não é oferecido para hospedar, enquanto o adaptador Radmin é priorizado. A integração aceitou cinco sessões autorizadas e rejeitou a sexta antes de executar as regressões de canais e persistência.

`npm run test:media` passou com cinco clientes, dez pares WebRTC, três transceivers por par e voz recebida nos 20 sentidos. Dois ciclos de vídeo sintético tiveram pixels corretos nos quatro espectadores; voz continuou nos 20 sentidos após parar. Três ciclos de reentrada do quinto cliente reconectaram seus pares. Não foi usado Radmin real neste ambiente: a conexão entre computadores pela VPN continua pendente.

O instalador desta atualização fica em `release/0.1.1/`, acompanhado de `SHA256SUMS.txt`. Os resultados abaixo de três participantes e do instalador 0.1.0 são o histórico da validação inicial, não uma alegação de captura nativa com cinco computadores.

Build e empacotamento 0.1.1 passaram. O teste do executável final passou em duas aberturas, com host SQLite e perfil persistidos. Main, preload e renderer dentro do ASAR foram comparados ao build validado. Instalador: 126.923.604 bytes, SHA-256 `CF138B467673CE2D1F446A5712C99B1A86A6C52A487DF98E3F98A6839D957D3F`.

Execução em Windows x64 build 26200, Node 24.13.0, Electron 44.9.0, Edge 155.0.4283.62. Sessão iniciada em 19/10/2026 no fuso America/Sao_Paulo; registros JSON usam UTC (20/10/2026). O relatório distingue capacidade implementada, teste automatizado local e validação em computadores distintos.

## Resultados automatizados

| Comando                       | Escopo                                                                                    | Resultado                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `npm test`                    | 2 suítes: convites/validação e integração com host SQLite + três clientes Socket.IO reais | Passou                                          |
| `npm run test:media`          | Três páginas Edge com motor WebRTC de produção; SDP/ICE/DTLS/RTP locais                   | Passou                                          |
| `npm run build`               | TypeScript estrito, main/preload, renderer Vite/Tailwind                                  | Passou                                          |
| `npm run test:desktop`        | Três instâncias do Electron com build de produção, fontes de captura nativas              | Passou                                          |
| `npm run dist`                | electron-builder + instalador NSIS x64                                                    | Passou; artefato final em `release/0.1.0/`      |
| `npm run test:packaged`       | Executável em ASAR, host, SQLite e persistência após reinício                             | Passou, duas aberturas do binário final         |
| `npm run test:dev`            | Vite e Electron em perfil isolado                                                         | UI, React Refresh e preload abrem sem pageerror |
| `npm audit --omit=dev --json` | Dependências de runtime                                                                   | 0 vulnerabilidades reportadas                   |

`npm audit --json` completo reportou 8 alertas moderados na cadeia **de desenvolvimento/empacotamento** electron-builder → @electron/get → global-agent/roarr → sprintf-js. Não são dependências de runtime distribuídas. Não foi aplicado downgrade automático do builder sugerido pelo audit. Não há garantia de ausência de vulnerabilidades fora do banco de advisories.

### O que os testes provaram

Sinalização: convites com IP público/wildcard e segredo inválido rejeitados; quarto cliente rejeitado; CRUD restrito ao host; criação/renomeação/exclusão de canal; escrita e recebimento de texto real; payload excessivo rejeitado; encaminhamento SDP limitado ao canal; três participantes na mesma voz; oito ciclos de entrar/sair; saída de pessoa refletida; reabertura do SQLite preserva texto; chaves estrangeiras e exclusão em cascata preservadas após exportar o banco.

Motor de mídia: três conexões mesh reais, exatamente três transceivers por par, pacotes de áudio recebidos nos seis sentidos. Dois ciclos de tela sintética em canvas (cores diferentes), pixels corretos recebidos nos dois espectadores via RTP. Pacotes de voz continuam aumentando nos seis sentidos após parar a tela. Mute/desmute altera a track; três ciclos de saída/reentrada do terceiro participante voltam a conectar; saída remove peer connections, mic, screen e AudioContext.

**As fontes sintéticas existem somente no teste de navegador.** A função de captura de tela é substituída dentro da página de teste para conferir pixels determinísticos; nenhuma simulação é incluída no produto. Esse teste sozinho não comprova desktopCapturer ou qualidade humana de som.

Integração desktop: três janelas Electron reais em loopback, perfis isolados, convite copiado pela interface e conexão dos outros clientes. Microfone adquirido pela implementação real. Monitor capturado via desktopCapturer/getDisplayMedia, sem `--use-fake-device-for-media-stream`. Quadros com dimensões reais recebidos por ambos os espectadores em dois ciclos. Fechar player preserva a chamada; parar e iniciar novamente funciona. Mute responde e os três saem do canal. Sem `pageerror` de JavaScript. Não foi feita avaliação humana de áudio nem estimativa confiável de latência física.

Evidências locais reproduzíveis em `test-results/media.json`, `desktop.json` e screenshots `viewer-*.png`. Esses arquivos são ignorados pelo Git porque podem conter capturas privadas do desktop. REA tem sua evidência sanitizada versionada em `evidence/discord-rea.json`. Não distribua screenshots de teste sem revisão.

### Falhas encontradas e corrigidas

- Sandbox do ambiente bloqueou criação de processos do compilador/browser: execução repetida com a permissão específica da ferramenta, sem desativar sandbox do Electron.
- Sinais podiam chegar antes de o participante criar o par: fila pequena e limitada adicionada.
- Criar transceivers antes da oferta nos dois lados gerava slots não associados: somente o offerer cria, answerer adota os recebidos. Teste verifica contagem e áudio nos seis sentidos.
- Objetos `RTCSessionDescription` não passavam corretamente pela ponte de contexto: serialização explícita `toJSON()` corrigiu SDP no aplicativo.
- Track de áudio de tela sem pacotes podia bloquear playback de vídeo: reprodução foi separada.
- Seletores ambíguos e player já aberto no segundo ciclo foram corrigidos no teste, sem mudar a funcionalidade para satisfazer o teste.
- `sql.js.export()` reinicia PRAGMAs: chaves estrangeiras reativadas e teste de exclusão em cascata adicionado.
- Rebuild do instalador encontrou `EBUSY` em arquivos ASAR de saídas anteriores. Nenhum processo do projeto estava aberto na inspeção; a distribuição final foi gerada em pasta versionada com a distribuição Electron local validada, sem encerrar processos alheios ou desabilitar proteção do Windows.

O artefato final tem 126.923.218 bytes e SHA-256 `B0C4D2DEBE1E9A910C59F78F1BDADCB4DD72DD1E7D145E5B3D435A10B91CD274`. A assinatura foi verificada pelo PowerShell como `NotSigned`. O executável empacotado abriu duas vezes, carregou o WASM dentro do ASAR, criou/recuperou servidor, perfil e segredo DPAPI. O assistente NSIS não foi executado em uma máquina limpa; isso continua no roteiro físico.

## Roteiro obrigatório em três computadores

Marque os resultados com data, versão, Windows, microfone, GPU, IP Radmin VPN, rede/upload e tempo de chamada. Todos os itens abaixo permanecem **pendentes de validação física**.

| #   | Procedimento                                                                  | Critério de aceitação                                                                 |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Instalar o EXE em A, B e C e iniciar                                          | Sem Node instalado; perfil e UI abrem                                                 |
| 2   | A hospeda no IP Radmin VPN e cria servidor                                    | B/C conseguem conectar com o convite, sem porta pública                               |
| 3   | A cria canal de voz; todos entram                                             | Três nomes visíveis em todos                                                          |
| 4   | A fala; B responde; C responde                                                | Todos ouvem os outros com clareza, sem retorno indesejado                             |
| 5   | Cada um muta e desmuta                                                        | Mutado não chega aos amigos; indicação acompanha                                      |
| 6   | B silencia recebimento e restaura                                             | B deixa de ouvir, depois volta; sua voz continua conforme mute                        |
| 7   | Trocar entrada/saída, volume e desconectar USB                                | Dispositivo escolhido funciona ou erro explícito; recuperar ao selecionar outro       |
| 8   | A compartilha monitor 720p/30 com IDE e texto em movimento                    | B/C recebem conteúdo legível, conversando ao mesmo tempo                              |
| 9   | B fecha player, continua falando e abre outra vez                             | Voz continua e vídeo reaparece                                                        |
| 10  | A para e reinicia tela 10 vezes                                               | Voz permanece; tracks e uso de recursos não crescem continuamente                     |
| 11  | Compartilhar janela, fechar/minimizar fonte, usar parada nativa quando houver | Encerra quando o SO informa `ended`; fonte congelada pode exigir Parar manual         |
| 12  | C entra depois de a transmissão começar                                       | C recebe voz e vídeo sem A reiniciar                                                  |
| 13  | Testar 720p/15, 1080p/30 e 1080p/60 e mudar qualidade durante captura         | Métricas efetivas observadas, sem promessa de atingir 60 FPS                          |
| 14  | Incluir áudio de sistema e tocar um som conhecido                             | B/C ouvem o som; identificar eco; desligar se recapturar a chamada                    |
| 15  | A/B transmitem simultaneamente, C alterna                                     | Players corretos; somente áudio da tela selecionada; voz independente                 |
| 16  | C sai/volta 10 vezes; depois A encerra                                        | Listas atualizam; recursos são liberados; encerramento do host encerra a sala         |
| 17  | Desligar/religar Radmin VPN e Wi-Fi                                           | Estado reflete falha; ICE tenta recuperação; sessão perdida exige nova entrada na voz |
| 18  | Rejeitar permissão de microfone no Windows                                    | Erro visível; nenhuma chamada ou captura fictícia                                     |
| 19  | Chamada de 30–60 min, CPU/GPU/upload e screenshots das métricas               | Sem crescimento progressivo de recursos ou travamento; registrar perdas, FPS e RTT    |
| 20  | Reiniciar A e hospedar novamente                                              | Servidores/canais/chat e segredo persistidos; preferências B/C preservadas            |

Para a versão 0.1.1, repita o roteiro com A, B, C, D e E na mesma rede Radmin, incluindo os quatro espectadores e os 20 sentidos de voz. Para sinais bloqueados: valide TCP na porta escolhida, rede Radmin/firewall, endereço e segredo. Para ICE sem conectar: valide UDP entre todos os IPs e permissão do executável no firewall. Use o estado da rede no Radmin, `ping IP_RADMIN` e `Test-NetConnection IP_RADMIN -Port 43120`. Não use sucesso de TCP ou da prévia local como prova de recepção de tela. Use o diagnóstico de cada espectador e confirme visualmente um relógio/texto alterando em A.

## Reproduzir sem contaminar o perfil pessoal

`test:desktop` e `test:packaged` usam diretórios isolados dentro de `test-results/`. O teste de sinalização usa uma pasta temporária que ele mesmo cria e remove. Nenhum teste deve apontar para `%APPDATA%/voxy-desktop`. Feche janelas e capture somente conteúdo de teste; o teste desktop usa a fonte nativa selecionada e pode registrar seu monitor em screenshots locais.

## Verificações das salas 3D (1.0.0 publicada)

A [publicação 1.0.0](https://github.com/labarro/Voxy/releases/tag/v1.0.0) concluiu o [workflow 43038013587](https://github.com/labarro/Voxy/actions/runs/43038013587) com sucesso. Passaram os 40 testes, a geração do instalador e catálogo assinado, a persistência no executável ASAR e o fluxo 3D/TV em dois executáveis empacotados. Instalador, blockmap, manifesto, checksum e catálogo foram baixados; SHA-256/SHA-512, assinatura Ed25519 e notas correspondem à tag e ao pacote 1.0.0. O endpoint público entrega a mesma versão e o mesmo manifesto. Evidência: [publication-1.0.0.json](evidence/publication-1.0.0.json). O instalador foi baixado, mas não executado sobre a instalação pessoal.

`npm test` inclui geometria/colisões, atenuação e direção espacial, validação de perfil, host real com três clientes Socket.IO, permissões, entrada sem sobreposição, reserva concorrente de assentos, isolamento das posições por canal, seleção compartilhada da TV com troca ao encerrar uma fonte, liberação de assentos, persistência do ambiente e aviso de novidades uma vez. `npm run test:rooms3d` exercita renderização WebGL, movimento, assentos, TV com MediaStream sintético, personalização e fallback gráfico. `npm run test:rooms3d:app` usa duas instâncias isoladas do Electron com sinalização, captura sintética e WebRTC reais: configuração do canal, perfil persistente, entrada automática, movimento, participantes, troca de visualização sem nova captura de microfone, mute, Deafen, vídeo remoto decodificado na TV/player e mudança simultânea de ambiente. Depois de `npm run pack`, `npm run test:rooms3d:packaged` repete esse fluxo usando dois processos do executável ASAR, incluindo o carregamento do módulo 3D pelo protocolo de arquivo.

Em 11/11/2026 passaram: build, 40 testes da suíte principal, salas 3D em navegador, salas integradas em dois clientes Electron, o mesmo fluxo em dois executáveis empacotados, galeria, áudio/reconexão, atalhos globais e mídia em dez clientes. O teste geral do pacote também confirmou abertura ASAR, identidade, dependências e persistência de perfil/servidor/DMs. O teste de mídia confirmou 45 pares, recepção de voz nos 90 sentidos, telas/webcams para nove espectadores e liberação dos recursos. O teste espacial mediu a saída estéreo de uma fonte sintética: atenuação a zero, direção e restauração do áudio. Capturas e resultados locais ficam em `test-results/room3d-*` e `test-results/room3d-results.json`.

`npm run test:gallery`, `npm run test:audio`, `npm run test:controls` e `npm run test:media` verificam os caminhos de mídia e controles preservados. Execute `npm run build` antes dos testes de navegador.

Antes do lançamento, testar em dois ou mais computadores reais: proximidade com fones e alto-falantes, PTT/mute/Deafen, assistir à TV com áudio, webcams simultâneas, reconexão pela VPN, troca de ambiente, GPU integrada em qualidade baixa e sessão prolongada com dez participantes. Testes automatizados e capturas em navegador não comprovam essas condições físicas.
