# Voxy

**Versão atual: 0.3.0.** Inclui até dez participantes, Push to Talk global configurável, volumes por perfil persistidos, volume separado de transmissões, imagens no chat, fullscreen sem bordas, avatar 👴, sons opcionais de entrada/saída, atualização local com backup e popup de novidades uma vez por versão. Veja [GUIA-DE-ATUALIZACAO.md](GUIA-DE-ATUALIZACAO.md).

Nesta versão, clique em **alterar tecla** e pressione a tecla desejada para configurar o PTT. Letras, números, F1–F24, modificadores, navegação, pontuação e teclado numérico são aceitos conforme o teclado Windows; atalhos reservados pelo sistema e teclas Fn de hardware podem não chegar ao aplicativo. É uma tecla individual, sem combinações. A preferência só muda ao salvar.

Nas configurações de microfone, ajuste **Volume de entrada** (0–200%) e ative **detecção de voz** para definir o **Limite de ativação** em dBFS. O medidor mostra a entrada durante a chamada antes do ganho. Comece em 100%, fale normalmente e escolha um limite acima do ruído ambiente e abaixo da sua voz. −70 é mais sensível; −10 exige som forte. O ganho automático do Chromium é solicitado como desativado; drivers e melhorias de áudio do Windows podem aplicar processamento próprio. Detecção vem desligada para preservar o comportamento de perfis anteriores. O filtro não reconhece fala: sons fortes acima do limite também passam. Alterações entram em vigor ao salvar, inclusive durante uma chamada, sem alterar a transmissão.

Suas mensagens têm **Editar** e **Excluir**, com confirmação para excluir e indicação de edição. Imagens são preservadas ao editar a legenda e removidas ao excluir a mensagem. No fullscreen, a HUD e o cursor somem após 2,5 segundos sem interação e reaparecem ao mover o mouse. O início de uma transmissão toca um som em todos os participantes do mesmo canal, incluindo quem transmite; a opção de sons e o áudio silenciado são respeitados.

Para silenciar só a voz de alguém, clique com o botão direito no cartão ou no nome na lateral e escolha **Mutar voz para mim**. O botão também aparece no cartão. **Ouvir voz novamente** restaura a voz no volume anterior. Essa preferência fica salva por perfil, não muda o que os outros ouvem e não silencia a transmissão. O ícone de fone cortado indica quem silenciou o áudio recebido; o ícone de volume cortado em âmbar indica seu mute local. Quem compartilha aparece com o selo vermelho **AO VIVO** na lateral.

Para usar sua própria foto, abra a engrenagem → **Escolher foto do computador** e salve o perfil. PNG/JPEG/WebP de até 5 MB e 24 megapixels são aceitos; o aplicativo faz um recorte central quadrado e reduz para 128×128. A miniatura fica no perfil local e é compartilhada com os membros da sala. Para remover, escolha qualquer emoji e salve. Atualize todos os amigos para 0.3.0 para exibir as fotos corretamente.

Nas configurações, salve o modo Push to Talk e a tecla desejada. A tecla funciona com o Voxy em segundo plano no Windows; o mute manual continua prevalecendo. Se o leitor global não puder iniciar, o microfone permanece fechado nesse modo e um erro é exibido. Ao selecionar um dispositivo de entrada/saída diferente, salve as preferências. Os volumes de voz e de transmissão são independentes e lembrados pelo UUID do participante.

No chat, use **Enviar imagem** ou cole uma imagem. Formatos: PNG/JPEG/WebP, até 2 MB, 8192 px por dimensão e 24 megapixels. Há prévia, remoção antes de enviar e ampliação. Imagens ficam no banco do host, são buscadas ao aparecerem no histórico e não são reenviadas em cada atualização de estado.

Fullscreen usa toda a viewport, com controles sobrepostos. Se a proporção da fonte for diferente da tela, use **Preencher player** para ocupar toda a área com recorte; **Ajustar à janela** preserva a imagem inteira. A reprodução dos sons de entrada/saída pode ser desligada nas configurações e respeita silenciar áudio.

Aplicativo desktop para até dez pessoas, incluindo o host: voz, texto e compartilhamento real de monitor/janela com Electron, React e WebRTC. O computador que hospeda mantém o estado e o histórico; cada participante envia mídia diretamente aos demais. Não requer VPS, banco hospedado, serviço de streaming ou assinatura do Voxy.

**Validação da versão 0.3.0:** dez clientes WebRTC automatizados receberam voz nos 90 sentidos e uma tela nos nove espectadores em dois ciclos de iniciar/parar. A validação em computadores físicos pelo Radmin VPN e a avaliação humana da qualidade de áudio ainda estão pendentes. A captura nativa já foi validada com três instâncias Electron locais. Veja [TESTING.md](TESTING.md).

## Instalação para os amigos

