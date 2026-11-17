# Benchmarks — baseline Electron e futuro Rust

## Continuidade: novo processo de sessão

As medições anteriores de Home pertencem ao incremento anterior, antes do serviço de sessão integrado. Não as reutilizar como medição atual. A nova coleta considera o desktop e o processo Rust filho; em chamada sem UI, o teste registra separadamente os dois processos de sessão (um peer por participante), sem esconder auxiliares do produto. Emulador e controlador de teste são identificados como infraestrutura de teste.

A comparação direta com os 572,3 MiB Electron ainda não é homologada: a baseline usava mídia sintética e não tinha o mesmo peer/caminho de dispositivo; paridade funcional também não foi alcançada. GPU/VRAM, latência acústica, jogos externos, hotplug e sessão prolongada seguem pendentes. Os resultados da coleta atual estão registrados abaixo.


## Coleta atual: sessão persistente e desktop integrado

Coleta em 2026-11-17T02:09:13.7215688Z, build release. Seis amostras por cenário, CPU normalizada para 12 CPUs lógicas. [Home e árvore de processos](evidence/native-2.0/current-resources/resources-native.json); [chamadas e processos de sessão](evidence/native-2.0/call-process-resources.json).

| Cenário | Working set médio | Private bytes médio | CPU média amostrada |
| --- | --- | --- | --- |
| core-idle | 21,29 MiB | 4,01 MiB | 0,00% |
| home | 45,53 MiB | 13,52 MiB | 0,00% |
| home-minimized | 40,35 MiB | 8,66 MiB | 0,00% |
| Chamada sem UI, participante 1 | 24,24 MiB | 6,32 MiB | 0,30% |
| Chamada sem UI, participante 2 | 24,17 MiB | 6,34 MiB | 0,46% |

Home soma desktop e filho Rust; core-idle inclui toda a árvore enumerada. Nas chamadas, cada participante tem um processo de sessão, e os dois estão incluídos na evidência; ambas as interfaces foram descarregadas. Controlador de teste e emulador local são explicitamente identificados como infraestrutura de teste e excluídos. Fluxo pelas APIs físicas padrão, Opus/SRTP local e reprodução com volume remoto zero; sem gravação ou certificação acústica. Seis amostras curtas não comprovam estabilidade prolongada. GPU/VRAM e latência acústica não medidas. Zero de CPU amostrado significa limite de resolução. Não há equivalência funcional com Electron nem redução percentual homologada.

## Medições nativas release — 16/11/2026

[Dados brutos](evidence/native-2.0/resources-native.json), gerados por [benchmark-native.ps1](scripts/benchmark-native.ps1). Seis amostras com intervalo de um segundo por cenário; soma de working sets/private bytes de toda a árvore de processos. CPU normalizada pela capacidade da máquina (12 CPUs lógicas). Zero amostrado significa abaixo da resolução da coleta, não consumo físico absoluto zero.

| Cenário nativo | Working set médio | Private bytes médio | CPU amostrada | Inicialização até captura pronta |
| --- | --- | --- | --- | --- |
| Core ocioso | 31,77 MiB | 4,14 MiB | 0% | Não medida: espera fixa do coletor |
| Home | 29,57 MiB | 10,75 MiB | 0% | 488,45 ms |
| Home minimizada | 23,56 MiB | 4,89 MiB | 0% | 377,68 ms |

Binários naquele build: desktop 6.770.688 bytes; core 12.087.296 bytes. **Não são tamanhos de instalador.** Mudanças posteriores no código podem alterar o tamanho; os valores identificam a execução registrada. Processo de console auxiliar, quando presente, está incluído na árvore; nenhum motor 3D ou processo Node estava envolvido.

Não houve chamada, microfone, peer remoto, vídeo ou mundo nesses cenários. A funcionalidade nativa ainda é menor que a da versão Electron; não calcular redução percentual de produto ou declarar atingida a meta de 30–80 MB em chamada. A baseline Electron abaixo permanece histórica e exploratória. A confirmação física do usuário sobre 1.4.1 é qualitativa, sem novos números de benchmark.

Sondagem adicional de áudio nativo: 3 s de CPAL/WASAPI → DSP → Opus, mute antes de codificar, sem gravação/transmissão. 150 frames produzidos após corrigir underrun inicial tratado como fatal. É validação do fluxo de APIs, sem medição de latência/eco/inteligibilidade e sem equivalência acústica declarada.

Data das novas medições: **2026-11-16**. Código: **1.4.1**, commit `7df27bc684c0743fa52e12bfe6aae5073dd02371`. Estado na coleta Electron original: **nenhum binário Rust implementado ou medido naquele momento**. As medições nativas posteriores estão acima. Meta 30–80 MB: aspiracional, sem resultado confirmado. Não comparar esses dados com estimativas de bibliotecas.

