# Benchmarks — baseline Electron e futuro Rust

## Continuidade: novo processo de sessão

As medições anteriores de Home pertencem ao incremento anterior, antes do serviço de sessão integrado. Não as reutilizar como medição atual. A nova coleta considera o desktop e o processo Rust filho; em chamada sem UI, o teste registra separadamente os dois processos de sessão (um peer por participante), sem esconder auxiliares do produto. Emulador e controlador de teste são identificados como infraestrutura de teste.

A comparação direta com os 572,3 MiB Electron ainda não é homologada: a baseline usava mídia sintética e não tinha o mesmo peer/caminho de dispositivo; paridade funcional também não foi alcançada. GPU/VRAM, latência acústica, jogos externos, hotplug e sessão prolongada seguem pendentes. Os resultados da coleta atual estão registrados abaixo.


## Coleta histórica: sessão persistente e desktop integrado

Coleta em 2026-11-17T02:09:13.7215688Z, build release. Seis amostras por cenário, CPU normalizada para 12 CPUs lógicas. [Home e árvore de processos](evidence/native-2.0/current-resources/resources-native.json); [chamadas e processos de sessão](evidence/native-2.0/call-process-resources.json).

| Cenário | Working set médio | Private bytes médio | CPU média amostrada |
| --- | --- | --- | --- |
| core-idle | 20.86 MiB | 4.23 MiB | 0.000% | n?o medido |
| home | 48.71 MiB | 15.21 MiB | 0.021% | 339 ms |
| home-minimized | 47.10 MiB | 12.97 MiB | 0.341% | 190 ms |

Core-idle é o comando hold sem chamada; seu tempo usa espera fixa de 300 ms mais criação do processo, não prontidão. Home inclui o processo de sessão quando presente; inicialização termina no marcador de screenshot. CPU zero significa resolução/amostragem, não ausência absoluta de trabalho. Não foram medidos nesta execução chamada física, mídia, GPU/VRAM, mundo/jogos, liberação 3D ou soak. As chamadas e tabelas anteriores são históricas; não representam este build nem comparação equivalente com Electron. Tamanhos e hashes atuais do instalador/ZIP constam no recibo; instalação em VM permanece pendente.
