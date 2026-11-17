# Benchmarks — baseline Electron e futuro Rust

## Continuidade: novo processo de sessão

As medições anteriores de Home pertencem ao incremento anterior, antes do serviço de sessão integrado. Não as reutilizar como medição atual. A nova coleta considera o desktop e o processo Rust filho; em chamada sem UI, o teste registra separadamente os dois processos de sessão (um peer por participante), sem esconder auxiliares do produto. Emulador e controlador de teste são identificados como infraestrutura de teste.

A comparação direta com os 572,3 MiB Electron ainda não é homologada: a baseline usava mídia sintética e não tinha o mesmo peer/caminho de dispositivo; paridade funcional também não foi alcançada. GPU/VRAM, latência acústica, jogos externos, hotplug e sessão prolongada seguem pendentes. Os resultados da coleta atual estão registrados abaixo.


## Coleta histórica: sessão persistente e desktop integrado

Coleta em 2026-11-17T02:09:13.7215688Z, build release. Seis amostras por cenário, CPU normalizada para 12 CPUs lógicas. [Home e árvore de processos](evidence/native-2.0/current-resources/resources-native.json); [chamadas e processos de sessão](evidence/native-2.0/call-process-resources.json).

| Cenário | Working set médio | Private bytes médio | CPU média amostrada |
| --- | --- | --- | --- |
| core-idle | 20.84 MiB | 4.17 MiB | 0.000% | não medido |
| home | 48.18 MiB | 14.26 MiB | 0.021% | 340 ms |
| home-minimized | 43.57 MiB | 9.46 MiB | 0.000% | 191 ms |

Core-idle é o comando hold sem chamada; seu tempo usa espera fixa de 300 ms mais criação do processo, não prontidão. Home inclui o processo de sessão quando presente; inicialização termina no marcador de screenshot. CPU zero significa resolução/amostragem, não ausência absoluta de trabalho. Não foram medidos nesta execução chamada física, mídia, GPU/VRAM, mundo/jogos, liberação 3D ou soak. As chamadas e tabelas anteriores são históricas; não representam este build nem comparação equivalente com Electron. Tamanhos e hashes atuais do instalador/ZIP constam no recibo; instalação em VM permanece pendente.

## Chamada e compartilhamento com instâncias reais — 17/11/2026

Amostra única de cada processo do Voxy ao final de execuções E2E reais (`voxy-e2e`, build release, sinalização pública, todos os participantes nesta máquina, áudio por dispositivo sintético). Para cada participante há dois processos: interface (`voxy-desktop`) e sessão (`voxy-core serve`). Não é medição de pico, GPU/VRAM, latência acústica ou sessão prolongada; não comparar com cenários Electron.

| Cenário (duração) | Processo | Working set | Private bytes | CPU acumulada |
| --- | --- | --- | --- | --- |
| Voz, 3 participantes (77 s) | interface (média dos 3) | 28,2 MiB | 10,7 MiB | 0,5–2,9 s |
| Voz, 3 participantes (77 s) | sessão (média dos 3) | 25,6 MiB | 8,0 MiB | 2,5–3,0 s |
| Tela 720p30, transmissor (50 s) | interface / sessão | 43,3 / 48,4 MiB | 16,6 / 29,7 MiB | 2,9 / 4,7 s |
| Tela 720p30, espectador (50 s) | interface / sessão | 32,7 / 25,6 MiB | 13,0 / 7,0 MiB | 7,0 / 2,0 s |

Fonte: `evidence/native-2.0/e2e/voice-3-release-public-20261117-165715/voice-3.json` e `evidence/native-2.0/e2e/screen-2-release-public-20261117-171624/screen-2.json` (`resourcesAtEnd`). Codificação H.264 por software; a decodificação e a conversão de cores do espectador rodam na interface. Pendentes: câmera, várias transmissões simultâneas, multimídia com 3 participantes, chamada minimizada, PiP, encerramento de mídia e sessão prolongada.