O instalador atualizado fica em `release/0.3.0/Voxy-Setup-0.3.0-x64.exe`. Abra-o, escolha a pasta e conclua a instalação. Cada empacotamento usa uma pasta `build-*` nova para evitar travas de arquivos ASAR no Windows; `release/0.3.0/latest-build.json` identifica a pasta final. Para teste sem instalador, use `win-unpacked/Voxy.exe` dentro dela e copie a pasta `win-unpacked` inteira ao distribuir. Não há certificado de assinatura digital: Windows/SmartScreen pode mostrar editor desconhecido. Confirme a procedência e o SHA-256 antes de executar. Não é necessário desativar o antivírus.

O hash atualizado acompanha o instalador em `release/0.3.0/SHA256SUMS.txt`.

Windows 10/11 x64 são os alvos; esta execução foi validada em Windows build 26200. Não foi testada em uma instalação limpa de Windows 10. Os amigos não precisam instalar Node.js.

## Radmin VPN e primeira sala

1. Instale o [Radmin VPN para Windows](https://www.radmin-vpn.com/) nos computadores. Siga o [guia oficial](https://www.radmin-vpn.com/help/index.html): no Radmin, o host cria uma rede e os amigos entram usando o nome e a senha dessa rede. Confirme que todos aparecem online. Não é necessário instalar Radmin Server ou Radmin Viewer para usar Voxy.
2. Mantenha o Radmin VPN conectado. O convite do Voxy é uma autorização adicional, diferente da senha da rede Radmin.
3. Abra Voxy e use a engrenagem para escolher nome, avatar e dispositivos. Avatares são uma seleção local de emojis, sem upload de arquivos.
4. No computador A, clique em **Hospedar sala**. Escolha seu IP Radmin `26.x.x.x` e porta 43120 (ou outra disponível). `127.0.0.1` permite somente testes no próprio computador. O app prioriza endereços 26.x de adaptadores com Radmin no nome; se o adaptador tiver sido renomeado, restaure um nome contendo Radmin para detectá-lo. Confirme o IP exibido no Radmin.
5. Clique em **Copiar convite** e envie o texto a até nove amigos por um meio confiável. O convite contém um segredo que autoriza entrar na sala. Exemplo de formato: `voxy://26.12.34.56:43120/<segredo-de-64-caracteres>`.
6. Os amigos clicam em **Entrar em sala**, informam nome e colam o convite completo. O convite não abre automaticamente por associação de protocolo do Windows; deve ser colado no Voxy. O MVP não aceita endereço sem segredo nem nomes DNS/IPv6.
7. Todos clicam no mesmo canal de voz e permitem o microfone. O primeiro servidor inclui `geral` e `Sala dos amigos`. O host pode adicionar servidores no botão **+**, canais no **+** da categoria e renomear/excluir no menu **…**. Exclusões exigem confirmação na interface.
8. A clica em **Compartilhar tela**, escolhe monitor ou janela e qualidade e inicia. Os demais clicam em **Assistir à tela**. Fechar o player não sai da voz. **Parar transmissão** preserva a conversa e permite nova captura.

Não abra portas no roteador nem exponha o host na internet. O app recusa `0.0.0.0` e endereços públicos comuns. A faixa 26/8 é uma exceção específica do Radmin, não uma faixa privada RFC1918: o host só a oferece quando pertence a um adaptador Radmin local. Prefira ouvir exclusivamente nesse IP, mesmo que outros endereços privados estejam disponíveis.

## Firewall e conectividade

A sinalização usa TCP na porta escolhida, apenas no endereço de escuta. WebRTC usa portas UDP locais dinâmicas entre os participantes. Radmin VPN e Firewall do Windows devem permitir esses fluxos. Restrinja a permissão do executável Voxy à interface Radmin e aos IPs dos amigos; não libere todos os programas, todas as interfaces ou todos os endereços. Durante desenvolvimento, o executável é `node_modules/electron/dist/electron.exe`.

Confira o estado dos amigos no Radmin e use `ping IP_RADMIN_DO_AMIGO` para diagnosticar. `Test-NetConnection IP_RADMIN_DO_HOST -Port 43120` verifica a sinalização TCP, não a mídia; falha de ping também pode significar ICMP bloqueado. Consulte o [suporte oficial do Radmin VPN](https://www.radmin-vpn.com/help/index.html). Não há STUN/TURN nem relay de mídia na aplicação. Se não houver caminho ICE entre os pares, o app mostra falha e não promete conectividade universal.

## Áudio e transmissão

- Microfone e silenciar recepção são controles distintos. Deafen silencia a reprodução local; mute desativa a track enviada. A atividade de voz vem de análise RMS do áudio, sem animação simulada.
- Nas configurações, selecione entrada e saída e salve. A seleção de saída depende de `setSinkId` e da disponibilidade de dispositivos. Nomes podem aparecer somente após permitir microfone. O volume por participante fica no cartão e é salvo por perfil entre sessões.
- Presets: 720p/15 (1,8 Mbps), 720p/30 (3 Mbps), 1080p/30 (5 Mbps), 1080p/60 (8 Mbps), como tetos por espectador. Resolução/FPS são objetivos, não garantias. Com dez pessoas, nove cópias de um stream de 5 Mbps podem exigir aproximadamente 45 Mbps de upload, além de áudio e overhead.
- `contentHint=detail`, preferência VP8 e manutenção de resolução favorecem texto; redução de FPS é possível. Qualidade pode mudar durante a transmissão. Consulte resolução/FPS efetivos no diagnóstico.
- Áudio do sistema usa `loopback` no Windows e é **opcional e desligado por padrão**. Captura o sistema inteiro, mesmo ao escolher uma janela; não é isolamento de áudio por aplicativo. Pode incluir as vozes recebidas e criar eco. Fones não eliminam essa recaptura digital: se houver eco, desative o áudio do sistema ou use roteamento de áudio externo. Não há cancelamento garantido desse loopback.
- A integração de loopback segue a [API oficial do Electron](https://www.electronjs.org/docs/latest/api/desktop-capturer); a reprodução audível entre máquinas ainda precisa de teste manual. Ausência de track gera aviso; nenhum áudio fictício é acrescentado pelo produto.
- Cada usuário pode transmitir; há seleção de qual tela assistir e somente o áudio da tela selecionada é reproduzido. A transmissão simultânea de fontes distintas ainda requer validação manual.

## Desenvolvimento

Pré-requisito: Node.js 24 LTS, npm e Windows x64. Dependências exatas estão no lockfile.

```powershell
npm ci
npm run dev
```

O comando inicia Vite em `127.0.0.1:5173` e o Electron com isolamento/sandbox. O renderer tem atualização automática; alterações no main/preload exigem reiniciar o comando. Não abra apenas o Vite no navegador: a ponte de desktop é necessária. `.env.example` documenta variáveis opcionais do ambiente; não há chaves externas nem carregamento automático de `.env`.

```powershell
npm test
npm run test:media
npm run build
npm run test:desktop
npm run dist
npm run test:packaged
npm run test:dev
```

Os testes de mídia usam Microsoft Edge instalado. `test:desktop` abre três janelas, usa microfone/captura de desktop reais e cria perfis isolados em `test-results/`; execute conscientemente em um desktop de teste, sem informações sensíveis abertas. Testes de navegador usam fontes sintéticas somente no teste. Testes não conectam a contas ou enviam convites para outras pessoas. `npm start` abre o último build. `npm run pack` gera somente a pasta do executável. O ícone original é reproduzível com `node scripts/icon.mjs`.

## Dados e diagnóstico

Dados em `%APPDATA%/voxy-desktop` (caminho Electron `userData`): `room.sqlite`, `profile.json`, `host-secret.bin`, `diagnostics.log`. `VOXY_DATA_DIR` pode substituir o diretório para testes. Não execute duas instâncias sobre o mesmo perfil. Faça backup da pasta com o app fechado; histórico não é criptografado. SQLite usa sql.js/WASM para dispensar recompilação de addon nativo por versão de Electron.

O host recupera os servidores anteriores quando hospeda novamente. Clientes mantêm perfil/dispositivos, mas não guardam convite nem réplica persistente do histórico. A carga entrega as últimas 500 mensagens de cada canal; mensagens mais antigas permanecem no SQLite e não têm paginação na interface.

O botão de rede abre diagnóstico por par: conexão, ICE, signaling, codec, bitrate enviado, resolução/FPS e perdas/RTT quando o Chromium fornece. `diagnostics.log` registra ciclo de conexão com limite aproximado de 256 KB; não registra convites, tokens, SDP, conteúdo de mensagens ou nomes. Se o host fechar, a sala acaba. Após reconectar a sinalização, entre novamente na voz; o app não reabre microfone/tela silenciosamente.

Se um convite vazar, encerre o app do host, remova apenas `host-secret.bin` na pasta de dados e hospede novamente para gerar outro segredo; convites anteriores deixarão de funcionar. Não apague `room.sqlite` para isso. Quem possuir o convite pode usar qualquer nome: não há identidade verificada, senha individual nem expulsão por usuário no MVP.

## Documentação e limites

[ANALYSIS.md](ANALYSIS.md): análise REA real e limite de autenticação do Discord. [ARCHITECTURE.md](ARCHITECTURE.md): fluxos, segurança e decisões. [TESTING.md](TESTING.md): evidências, falhas corrigidas e roteiro para três PCs.

Sem sincronização offline, migração do host, anexos de outros formatos, câmera, bots, busca automática de novas versões na internet ou assinatura de código. Atualizações locais pelo menu preservam os dados e fazem backup. O serviço está preparado para até dez pessoas, não para publicação pública. O Radmin VPN é uma dependência de conectividade externa; não é infraestrutura cloud própria paga. A aplicação também funciona em LAN privada acessível com o mesmo formato de convite.
