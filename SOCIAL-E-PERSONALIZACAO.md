# Personalização, amigos, chat e visualização em grade

As funcionalidades deste guia estão no código em desenvolvimento. Para compartilhá-las, host e participantes precisam usar esta compilação. A distribuição publicada continua indicada no README.

## Configurações e identidade

A engrenagem abre as categorias **Conta**, **Áudio e Voz**, **Vídeo**, **Aparência**, **Atalhos** e **Notificações**. Salve para persistir as alterações no perfil deste computador.

- **Conta:** avatar, nome, presença, cor do nickname e capa. A capa aceita PNG, JPEG ou WebP de até 5 MB e recebe recorte central, sem distorção, de 960 × 360 px. É reduzida para até 128 KB; pode ser substituída ou removida.
- **Aparência:** temas Voxy, Oceano, Bosque e Kuromi, com cor principal opcional. O tema Kuromi usa preto, roxo e rosa, com um emblema ilustrado inspirado no capuz e na caveira da personagem.
- **Áudio e Voz:** captura mono e normalização nativa de voz ativadas por padrão, supressão de ruído, cancelamento de eco, teste privado e sensibilidade. O volume manual permanece em 100%, com proteção contra picos. Desative a normalização se seu equipamento já aplicar processamento incompatível.
- **Atalhos:** ativação e tecla do Push-to-Talk. Microfone cortado significa mute manual ou teste privado; teclado âmbar significa PTT aguardando; microfone verde significa atividade de voz.
- **Notificações:** confirmações locais ao pressionar e soltar o PTT têm opção própria, independente dos sons de entrada, saída e compartilhamento. Os osciladores dos avisos conectam à saída local, fora da trilha transmitida. O cancelamento de eco não substitui fones: caixas de som podem voltar fisicamente ao microfone, e compartilhar o áudio completo do sistema também pode incluir sons do computador.

## Cargos e mini perfis

Em **Gerenciar servidor e canais**, o criador pode criar, renomear, recolorir e excluir até 50 cargos. Abra **Membros com este cargo** para atribuir ou retirar cargos, inclusive de pessoas que já passaram pela sala e estão offline. A validação acontece no host, além da interface. O campo de permissões fica reservado para evolução; cargos ainda não concedem poderes administrativos.

O primeiro cargo criado entre os atribuídos ao membro determina a cor no servidor; sem cargo, vale a cor pessoal; sem ambas, vale a cor padrão. DMs e a lista de amigos usam a cor pessoal. Os cargos aparecem como etiquetas nas listas e nos cartões.

Clique com o botão direito em um membro ou no autor de uma mensagem para abrir seu mini perfil, com capa, avatar, nome, presença, cargos e ações sociais. As opções de volume e mute individual aparecem quando a pessoa está na mesma chamada que você. As DMs continuam acessíveis pelo cartão.

## Amigos e chamadas privadas

O ícone **Amigos** abre a lista e mostra seu UUID para copiar. Cole o ID de outra pessoa em **Adicionar por ID**; o destinatário pode aceitar ou recusar. Também é possível adicionar pelo mini perfil, cancelar solicitações e remover amizades.

O Voxy mantém sua arquitetura de rede privada: amizades e pedidos são guardados pelo host da sala, com uma cópia da lista no histórico local. A pessoa precisa ter se conectado ao mesmo host uma vez para seu ID ser encontrado. Solicitações, presença ao vivo e chamadas exigem conexão à mesma sala; esta implementação não cria um serviço global de descoberta entre hosts independentes.

**Mensagem** abre a DM existente. **Ligar** envia um convite com expiração de 45 segundos; o destinatário precisa aceitar antes de a mídia começar. A chamada usa um canal temporário visível e acessível apenas às duas pessoas. Encerrar, sair ou desconectar remove o canal e libera a mídia. Entrar na chamada privada substitui a chamada de voz anterior.

## Chat e histórico

Use **Responder** para vincular uma mensagem. Clicar na referência localiza e destaca a original, buscando-a no host caso não esteja carregada. Mensagens excluídas exibem um aviso ao tentar localizá-las.