## Ambiente e reprodução

Windows 11 Pro build 26200, AMD Ryzen 5 9600X (12 CPUs lógicas), 33.408.684.032 bytes de RAM física reportada; GPUs AMD integrada e NVIDIA RTX 5060 Ti, drivers registrados em [environment.json](evidence/native-2.0-phase0/environment.json). Node 24.13.0, Electron 44.9.0. Desenvolvimento após build, perfil novo isolado por `VOXY_DATA_DIR`, sem tocar `%APPDATA%/voxy-desktop`. Modo baixo consumo padrão desligado, sem helper PTT ativo; seis processos Electron na coleta. Não é executável instalado. Não houve controle de temperatura, energia, cache frio ou todos os programas de fundo; portanto esta é referência exploratória local, não certificação de desempenho.

```powershell
npm run build
npm run test:resources -- --label=2.0-phase0
# Usar o caminho metrics.json impresso pelo comando anterior:
node scripts/audit-native-baseline.mjs test-results/resources-<label>-<timestamp>/metrics.json
npm run test:rooms3d:performance -- --gpu --label=2.0-phase0
```

`audit-native-baseline.mjs` usa apenas fontes rastreadas no commit HEAD para o índice, registra ambiente sem hostname/IP/perfil pessoal e mede três inicializações com perfis descartáveis. A ferramenta sobrescreve sua saída de trabalho em `evidence/native-2.0-phase0`; para guardar uma nova referência, copiar os resultados para outra pasta antes de executar novamente. O commit medido deve ser registrado junto com o estado de código relevante e hashes. O tempo de inicialização inclui o launch Playwright até o botão Configurações visível, não desde boot do Windows; notas de primeira execução podem ainda estar abertas.

O coletor de recursos espera 3 s e colhe seis amostras/cenário, com intervalos de 1 s e tempo adicional das consultas CIM. A tabela usa a mediana das **últimas cinco** amostras. `app.getAppMetrics()` soma working set e private bytes de todos os processos reportados pelo Electron. A soma de working sets pode contar páginas compartilhadas mais de uma vez; registrar também private bytes. Não é memória JS isolada nem memória física exclusiva. CPU é soma de `percentCPUUsage` do Electron, preservada na unidade da API. GPU é soma de contadores por engine/PID, **não porcentagem da placa inteira** nem VRAM. Contadores retornados como zero não comprovam consumo absoluto zero; precisão/resolução são limitadas.

O coletor existente não enumera automaticamente helpers arbitrários. Nestes cenários PTT está desligado e não há helper de teclas; em medições de PTT é obrigatório somar a árvore de processos Windows, inclusive PowerShell na 1.x. A futura coleta Rust precisa enumerar core/UI/world/media/atualizador e qualquer filho, com PIDs/tempos de criação para não atribuir memória a PID reutilizado. Não comparar só o core Rust com todos os processos Electron.

## Resultados efetivamente medidos

Dados brutos: [electron-resources.json](evidence/native-2.0-phase0/electron-resources.json). Cálculo: [resource-summary.json](evidence/native-2.0-phase0/resource-summary.json). RAM em **MiB** (1.048.576 bytes), CPU em %, GPU na soma de engines da API/counter.

| Cenário local, um participante | Working set total MiB | Private MiB | CPU % | GPU engine sum | Rust |
| --- | ---: | ---: | ---: | ---: | --- |
| Home | 555,8 | 315,9 | 0,009 | 0 | Não medido |
| Host/servidor conectado em loopback | 566,3 | 356,9 | 0,015 | 0 | Não medido |
| Canal de voz, captura sintética, sem peer | 573,0 | 344,7 | 0,267 | 0 | Não medido |
| Mesmo canal minimizado | 572,3 | 330,9 | 0,193 | 0 | Não medido |
| Lounge 3D no aplicativo | 663,4 | 454,7 | 2,136 | 1 | Não medido |
| Após sair do 3D | 615,6 | 371,2 | 0,433 | 0 | Não medido |
| Compartilhamento local iniciado, sem receptor | 665,9 | 407,2 | 0,991 | 0 | Não medido |
| Após cinco ciclos voz/3D | 744,1 | 662,3 | 0,208 | 0 | Não medido |

São processos reais com dispositivos falsos e um usuário local. A linha de voz **não contém** encode/envio/recepção de uma chamada entre dois participantes; a linha de compartilhamento **não mede** streaming para outra máquina. Não usar como validação de microfone, eco ou latência de rede.

Na primeira saída do 3D, as medianas diminuíram em cerca de 47,7 MiB de working set e 83,5 MiB private; canvas WebGL caiu de um para zero. Ainda ficou acima da voz inicial. Após cinco ciclos houve aumento, com grande variação nas amostras finais; isso exige investigação de retenção/cache/GC e coleta prolongada. Contadores zero de objetos não provam devolução integral ao SO. Não declarar ausência de vazamentos com esse teste curto.

