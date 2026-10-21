# Atualizações remotas do Voxy

O Voxy 0.4.0 inclui atualização automática com **electron-updater + NSIS**, publicações no **GitHub Releases** e o endereço **https://devbarros.com/voxy/updates/** na Vercel. A mídia das chamadas continua P2P pelo Radmin VPN; o serviço de atualização não participa das chamadas.

**Estado da entrega:** código, workflow e arquivos de configuração implementados; download diferencial e fallback completo testados localmente com o atualizador real. O ambiente `release` e o segredo de assinatura já foram configurados no GitHub, com política para tags `v*`. Os dois redirects foram publicados na `main` do portfólio (commit `3ac5886`) e verificados em produção. A [release 0.4.1](https://github.com/labarro/Voxy/releases/tag/v0.4.1) foi publicada pelo [workflow concluído com sucesso](https://github.com/labarro/Voxy/actions/runs/39516455777). Os dois endpoints responderam 200 e o atualizador real baixou e verificou o pacote público, chegando a pronto para instalar. Não foi executada uma instalação automática sobre a instalação pessoal deste computador.


**Versão pública atual: 0.5.0.** Publicada pelo [Actions](https://github.com/labarro/Voxy/actions/runs/39525732143), com os cinco arquivos verificados. O atualizador real partindo da 0.4.1 detectou, baixou e validou a nova versão pelo domínio até ficar pronto para instalar. Evidência: `evidence/publication-0.5.0.json`. A instalação/reinício NSIS numa máquina separada permanece pendente.

## Por que esta arquitetura

| Alternativa                                      | Avaliação                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `electron-updater` com NSIS                      | Escolhida: compatível com o instalador existente, progresso, cache, download diferencial e instalação ao reiniciar.                |
| `autoUpdater` nativo/Squirrel.Windows            | Exigiria mudar o empacotamento e o fluxo existente. Não traz vantagem para este projeto.                                           |
| Instaladores servidos por uma Function da Vercel | Acrescenta limites de payload e processamento desnecessários para arquivos grandes.                                                |
| GitHub Releases + redirects na Vercel            | Escolhida: arquivos públicos de versão, suporte a downloads parciais e publicação integrada ao repositório, sem manter um backend. |
| S3/R2 ou serviço comercial de atualização        | Possíveis no futuro, mas exigem mais credenciais, configuração e eventual cobrança.                                                |

O suporte NSIS e o fluxo de `latest.yml` são documentados pelo [electron-builder 26](https://www.electron.build/v26/docs/features/auto-update/). A Vercel permite [redirects externos em vercel.json](https://vercel.com/docs/project-configuration/vercel-json). O GitHub documenta a distribuição de binários em [Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases). Os planos e limites desses serviços continuam sujeitos às regras dos provedores.

## Fluxo para quem usa

1. Cerca de dez segundos após abrir o Voxy instalado, ele consulta a versão publicada. Repete a consulta a cada seis horas; a engrenagem também oferece **Verificar atualizações**.
2. Valida a assinatura dos metadados e consulta os arquivos da tag específica no GitHub. O download começa automaticamente em segundo plano.
3. Um aviso no aplicativo mostra disponibilidade e progresso; o Windows também pode exibir uma notificação, conforme suas permissões.
4. Ao concluir, aparece **Reiniciar e atualizar**. O programa não reinicia no meio de uma chamada por conta própria e não instala simplesmente ao fechar.
5. Ao clicar, o Voxy confere novamente o instalador, salva e faz backup dos dados, encerra a chamada e inicia o NSIS. Se você hospeda, a sala é encerrada temporariamente.
6. O programa abre novamente. Perfil, mensagens, recentes e preferências continuam em `%APPDATA%\voxy-desktop`. O popup de novidades aparece uma vez por versão.

O canal **Novidades do Voxy** combina o catálogo instalado com o último catálogo remoto cuja assinatura foi validada. Funciona sem servidor de amigos e mantém o histórico em cache para uso offline. Conteúdo remoto é texto estruturado, sem HTML executável.

**Primeira migração:** versões até 0.3.0 não têm este atualizador. Instale a 0.5.0 uma última vez usando `release/0.5.0/Voxy-Setup-0.5.0-x64.exe`, sem desinstalar, ou o seletor de instalador existente. Depois, novas versões podem chegar pelo aplicativo. Todos os participantes precisam migrar, pois a 0.4.0 muda o protocolo para suportar webcam.

## Preparação única: chave de publicação

**Já configurado em 20/10/2026:** secret `VOXY_UPDATE_SIGNING_PRIVATE_KEY` no ambiente `release` de `labarro/Voxy`, enviado cifrado pela API do GitHub e confirmado por seus metadados. Os passos abaixo servem para manutenção/recuperação.

A chave pública já está em `src/shared/update-trust.json`. A chave privada correspondente foi gerada neste computador e está em **`.local/update-signing-key.dpapi`**, protegida pelo Windows para o usuário atual e ignorada pelo Git.

1. No GitHub, abra **labarro/Voxy → Settings → Environments** e crie o ambiente **release**. Restrinja as tags autorizadas e configure revisão se desejar.
2. Neste computador e usuário do Windows, execute:

   ```powershell
   npm run updates:export-key
   ```

3. O comando copia o PEM privado para a área de transferência, sem imprimi-lo. Cole-o somente em um **Environment secret** chamado **`VOXY_UPDATE_SIGNING_PRIVATE_KEY`**, no ambiente `release`. Não crie variável pública e não coloque o PEM em arquivos versionados.
4. Faça também backup recuperável desse PEM em um gerenciador de senhas seguro. O arquivo DPAPI sozinho depende deste usuário/instalação do Windows. Limpe a área de transferência e seu histórico após salvar o segredo.
5. Confirme que GitHub Actions está habilitado. O workflow usa o `GITHUB_TOKEN` temporário com `contents: write` apenas no job de publicação; nenhum token GitHub é distribuído aos clientes.

Não execute `updates:keygen` novamente para publicar cada versão. Uma nova chave que os aplicativos instalados não conhecem bloqueia as atualizações.

O projeto é público e os arquivos de release também serão públicos. Se o repositório passar a ser privado, será necessário um canal público separado de distribuição; não embuta um PAT no aplicativo.

## Preparação única: devbarros.com na Vercel

**Já publicado em 20/10/2026:** configuração no repositório `labarro/portfolio`, commit `3ac5886`, com deploy automático confirmado pelas respostas HTTP. O domínio sem `www` redireciona para `www.devbarros.com`; o aplicativo usa diretamente `https://www.devbarros.com/voxy/updates/` para respeitar a lista restrita de destinos. O site principal continua respondendo 200.

No projeto **que já atende devbarros.com**, incorpore os dois objetos de `deployment/vercel-updates.fragment.json` ao array `redirects` do seu `vercel.json`. Preserve as outras configurações do site e coloque estas rotas antes de regras genéricas conflitantes.

```json
{
  "redirects": [
    {
      "source": "/voxy/updates/voxy-release.json",
      "destination": "https://github.com/labarro/Voxy/releases/latest/download/voxy-release.json",
      "permanent": false
    },
    {
      "source": "/voxy/updates/latest.yml",
      "destination": "https://github.com/labarro/Voxy/releases/latest/download/latest.yml",
      "permanent": false
    }
  ]
}
```

Faça deploy desse projeto. Não é preciso alterar DNS, mover o domínio ou hospedar o Electron na Vercel. Garanta que essas duas rotas não exijam login, proteção de preview ou desafio de bot. Use redirects temporários, sem cache permanente para a versão “latest”.

Depois da primeira release publicada, confira:

```powershell
curl.exe -I https://devbarros.com/voxy/updates/voxy-release.json
curl.exe -L --fail https://devbarros.com/voxy/updates/voxy-release.json -o voxy-release-check.json
```

A primeira requisição deve redirecionar ao GitHub e a segunda deve retornar um envelope JSON com `payload` e `signature`. Antes de existir uma release com esse arquivo, o destino pode retornar 404.

O domínio serve como ponto de entrada para metadados pequenos. Os instaladores e blockmaps vêm diretamente dos endereços imutáveis `github.com/labarro/Voxy/releases/download/vVERSAO/...`. Se a consulta ao domínio falhar, o aplicativo tenta o endpoint oficial do GitHub. Uma assinatura inválida nunca é aceita como alternativa.

## Publicar uma versão

1. Desenvolva na branch de funcionalidade e integre à `main` depois de revisar/testar.
2. Atualize `version` no `package.json` e lockfile e `build.directories.output` para `release/VERSAO`. Use versão estável `X.Y.Z`, sem reutilizar número publicado.
3. Adicione a entrada correspondente em `src/shared/releases.json`: `date` (`AAAA-MM-DD`), `title`, `items` para o popup e arrays `features`, `improvements`, `fixes`. Preserve entradas anteriores.
4. Execute `npm test`, `npm run build` e os testes de mídia/desktop pertinentes. Revise as mudanças e faça commit na `main` pelo fluxo do projeto.
5. Com a `main` atualizada no remoto, crie e envie a tag. Exemplo para a próxima versão:

   ```powershell
   git switch main
   git pull --ff-only origin main
   git tag -a v0.5.1 -m "Voxy 0.4.2"
   git push origin v0.5.1
   ```

6. Acompanhe **Actions → Publicar Voxy para Windows**. O workflow valida tag/versão e ancestralidade na `main`, instala com `npm ci`, roda os testes, gera o instalador, assina os metadados e testa o executável empacotado.
7. Só depois cria/preenche uma release em rascunho com todos os arquivos e a publica como `latest`. Uma execução manual deve selecionar uma **tag**, não a branch `main`.
8. Confirme os arquivos e faça o teste com um Windows de validação usando a versão anterior. O domínio passa a apontar para a nova release sem um novo deploy do site.

Arquivos obrigatórios publicados juntos: `Voxy-Setup-VERSAO-x64.exe`, `.exe.blockmap`, `latest.yml`, `voxy-release.json` e `SHA256SUMS.txt`. O changelog da release é gerado do mesmo catálogo usado pelo aplicativo. Nunca substitua assets de uma release já publicada; o workflow bloqueia essa operação. Se houver erro, publique uma versão superior corrigida.

Para build local, `npm ci` e `npm run dist`. Neste computador a assinatura usa a chave DPAPI; em outro ambiente forneça o segredo por variável de ambiente segura. `npm run pack` gera somente o diretório executável e não precisa assinar um manifesto de publicação.

## Integridade, autenticidade e assinatura Windows

- Todo transporte de produção usa HTTPS. O carregador dos metadados limita tamanho, tempo e destinos de redirecionamento.
- `voxy-release.json` contém um payload assinado com **Ed25519**. As chaves públicas confiáveis vêm no aplicativo, não da resposta do servidor. A verificação ocorre antes de usar versão, changelog ou URLs.
- O payload fixa repositório, versão, nomes, tamanhos e **SHA-512** do instalador/blockmap e do `latest.yml`. O resultado do provedor nativo também precisa corresponder aos metadados autorizados.
- O SHA-512 do instalador é conferido no hook de validação do `NsisUpdater`, depois do download e novamente imediatamente antes de instalar. Um hash isolado não autentica o editor; a assinatura do payload é o vínculo de autenticidade.
- O cache de uma versão já validada impede aceitar um catálogo remoto anterior. Não há serviço de timestamp externo nem proteção absoluta contra replay na primeira instalação; o programa não instala versões inferiores à sua própria.
- A chave privada fica no secret do ambiente de release e na cópia local protegida. Comprometer essa chave ou o pipeline autorizado continua sendo um risco: proteja a conta GitHub, a `main`, as tags e o ambiente de release.

A assinatura Ed25519 **não é Authenticode** e não remove avisos do SmartScreen. Atualmente o `.exe` não tem certificado de editor Windows. Se adquirir um certificado, configure `authenticodePublisher` com o CN exato em `src/shared/update-trust.json` e os secrets `CSC_LINK`/`CSC_KEY_PASSWORD`. O build passa a exigir assinatura e o atualizador confere também o editor pelo mecanismo oficial. Consulte [assinatura Windows no electron-builder](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).

A versão estável instalada do electron-builder não oferece a assinatura Ed25519 de manifesto disponível em documentação de versões futuras. Por isso o projeto usa a criptografia do Node e o hook oficial `verifyUpdateCodeSignature` do `NsisUpdater`, preservando o download/instalação da biblioteca. Não implementa um instalador próprio nem executa comandos recebidos do endpoint.

### Trocar a chave com segurança

Faça uma migração em duas etapas: primeiro distribua, **assinada pela chave antiga**, uma versão que confie nas chaves antiga e nova. Só depois passe o CI a assinar com a nova. `node scripts/update-keys.mjs --rotate` acrescenta a pública e guarda uma cópia DPAPI da chave anterior, mas troca a chave local ativa: para a primeira etapa use a chave antiga no CI. Não remova a confiança antiga enquanto clientes ainda dependerem dela. Perder ou comprometer a única chave pode exigir nova instalação manual.

## Download diferencial e falhas

O NSIS usa `.blockmap`, cache do instalador anterior e requisições HTTP Range para baixar apenas blocos alterados e reconstruir o instalador completo. O arquivo reconstruído passa pelas mesmas verificações. Não é hot reload: ainda exige reiniciar para trocar o programa.

No teste local entre os instaladores reais 0.3.0 e 0.4.0, o atualizador baixou aproximadamente **11%** do tamanho integral. Isso não garante a mesma economia em outras versões. Mudanças grandes no Electron, cache ausente ou blockmap indisponível podem resultar em download completo. O fallback completo também foi exercitado com sucesso. Preserve releases e blockmaps antigos.

Se rede, assinatura, hash ou download falhar, o aplicativo continua utilizável e oferece nova tentativa nas configurações. Não fecha a chamada antes de verificar o pacote. Na instalação explícita, faz backup de perfil, banco, segredo do host, recentes, notas lidas e catálogo remoto existente. Uma falha ao iniciar o instalador é apresentada ao usuário.

Não há rollback automático garantido de uma instalação NSIS interrompida, nem migração reversa do banco. Corrija preferencialmente com uma versão maior. Para recuperação, feche o aplicativo, preserve a pasta de dados atual, reinstale um pacote confiável e restaure o backup compatível conforme [o guia de atualização](GUIA-DE-ATUALIZACAO.md). Não desinstale apagando dados nem faça downgrade de banco sem revisão. Mantenha migrações aditivas e teste atualização em uma máquina separada antes de publicar.

## Validação e pendências

`npm test` verifica assinatura, adulteração, replay, metadados inconsistentes, ausência de instalação indevida, backup e ordem de reinício. `npm run test:updater` usa Electron/NSIS reais e um servidor Range local para diferencial e fallback, sem executar o instalador. Esse último teste requer o instalador/blockmap local 0.3.0 e o da versão corrente; não altera a instalação pessoal. `npm run test:packaged` abre o ASAR duas vezes e verifica persistência e histórico offline.

A publicação pública, os redirects, o secret e o download/verificação reais já foram validados com a 0.4.1. Permanece pendente executar instalação/reinício real numa máquina Windows de teste. A conexão de dez computadores físicos pelo Radmin e diferentes webcams físicas também permanece no roteiro manual de [TESTING.md](TESTING.md).