Digite **@** e escolha uma pessoa; setas e Enter também selecionam uma sugestão. A menção usa o ID, preservando o vínculo mesmo após uma mudança de nome. Mensagens que mencionam você recebem destaque.

O seletor de reações oferece oito emojis; clicar novamente retira sua reação. Respostas, menções e reações funcionam em canais e DMs. O host valida autoria e conversa; uma resposta não pode apontar para uma DM de terceiros.

**Carregar mensagens anteriores** usa páginas de 100 mensagens, com cursor estável mesmo quando várias mensagens têm o mesmo horário. A busca consulta o histórico completo do host e retorna até 100 resultados. A interface mantém uma janela limitada de mensagens antigas para evitar crescimento indefinido de memória; a busca permite localizar qualquer trecho antigo. Novas mensagens não deslocam quem está lendo o passado: use **Ir para recentes**. Alterações e reações em mensagens antigas carregadas também são sincronizadas.

## Telas, webcams e recursos em segundo plano

As fontes ativas aparecem automaticamente em grade ao visualizar o canal de voz em que você está. Clique em um vídeo ou no controle de ampliar para focá-lo; **Voltar à grade** restaura as demais fontes. Cada tela tem volume e mute próprios. Fechar uma fonte a oculta; **Mostrar todas** restaura as fontes.

As inscrições de vídeo são independentes para tela e câmera. Fechar uma fonte, focar outra, trocar de página ou minimizar a janela pede ao emissor para retirar as trilhas não assistidas daquele destinatário. A captura do transmissor continua enquanto ele compartilha; outros espectadores não são interrompidos. Ao restaurar a janela, as inscrições e players são reconstruídos sem encerrar a voz.

O processo principal informa minimização nativa, pois `backgroundThrottling: false` é necessário para preservar os temporizadores de áudio. Medidores visuais, estatísticas WebRTC e consultas periódicas de salas são suspensos em segundo plano. A detecção de voz continua processando quando habilitada. Conexões, trilhas, nós Web Audio, listeners e timers são liberados ao sair.

Outras otimizações incluem cache invalidável do snapshot SQLite, respostas indexadas em memória, memoização do chat, renderização adiada de mensagens fora da tela, carregamento preguiçoso de imagens e cache de imagens limitado a 24 entradas / aproximadamente 12 MB de strings. Capas são deduplicadas por hash e carregadas somente ao abrir o perfil; os estados de voz não retransmitem seus bitmaps.

## Verificação e limites das medições

- `npm test`: autorização de cargos e amizades, privacidade das chamadas e DMs, migração, paginação com horários idênticos, respostas, reações, preferências e estados do PTT.
- `npm run test:social`: três instâncias Electron isoladas; configurações, temas, capa, cargos, cartões, solicitações, chamada com consentimento, menções, respostas, reações, busca, DM e minimização nativa. Salva capturas e amostras de CPU/memória em `test-results/social-*/`.
- `npm run test:gallery`: duas telas e webcam, grade, ampliação/retorno, volume individual, ocultação, segundo plano, responsividade e liberação de tracks.
- `npm run test:media`: dez clientes, 45 pares, áudio nos 90 sentidos, telas/webcam simultâneas, suspensão e retomada, reconexões e limpeza.
- `npm run test:microphone`: amplitude real em Web Audio, filtro, volume zero, ganho proporcional e liberação de recursos.
- `npm run test:audio`: teste privado, processamento aplicado à chamada, volume/mute individual persistente e reconexão.

Na execução local de `test:media`, suspender tela e webcam para um espectador reduziu o vídeo de **27.446 para 0 bytes em 1,2 segundo**, mantendo **3.642 bytes de voz** no intervalo. O teste mede RTP real e verifica que os frames voltam após a reinscrição; não é uma estimativa de economia universal de CPU ou RAM. As amostras Electron são diagnósticas, dependem da máquina e não constituem comparação controlada de antes/depois. O ganho automático é solicitado ao Chromium, conforme suporte do dispositivo ([documentação da captura](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl)); microfones físicos de diferentes usuários ainda precisam de validação prática.
