# Voxy 1.4.1: investigação, medições e validação

Revisão de estabilidade em preparação. A publicação só é considerada concluída após o workflow de release e a conferência dos artefatos públicos. Este relatório não declara resolvido o relato original em todos os computadores.

## Entrada na voz: causas encontradas e alcance da correção

O fluxo é: clique → captura do microfone → AudioContext/pipeline → saída selecionada → comando `voice` → confirmação de estado → comando `status` → criação dos pares → oferta/resposta SDP → ICE → RTP. A navegação no servidor comprova a conexão Socket.IO, mas não a abertura do microfone nem a mídia entre pares.

Foram encontrados quatro defeitos concretos:

1. A captura e o `AudioContext.resume()` não tinham prazo. Uma promise pendente bloqueava `joining` e `busy`, sem indicação da etapa. A captura agora tem 12 segundos; áudio e seleção de saída têm 5 segundos; comandos têm o timeout de ACK existente e um limite na interface. A negociação inicial de cada par tem 20 segundos. Cancelamento encerra o áudio e permite outra entrada; capturas tardias são paradas.
2. Um ID de entrada salvo com `exact` pode desaparecer após troca de USB/driver/perfil. Agora, exclusivamente para `NotFoundError`/`OverconstrainedError` em uma entrada personalizada, tenta-se o dispositivo padrão. Permissão negada ou dispositivo ocupado produzem orientação específica. Não se repete cegamente a mesma captura. A saída personalizada indisponível também pode usar a padrão.
3. Candidatos ICE dividiam um orçamento de 120 eventos com comandos. O teste novo, com 180 candidatos em rajada, **falhou antes da correção**. Sinalização agora tem orçamento separado e limitado (512 de rajada, reposição de 128/s), mantendo autenticação, validação de payload e isolamento de canal. O mesmo teste passou. O host precisa ser atualizado para receber esta correção.
4. A interface usava apenas a presença no servidor para ignorar cliques no canal atual. Agora confere também captura/contexto locais; falhas desfazem a presença e oferecem nova tentativa manual. Falhas de áudio não deixam apenas um clique sem resposta.

Há indicação da etapa, cancelar, tentar novamente e abrir/copiar diagnóstico seguro. O relatório contém a versão, configuração de áudio em booleanos, etapa, estado do contexto, pares numerados, estados ICE/SDP, classes das redes e um histórico limitado a 160 eventos. Não contém nomes, mensagens, IPs, convites, credenciais, identificadores de dispositivos ou SDP/candidatos completos. Não é enviado automaticamente. Os logs detalhados ficam no console do renderer e no relatório copiável; não são um serviço remoto de telemetria.

Não foi encontrada no código uma política que force a interface HTTP como interface de mídia. WebRTC continua reunindo candidatos das interfaces disponíveis, sem forçar Radmin nem adicionar STUN/TURN público. Faixa 26/8 é registrada como `radmin-range`; isso é uma classificação, não prova de que um candidato remoto pertence ao Radmin. O firewall precisa permitir a mídia UDP direta, em portas negociadas, além da porta TCP do servidor.

Compatibilidade: o protocolo permanece 2, sem mudar o contrato de quatro transceivers. A suíte mantém a rejeição explícita de protocolo incompatível. Atualize host e clientes para 1.4.1; não foi executada uma matriz completa de binários históricos misturados.

**Pendência do P0:** nenhum diagnóstico dos computadores originalmente afetados estava disponível. A correção da rajada, dos dispositivos salvos e das esperas pendentes tem evidência local; não se pode atribuir o relato original exclusivamente a nenhuma delas. É necessário recolher os relatórios dos usuários afetados e validar uma chamada entre seus computadores.

## Sinuca

A causa era a atualização contínua de `poolAngle` por `pointermove` no canvas. O caminho até o botão pode cruzar o feltro e alterar a direção antes de alcançar a HUD. Ignorar apenas o último evento sobre o botão não resolve esse percurso.

A mira agora é uma interação explícita de clique/arraste com o botão esquerdo no feltro; soltar/abandonar o canvas fixa a direção. A força é independente; a tacada captura os valores selecionados e bloqueia execução duplicada enquanto aguarda o comando. Esc desfaz a seleção anterior; outro clique/arraste reajusta. Espaço/Enter no canvas permitem executar sem mover o mouse. Inputs e botões da HUD conservam seus próprios eventos/foco. Animação de preparação, contato do taco, física autoritativa, revisão e turnos não foram substituídos.

Uma partida completa em dois clientes chegou ao resultado final em nove tacadas. O teste verifica explicitamente que passar o mouse até o botão não altera o valor escolhido. Não houve teste presencial de ergonomia com jogadores.

## Auditoria de recursos