Inicialização: [startup.json](evidence/native-2.0-phase0/startup.json), última coleta preservada (três execuções, cache do SO aquecido):

| Tentativa | Tempo até controle visível ms | Working set MiB | Private MiB | Processos |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1.236,8 | 536,9 | 228,8 | 6 |
| 2 | 1.227,0 | 538,3 | 230,3 | 6 |
| 3 | 1.190,7 | 535,4 | 225,1 | 6 |

Mediana de tempo: **1.227,0 ms**. Não é inicialização a frio nem resultado do instalador publicado.

## Fixture 3D separada

[room3d-performance.json](evidence/native-2.0-phase0/room3d-performance.json): renderer atual do Lounge com dez avatares sintéticos, viewport 1024×600, Edge headless com GPU, ANGLE D3D11 na RTX 5060 Ti. Janela de medição de 4 s após 2 s de aquecimento. Este teste usa um navegador como ferramenta para medir a implementação 1.x; não representa a stack final nem o desempenho do aplicativo Electron inteiro.

| Qualidade | Limite do código FPS | FPS observado | Tempo CPU na chamada render ms | Draw calls médios | Texturas antes/depois dispose |
| --- | ---: | ---: | ---: | ---: | --- |
| Baixa | 24 | 22,98 | 1,68 | 353 | 73 / 0 |
| Média | 40 | 37,48 | 1,99 | 449,01 | 76 / 0 |
| Alta | 60 | 54,95 | 1,54 | 416,74 | 76 / 0 |

Geometrias após dispose: zero nas três qualidades. O tempo `renderCpuMs` mede a duração CPU da chamada, não tempo de execução GPU. Qualidades têm limites de FPS diferentes, por isso baixa apresentar menos FPS é esperado. Não inferir que alta é mais eficiente pela menor média de draw calls; a fixture tem amostragem curta e frequência diferente. Precisamos repetir em processo empacotado, três ambientes e GPUs variadas.

## Tamanho e histórico preservado

O registro de publicação da 1.4.1 informa instalador de **127.276.075 bytes** (≈121,4 MiB) e SHA-256, em [publication-1.4.1.json](evidence/publication-1.4.1.json). É evidência histórica, não um novo download/medição do pacote nesta sessão. Tamanho instalado total não foi medido. [comparison.json](evidence/stability-1.4.1/comparison.json) contém medições anteriores; não as substituir pelas novas nem usar como comparativo Rust.

## Matriz obrigatória ainda aberta

| Cenário exigido | Cobertura nesta etapa | Falta para comparação homologada |
| --- | --- | --- |
| Inicialização | Três execuções em desenvolvimento | ≥5 execuções frias/quentes por binário instalado, RAM e tempo com método equivalente |
| Home e servidor | Uma rodada, perfil vazio, host local | Carga real de histórico, cliente remoto, três repetições e percentis |
| Chamada | Captura sintética sem peer | 2/6/10 participantes, dispositivos físicos, PTT ligado/desligado, perdas/jitter e latência boca-ouvido medida |
| Chamada minimizada | Seis processos, sem helper | UI Rust encerrada e aberta oculta, PTT em jogo, CPU/GPU/VRAM e todos os filhos |
| Compartilhamento | Captura local sem receptor | Tela/janela/app audio/câmera, receptores, bitrate/cópias/latência, hardware encode/decode |
| Sala 3D | Recursos no app + FPS em fixture separada | Lounge/Cinema/Rooftop, dez usuários, vídeo/TV, FPS p50/p95/p99/frame times no app |
| Saída do 3D | Primeira saída + cinco ciclos | 20+ ciclos, recuperação após 60/300 s, private commit/VRAM/handles/threads, sem forçar trimming para maquiar resultados |
| Sessão prolongada | Não executada | ≥8 h, reconnect/hotplug/suspender-retomar, tendência de memória/handles e áudio contínuo |
| Instalador | Registro histórico do arquivo publicado | Medir download verificado, instalação em VM e footprint total Rust/Electron |

Para boca-ouvido, usar sinal de referência e loopback/dispositivo de captura com relógio comum; RTT do transporte não é latência audiovisual. Registrar eco, recortes, ganho, falhas e dropout além da média. No comparativo, mesma máquina/build de SO/dispositivos/rede/quantidade de usuários/qualidade, versões travadas e plano de energia; medir host e cliente separadamente, somando processos de cada instalação. Não extrapolar uma captura sintética para qualidade de headset.

Fase 0 ainda não está integralmente homologada por causa dessas lacunas. Nenhuma redução de consumo do Rust foi comprovada.
