# Regras de manutenção do Voxy

Estas instruções se aplicam a todo o repositório e devem ser lidas antes de alterar o aplicativo.

## Obrigatório após toda atualização

Uma atualização do aplicativo só está concluída quando os três itens abaixo estiverem atualizados e coerentes entre si:

1. **README:** atualizar `README.md` com a versão, as funcionalidades, correções, instruções e limitações relevantes para o usuário.
2. **Patch notes:** adicionar a entrada da versão em `src/shared/releases.json`, com `date`, `title`, `items`, `features`, `improvements` e `fixes`. Esse catálogo alimenta tanto o canal de novidades quanto o aviso exibido após atualizar. Preservar as entradas anteriores e descrever apenas funcionalidades implementadas.
3. **Versão:** atualizar `package.json`, as versões do projeto na raiz e em `packages[""]` de `package-lock.json`, e `build.directories.output` para `release/<versão>`. Conferir referências de distribuição e exemplos afetados.

Não concluir a entrega, fazer commit ou push de uma atualização deixando um desses itens para depois. Se houver autorização para commit e push, incluir os três no mesmo conjunto de alterações.

## Escolha e estado da versão

- Usar uma versão superior à última distribuída: PATCH para correções e ajustes compatíveis; MINOR para novas funcionalidades; MAJOR para mudanças incompatíveis conforme o estágio do produto.
- Definir uma versão para cada atualização. Correções e commits complementares do mesmo conjunto ainda não publicado permanecem na versão em preparação, consolidando suas notas; não incrementar a versão a cada commit isolado.
- Distinguir no README a versão do código em preparação da última versão efetivamente publicada. Manter links de download apontando para artefatos existentes. Não afirmar que um instalador foi publicado apenas porque houve build, commit ou push.
- Ao publicar, a tag `v<versão>`, o pacote, o instalador, o manifesto e as notas devem corresponder à mesma versão. Alterar a versão ou este arquivo não autoriza, por si só, uma publicação externa.

## Conferência antes da entrega

- Executar `npm test` e `npm run build`, além dos testes de integração apropriados às funcionalidades alteradas.
- Confirmar que existe uma entrada completa em `src/shared/releases.json` para a versão de `package.json` e que o aviso de novidades aparece uma vez para quem atualizou de uma versão anterior.
- Conferir a igualdade das versões em `package.json` e `package-lock.json`, a pasta de saída e a indicação da versão no README.
- Atualizar os guias específicos afetados e informar o que foi verificado. Não apresentar validação sintética como teste com microfones físicos ou computadores de usuários.
- Para uma alteração exclusivamente documental, sem mudança distribuível do aplicativo, manter a versão atual e registrar a documentação na versão em preparação quando pertinente.

## GitHub Actions da release

Quando a atualização estiver autorizada para lançamento, o fluxo obrigatório inclui executar e acompanhar `.github/workflows/release.yml`; commit e push sozinhos não entregam a atualização aos usuários.

1. Enviar o commit validado para `main` e confirmar que README, notas e versão estão sincronizados.
2. Conferir se `v<versão>` já existe. Para uma versão inédita, criar a tag no commit correto e enviá-la ao `origin`; isso dispara o workflow. O disparo manual também deve usar a tag, pois `scripts/validate-release.mjs` exige correspondência com o pacote.
3. Acompanhar o Actions até a conclusão, incluindo testes, geração/assinatura dos artefatos, teste do executável empacotado e publicação. Se falhar, investigar e corrigir; não informar sucesso apenas porque o workflow iniciou.
4. Confirmar a release publicada, os arquivos de atualização e o catálogo assinado. Só então atualizar o README com o novo download publicado e informar o resultado ao usuário.

Não sobrescrever uma versão estável publicada. Uma correção posterior exige nova versão. A falta de login no `gh` não impede disparar pelo push da tag quando as credenciais do Git já funcionam; o resultado de um repositório público pode ser consultado pela API pública do GitHub. Não imprimir credenciais ou chaves de assinatura.