- O 3D já era um módulo lazy e desmontava ao voltar ao canal; não foi apresentado como novidade da revisão. Na comparação, o canal tradicional teve zero canvas 3D antes e depois.
- O timer de jogos do host acordava a cada 100 ms mesmo sem partidas e acessava snapshots **já armazenados em cache**. Agora só é iniciado quando há jogo e termina quando os mapas de partidas esvaziam. Isso remove trabalho periódico, não dez consultas SQL novas por segundo.
- O pipeline publicava níveis a cada 100 ms, causando atualizações da raiz mesmo sem medidor aberto. Agora publica nível apenas nas configurações, mantém apenas transições de fala fora delas e reaproveita a amostragem do microfone em vez de um analisador local duplicado.
- Sem detecção de voz, o timer do pipeline para em segundo plano e mantém o gate aberto. Com detecção, preserva os passos de 50 ms. Medidores remotos e stats param quando ocultos. Isso não pausa o áudio nem o processamento de voz necessário.
- O 3D para de agendar frames quando pausado/oculto/expandido e pausa seu vídeo de TV; retoma a partir do estado recebido. A galeria já suspende assinaturas não assistidas e mantém o player PiP. Compartilhamento e webcam ativos não são encerrados por minimizar.
- Ao sair, removem-se listener de visibilidade e listeners de vídeo; cena, streams de preview, modelos, materiais, geometrias, texturas e contexto WebGL são liberados. Um GLTF que termine após `dispose()` é descartado sem retornar ao mapa de modelos.
- O histórico já limita snapshots a 100 mensagens por canal, páginas de busca a 100 e arquivo do chat a 1.500 itens. O cache de imagens já limita entradas e bytes. Esses limites não foram aumentados.
- A saída da voz limpa pares, timers de conexão/recuperação, medidores, tracks e contexto. Capturas de tela/webcam são encerradas ao sair. O modo padrão conserva notificações, PTT, atalhos e reconexão; não foram desativados para ganhar números.

O modo de baixo consumo acrescenta menos animações/efeitos, medidores a 250 ms sem VAD, stats a 5 s, entrada tradicional e qualidade 3D baixa quando aberta manualmente. VAD conserva 50 ms; áudio não perde resolução nem bitrate por causa desse modo.

## Medição antes/depois

Windows 11 Pro build 26200, 12 processadores lógicos, 31,1 GiB de RAM física utilizável, Radeon integrada e RTX 5060 Ti. Electron 44.9.0, builds locais de produção, perfis isolados e mesma sequência de cenários. O baseline foi registrado antes de modificar a implementação existente. A preparação inicial de perfil inválida do coletor foi substituída pelo perfil padrão pelo próprio app; ambas as rodadas padrão usaram os padrões reais do app.

Cada cenário tem 3 s de estabilização e seis amostras, com consultas CIM de GPU entre elas. A tabela usa a mediana das últimas cinco amostras, descartando o primeiro intervalo de CPU que inclui a transição. Os JSON preservam todas as amostras. RAM é a soma dos working sets de **todos os seis processos** retornados por `app.getAppMetrics()`, incluindo GPU e utilitários; páginas compartilhadas podem ser contadas mais de uma vez. Private bytes também estão no JSON e não são iguais a RAM residente. CPU usa a soma de `percentCPUUsage` do Electron; não é uma medição só do processo principal. GPU é a soma dos contadores de utilização por engine dos PIDs do app, com resolução inteira; não é VRAM nem utilização de toda a placa, e engines podem se sobrepor.

O teste hospeda localmente e usa captura sintética. O cenário de voz do coletor tem **um participante**, portanto não mede o custo de codificar/decodificar voz para outros computadores. A transmissão tem captura/preview, sem espectador remoto. Testes de transporte com dez clientes e dois clientes Electron são separados e não devem ser confundidos com esta tabela.

| Cenário | RAM MiB: 1.4.0 → 1.4.1 | CPU %: 1.4.0 → 1.4.1 | GPU engines %: 1.4.0 → 1.4.1 |
|---|---:|---:|---:|
| Home | 550,7 → 555,5 | 0,014 → 0,023 | 0 → 0 |
| Servidor, sem voz | 563,0 → 567,8 | 0,022 → 0,014 | 0 → 0 |
| Canal de voz tradicional | 573,4 → 572,8 | 0,295 → 0,309 | 0 → 0 |
| Voz minimizada | 569,4 → 573,2 | 0,191 → 0,175 | 0 → 0 |
| Sala 3D, qualidade média | 669,3 → 672,7 | 1,952 → 1,791 | 1 → 1 |
| Após voltar do 3D | 615,2 → 615,1 | 0,333 → 0,361 | 0 → 0 |
| Compartilhamento de tela | 659,2 → 658,4 | 0,900 → 0,871 | 0 → 1 |
| Após cinco ciclos de voz/3D | 769,4 → 770,6 | 0,401 → 0,269 | 0 → 0 |

Não houve redução relevante de RAM no modo normal. A CPU caiu em alguns cenários (aproximadamente 8% minimizado e 33% após ciclos), mas aumentou em outros; números muito pequenos sofrem ruído, coleta de lixo e interferência do sistema. GPU não mostrou um ganho consistente. Uma rodada curta por versão não demonstra significância estatística. A solicitação de uma redução significativa e generalizada de recursos **não está comprovada** por esses resultados; não se promete um percentual de economia.

