# Validação do Voxy

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

Instalador local: `release/0.6.0/Voxy-Setup-0.6.0-x64.exe`, **126631173 bytes**, SHA-256 `375B4F8FF8B59F1F2688EC0D28B0A2ABEE73E9CEB0CA2F400AAB8E5F95E7C432`. Evidência consolidada em `evidence/validation-0.6.0.json`. A 0.6.0 ainda não foi publicada; o canal público continua na 0.5.0. A verificação pública/diferencial do updater da 0.5.0 é histórica e não foi repetida para esta versão local.

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
