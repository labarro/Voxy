# Validação do Voxy

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

| Comando | Escopo | Resultado |
| --- | --- | --- |
| `npm test` | 2 suítes: convites/validação e integração com host SQLite + três clientes Socket.IO reais | Passou |
| `npm run test:media` | Três páginas Edge com motor WebRTC de produção; SDP/ICE/DTLS/RTP locais | Passou |
| `npm run build` | TypeScript estrito, main/preload, renderer Vite/Tailwind | Passou |
| `npm run test:desktop` | Três instâncias do Electron com build de produção, fontes de captura nativas | Passou |
| `npm run dist` | electron-builder + instalador NSIS x64 | Passou; artefato final em `release/0.1.0/` |
| `npm run test:packaged` | Executável em ASAR, host, SQLite e persistência após reinício | Passou, duas aberturas do binário final |
| `npm run test:dev` | Vite e Electron em perfil isolado | UI, React Refresh e preload abrem sem pageerror |
| `npm audit --omit=dev --json` | Dependências de runtime | 0 vulnerabilidades reportadas |

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

| # | Procedimento | Critério de aceitação |
| --- | --- | --- |
| 1 | Instalar o EXE em A, B e C e iniciar | Sem Node instalado; perfil e UI abrem |
| 2 | A hospeda no IP Radmin VPN e cria servidor | B/C conseguem conectar com o convite, sem porta pública |
| 3 | A cria canal de voz; todos entram | Três nomes visíveis em todos |
| 4 | A fala; B responde; C responde | Todos ouvem os outros com clareza, sem retorno indesejado |
| 5 | Cada um muta e desmuta | Mutado não chega aos amigos; indicação acompanha |
| 6 | B silencia recebimento e restaura | B deixa de ouvir, depois volta; sua voz continua conforme mute |
| 7 | Trocar entrada/saída, volume e desconectar USB | Dispositivo escolhido funciona ou erro explícito; recuperar ao selecionar outro |
| 8 | A compartilha monitor 720p/30 com IDE e texto em movimento | B/C recebem conteúdo legível, conversando ao mesmo tempo |
| 9 | B fecha player, continua falando e abre outra vez | Voz continua e vídeo reaparece |
| 10 | A para e reinicia tela 10 vezes | Voz permanece; tracks e uso de recursos não crescem continuamente |
| 11 | Compartilhar janela, fechar/minimizar fonte, usar parada nativa quando houver | Encerra quando o SO informa `ended`; fonte congelada pode exigir Parar manual |
| 12 | C entra depois de a transmissão começar | C recebe voz e vídeo sem A reiniciar |
| 13 | Testar 720p/15, 1080p/30 e 1080p/60 e mudar qualidade durante captura | Métricas efetivas observadas, sem promessa de atingir 60 FPS |
| 14 | Incluir áudio de sistema e tocar um som conhecido | B/C ouvem o som; identificar eco; desligar se recapturar a chamada |
| 15 | A/B transmitem simultaneamente, C alterna | Players corretos; somente áudio da tela selecionada; voz independente |
| 16 | C sai/volta 10 vezes; depois A encerra | Listas atualizam; recursos são liberados; encerramento do host encerra a sala |
| 17 | Desligar/religar Radmin VPN e Wi-Fi | Estado reflete falha; ICE tenta recuperação; sessão perdida exige nova entrada na voz |
| 18 | Rejeitar permissão de microfone no Windows | Erro visível; nenhuma chamada ou captura fictícia |
| 19 | Chamada de 30–60 min, CPU/GPU/upload e screenshots das métricas | Sem crescimento progressivo de recursos ou travamento; registrar perdas, FPS e RTT |
| 20 | Reiniciar A e hospedar novamente | Servidores/canais/chat e segredo persistidos; preferências B/C preservadas |

Para a versão 0.1.1, repita o roteiro com A, B, C, D e E na mesma rede Radmin, incluindo os quatro espectadores e os 20 sentidos de voz. Para sinais bloqueados: valide TCP na porta escolhida, rede Radmin/firewall, endereço e segredo. Para ICE sem conectar: valide UDP entre todos os IPs e permissão do executável no firewall. Use o estado da rede no Radmin, `ping IP_RADMIN` e `Test-NetConnection IP_RADMIN -Port 43120`. Não use sucesso de TCP ou da prévia local como prova de recepção de tela. Use o diagnóstico de cada espectador e confirme visualmente um relógio/texto alterando em A.

## Reproduzir sem contaminar o perfil pessoal

`test:desktop` e `test:packaged` usam diretórios isolados dentro de `test-results/`. O teste de sinalização usa uma pasta temporária que ele mesmo cria e remove. Nenhum teste deve apontar para `%APPDATA%/voxy-desktop`. Feche janelas e capture somente conteúdo de teste; o teste desktop usa a fonte nativa selecionada e pode registrar seu monitor em screenshots locais.