Há crescimento transitório de memória nos ciclos: as últimas amostras caem de aproximadamente 781 para 700 MiB na 1.4.1. Isso não prova um vazamento nem prova sua ausência; há caches/JIT/coleção de lixo do Chromium e módulos JS que permanecem carregados após o primeiro uso do 3D. Não se força GC para produzir um resultado artificial.

[Antes](evidence/stability-1.4.1/before.json) · [Depois](evidence/stability-1.4.1/after.json) · [Comparação](evidence/stability-1.4.1/comparison.json). Os diretórios de execução completos, com perfis isolados, permanecem em `test-results/`, fora do Git.

Referências da medição: [CPUUsage do Electron](https://www.electronjs.org/docs/latest/api/structures/cpu-usage/), [memória em KiB](https://www.electronjs.org/docs/latest/api/structures/memory-info), [todos os processos do aplicativo](https://www.electronjs.org/docs/latest/api/app/#appgetappmetrics).

### Modo de baixo consumo e observação após ciclos

Uma rodada adicional com `--low --soak` mediu, pelo mesmo método, voz visível em 572,4 MiB / 0,181% CPU, minimizada em 571,1 MiB / 0,170%, e 3D em 648,5 MiB / 1,640%. A qualidade gráfica foi reduzida deliberadamente; a chamada não mudou sua qualidade de áudio. É uma redução adicional de CPU em voz visível, não uma grande redução de RAM. O contador de GPU variou para cima e não sustenta alegação de economia de GPU.

Após os cinco ciclos, os working sets tiveram medianas de 759,3, 681,8, 676,9, 674,6 e 675,1 MiB nas janelas sucessivas, sem GC forçado. As quatro janelas extras incluem esperas de 15 s e seis amostras cada: a sequência cobre alguns minutos, não horas. A memória se estabilizou acima do estado anterior ao primeiro 3D; não houve crescimento monotônico nesse intervalo curto. Investigar retenção de longo prazo e medir chamadas com participantes remotos continua necessário. [Amostras do modo de baixo consumo e observação](evidence/stability-1.4.1/low.json).

## Testes efetivamente executados

- `npm test`: 83 testes passaram, incluindo migração de preferências, orçamento ICE, ACKs, isolamento, jogos e novidades uma vez após atualização de versões anteriores.
- `npm run build`: TypeScript e bundles passaram. O aviso de chunk grande do módulo 3D permanece; ele continua sob demanda.
- `npm run test:calls`: captura pendente, stream tardio encerrado, permissão negada, retry, cancelamento e contexto de áudio pendente por 5 s, com dispositivos sintéticos.
- `npm run test:calls:radmin`: dois clientes reais Electron, sinalização vinculada ao adaptador Radmin local, pares conectados, entrada USB salva inexistente, relatório copiado sem dados sensíveis, F9 global abrindo/fechando PTT minimizado e um minuto minimizado. **Uma máquina, não dois computadores na VPN.**
- `npm run test:media`: 45 pares WebRTC, pacotes de voz nos 90 sentidos, webcam e telas para nove espectadores, suspensão de vídeo sem espectador preservando voz, ciclos e liberação de recursos.
- `npm run test:games:pool`: partida completa em dois clientes e direção preservada ao atravessar até a HUD.
- `npm run test:rooms3d:app`: dois clientes Electron, ambiente, troca tradicional/3D, áudio e vídeo reais com fontes sintéticas.
- `npm run test:controls`, `test:gallery`, `test:audio`, `test:system`: atalhos globais, Deafen, galeria, permissões/capturas, queda TCP e restauração de voz, PiP nativo com quadros após minimizar, notificações instrumentadas, bandeja e encerramento do processo.
- `npm run test:microphone`: amplitudes reais de fontes sintéticas no Web Audio, VAD, volume, mute e liberação das tracks; não usa microfone físico.
- `npm run pack`, `test:packaged` e `test:rooms3d:packaged`: executável ASAR, dependências, persistência, identidade e ambientes/mídia em duas instâncias do pacote local passaram. O instalador não foi executado sobre o perfil pessoal.

Os testes não usaram os microfones físicos dos usuários nem múltiplos computadores. Não foi realizada uma sessão de horas, uma matriz de drivers/rede/firewall ou uma medição com um jogo pesado concorrente. Essas validações permanecem pendentes, assim como a confirmação do P0 nos PCs afetados e uma redução de RAM demonstrável sob voz com participantes remotos.

Reprodução: `npm run build`; `npm run test:resources -- --label=medicao`; `npm run test:resources -- --label=baixo --low --soak`. Feche outras instâncias de teste para medir; não compare uma máquina sob carga com outra ociosa. `test:calls:radmin` exige o adaptador Radmin ativo e falha explicitamente se ele estiver ausente. Para comparar JSON: `node scripts/compare-resources.mjs caminho/antes.json caminho/depois.json`.
