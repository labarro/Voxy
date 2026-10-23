# Voxy — distribuir e atualizar sem perder os dados

## Atualização para 0.7.0

Inclui temas, capas, cargos, amigos e chamadas privadas, respostas/menções/reações e grade simultânea de telas e webcams. O áudio usa captura mono e normalização nativa, com estados e sons locais do PTT. Veja [Personalização e recursos sociais](SOCIAL-E-PERSONALIZACAO.md) e [Áudio e conexão](AUDIO-E-CONEXAO.md).

A [release pública 0.7.0](https://github.com/labarro/Voxy/releases/tag/v0.7.0) está disponível pelo atualizador e em `release/0.7.0/Voxy-Setup-0.7.0-x64.exe`. Instale por cima, sem desinstalar. O protocolo de mídia permanece 2; para presença e mensagens privadas, atualize o host e os interlocutores. Depois da primeira conexão, a identidade de cada perfil fica vinculada ao dispositivo e clientes antigos desse mesmo perfil podem precisar atualizar.

A migração adiciona contatos, identidade e mensagens privadas ao banco, sem remover servidores ou mensagens de canais. O backup inclui `direct-inbox.json` e `profile-identity.bin`. Não apague ou troque a identidade durante uma atualização. DMs, status e navegação: [CONVERSAS-E-STATUS.md](CONVERSAS-E-STATUS.md).

## Como funciona

**Publicação inicial: 0.4.1.** A tag 0.4.0 foi preservada no Git, mas seu workflow falhou antes de publicar arquivos. A 0.4.1 prepara explicitamente os binários verificados do Electron em instalações limpas e inclui todos os recursos da linha 0.4. Para instalar hoje, use `release/0.7.0/Voxy-Setup-0.7.0-x64.exe`; instalações até 0.3.0 precisam recebê-lo uma última vez manualmente, sem desinstalar. Quem já instalou o pacote local 0.4.0 poderá receber a 0.4.1 pelo atualizador.

O Voxy usa o mesmo identificador de aplicativo em todas as versões. O instalador novo atualiza os arquivos do programa por cima da instalação existente; não é necessário desinstalar ou apagar pastas.

Perfil, UUID, avatares, volumes, preferências, servidores, mensagens e imagens ficam separados do programa em `%APPDATA%\voxy-desktop`. Na atualização iniciada pelo aplicativo, um backup dos dados é criado antes de fechar a chamada e executar o instalador.

A versão 0.4.0 acrescenta busca e download automáticos pelo domínio devbarros.com e GitHub Releases, com assinatura dos metadados, conferência do pacote e reinício escolhido pelo usuário. A configuração de publicação já está ativa; veja [ATUALIZACOES-REMOTAS.md](ATUALIZACOES-REMOTAS.md). O instalador manual continua disponível para migração inicial e recuperação.

## Atualizar para 0.7.0

Distribua `release/0.7.0/Voxy-Setup-0.7.0-x64.exe` e o `SHA256SUMS.txt` correspondente. No Voxy 0.2.0 ou posterior, abra **Engrenagem → Conta → Atualizações → Selecionar novo instalador → Fazer backup e atualizar**, sem desinstalar. Todos devem atualizar: a versão 0.4.0 usa quatro trilhas de mídia e rejeita o protocolo antigo, nos dois sentidos.

São preservados perfil, volumes, mensagens e imagens. O banco recebe `ownerId` e `icon` nos servidores; o host assume os servidores antigos sem criador. `recent-rooms.json` guarda metadados e convites protegidos pelo Windows e também entra no backup. O histórico de recentes só começa a ser preenchido a partir dos acessos na 0.4.0; versões antigas não guardavam convites.

Webcam, imagem de servidor, Home com recentes e canal global de novidades são apresentados no popup da primeira abertura. O canal **Novidades do Voxy** inclui versões anteriores e continua disponível offline. Câmeras não são abertas automaticamente ao atualizar ou reconectar.

Para publicar versões futuras, adicione a entrada em `src/shared/releases.json` com `date` no formato `AAAA-MM-DD`, `title`, `items` (resumo do popup) e as listas `features`, `improvements` e `fixes`. A lista pode estar vazia quando não houver alterações na categoria. O empacotamento exige esses campos na versão corrente. O canal é somente leitura e combina o catálogo instalado com o último catálogo remoto assinado. O workflow de tags publica o mesmo changelog no GitHub.

## Histórico: atualizar para 0.3.0

Se você já usa 0.2.0, abra a engrenagem → **Atualizações** → **Selecionar novo instalador**, escolha `Voxy-Setup-0.3.0-x64.exe` e use **Fazer backup e atualizar**. Envie também `SHA256SUMS.txt` da mesma pasta para seus amigos. O perfil, os volumes e o histórico são preservados. O banco recebe a coluna de indicação de mensagens editadas ao abrir; não há exclusão do histórico.

A versão 0.3.0 inclui tecla de PTT capturada no teclado, controle de entrada/sensibilidade, edição/exclusão de mensagens, modais centralizados, HUD que se oculta e som de início de transmissão. O aviso de novidades aparece uma vez nesta versão. Perfis antigos recebem volume de entrada de 100% e detecção desligada.

Também inclui ícone de áudio silenciado nos participantes, selo vermelho **AO VIVO** e mute local pelo clique direito. O mute local é lembrado por perfil e afeta somente a voz dessa pessoa para você; volumes e áudio da transmissão continuam independentes.

Agora também é possível escolher uma foto local para o perfil (PNG/JPEG/WebP, até 5 MB, reduzida para 128 px), mantendo emojis como alternativa. Atualize todos os clientes para 0.3.0 antes de usar fotos: elas são representadas por referências no estado compartilhado. O host cria uma tabela de miniaturas sem alterar o histórico existente.

## Atualizar de 0.1.0/0.1.1 pelo instalador

Essas versões antigas ainda não têm o botão de atualização:

1. Receba `Voxy-Setup-0.3.0-x64.exe` de quem mantém o projeto.
2. Encerre a chamada e feche o Voxy.
3. **Não desinstale o Voxy e não apague a pasta de dados.**
4. Execute o instalador novo e mantenha o mesmo usuário do Windows e a pasta de instalação existente.
5. Abra o Voxy. Seu perfil e dados continuam no mesmo diretório. O histórico permanece no computador que hospedava a sala.
6. O popup da versão 0.3.0 apresenta as novidades. Depois de fechar o aviso, ele não aparece novamente nessa versão.

Se quiser uma cópia adicional antes dessa primeira atualização, feche o Voxy e copie `%APPDATA%\voxy-desktop` para uma pasta de backup.

## Atualização automática a partir da 0.4.0

Com o canal de publicação ativo, o programa verifica ao iniciar e a cada seis horas, baixa em segundo plano e mostra **Reiniciar e atualizar**. Também é possível consultar em **Engrenagem → Conta → Atualizações**. Só reinicia ao clicar; a chamada é encerrada, e os dados são salvos e copiados para backup antes de instalar. As novidades ficam no canal global e no aviso único da nova versão. O download pode ser completo se não houver cache diferencial.

## Alternativa manual a partir da versão 0.2.0

1. Receba o novo instalador, por exemplo `Voxy-Setup-0.2.1-x64.exe`, e o arquivo `SHA256SUMS.txt` correspondente. Salve os dois na mesma pasta.
2. Abra a engrenagem do Voxy e localize **Atualizações**.
3. Clique em **Selecionar novo instalador** e selecione o `.exe` recebido.
4. Confira a versão, o tamanho e o SHA-256 apresentados. Se existir `SHA256SUMS.txt` na pasta, o Voxy exige que o hash corresponda ao arquivo. Sem esse arquivo, a interface informa que não há hash de referência.
5. Avise os amigos antes de continuar: sua chamada será encerrada. Se você for o host, a sala inteira será encerrada temporariamente.
6. Clique em **Fazer backup e atualizar**.
7. O Voxy salva os dados, cria o backup e inicia o instalador em modo silencioso sobre a instalação atual. Não desligue o computador durante a atualização. O Windows pode pedir autorização ou exibir aviso de editor desconhecido.
8. Reabra pelo atalho se o programa não abrir automaticamente. Hospede novamente ou conecte-se à sala.

O aplicativo rejeita instaladores com nome/formato inválido, versões iguais ou mais antigas, hash de referência divergente ou arquivo alterado depois da seleção. Um SHA-256 confere integridade, mas não comprova a identidade de quem enviou: use arquivos da pessoa responsável pelo projeto. O executável ainda não é assinado digitalmente.

Não é preciso redefinir nome, avatar ou volumes depois de uma atualização. Todos devem usar a mesma versão para recursos novos funcionarem corretamente.

## Onde ficam os backups

```text
%APPDATA%\voxy-desktop\backups\DATA-HORA-vVERSAO\
```

O backup contém os arquivos existentes entre `profile.json`, `room.sqlite`, `host-secret.bin`, `release-notes.json`, `recent-rooms.json` e `remote-release-history.json`, `direct-inbox.json` e `profile-identity.bin`. O banco inclui o chat e as imagens do host. As notas já lidas também são preservadas.

Se você usa `VOXY_DATA_DIR` para testes, dados, backups e arquivos de atualização ficam nesse diretório alternativo. O uso normal do aplicativo instalado não exige essa variável.

Para recuperar um backup, feche o Voxy, copie a pasta de dados atual para outro local por precaução e copie os arquivos do backup escolhido de volta ao diretório de dados. Não restaure o banco enquanto o host estiver aberto. O segredo protegido pelo Windows deve ser restaurado no mesmo usuário do Windows. Restauração de dados e retorno para uma versão antiga não são automáticos; consulte quem mantém o projeto antes de tentar downgrade.

## Para quem publica as próximas versões

1. Preserve `name: voxy-desktop`, `appId: dev.voxy.desktop`, nome do produto e o local de armazenamento. Mudar esses identificadores pode criar outra instalação/perfil em vez de atualizar a existente.
2. Aumente a versão do projeto, por exemplo:

   ```powershell
   npm version patch --no-git-tag-version
   ```

3. Adicione uma entrada com essa mesma versão em `src/shared/releases.json`, com `title` e `items`. O empacotamento recusa uma versão sem novidades cadastradas.
4. Faça alterações de banco de forma compatível, preservando registros existentes. Não apague nem recrie o banco do usuário para migrar o esquema.
5. Execute os testes e gere a distribuição:

   ```powershell
   npm test
   npm run test:media
   npm run test:desktop
   npm run dist
   npm run test:packaged
   ```

6. A saída fica em `release\VERSAO\`. Envie aos amigos o `Voxy-Setup-VERSAO-x64.exe` e o `SHA256SUMS.txt` gerados nessa mesma pasta. Não misture checksum de outra versão.
7. `update.json` contém versão, arquivo, tamanho e hash para conferência; ele não é um serviço de atualizações online. `latest-build.json` aponta para a pasta `build-*` usada nos testes do executável empacotado.
8. Antes de distribuir amplamente, valide uma atualização real de uma versão anterior em um Windows de teste, confira o perfil/histórico e verifique o popup na primeira e na segunda abertura.

A identidade do instalador e as opções de preservação seguem a [documentação oficial do NSIS no electron-builder](https://www.electron.build/docs/nsis/). O instalador mantém `appId`, nome e diretório de dados estáveis; não altere esses identificadores para publicar uma atualização comum.

## Novidades apenas uma vez

Cada versão tem seu próprio conteúdo em `src/shared/releases.json`. O Voxy registra as versões cujo aviso foi fechado em `release-notes.json`, separado da instalação. Reabrir o programa ou instalar novamente a mesma versão não repete o aviso. Uma versão nova apresenta suas próprias novidades. Se o arquivo de notas lidas for apagado, o aviso pode aparecer novamente.

## Limites da validação

Validação de versão, hash, alteração posterior do arquivo, preservação do banco antigo, backup e notas lidas possuem testes automatizados. A execução de uma atualização NSIS sobre uma instalação pessoal existente não foi automatizada neste ambiente, para não substituir a instalação do usuário. Use um Windows de teste para validar esse último passo antes de distribuir uma versão nova.
