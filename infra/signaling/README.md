# Sinalização experimental nativa

Este serviço oferece apenas rendezvous autenticado. Mensagens, anexos e mídia continuam P2P/host; o HTTP legado não é exposto. A implantação e o relay vêm desativados. Nenhum script deste diretório contrata serviços ou publica automaticamente.

## Desenvolvimento local

```powershell
npm ci --prefix infra/signaling --ignore-scripts
npm run check --prefix infra/signaling
npm test --prefix infra/signaling
npm run build --prefix infra/signaling
npm run test:native --prefix infra/signaling
npm run test:host --prefix infra/signaling
npm run test:session --prefix infra/signaling
```

Os três últimos exigem os executáveis Rust debug atualizados. O emulador escuta somente loopback. Os testes comuns usam perfis/mídia sintéticos e não abrem microfones. Eles não homologam internet pública, acústica, CGNAT ou retransmissão.

## Preparação da conta em uma única etapa

O operador precisa fornecer o Account ID, um subdomínio de uma zona já controlada na Cloudflare e autenticação Wrangler (login local ou token de escopo mínimo para Workers/Durable Objects e domínio escolhido). Primeiro confira efetivamente o plano **Free** e as cotas compartilhadas disponíveis. Não aceite checkout, upgrade ou ativação de TURN.

```powershell
npm run prepare:deploy --prefix infra/signaling -- --account-id SEU_ACCOUNT_ID --hostname SEU_SUBDOMINIO --free-plan-confirmed
```

O comando valida os valores e grava somente `.local/signaling/wrangler.json`, ignorado pelo Git. A configuração gerada mantém `VOXY_DEPLOYMENT_ENABLED=false`, `VOXY_RELAY_ENABLED=false`, logs e previews desativados. Não acessa a conta nem verifica o plano por API: a declaração do operador precisa corresponder à conta real.

Não há secret permanente de sinalização: os hosts assinam seus convites e os clientes provam posse Ed25519 por conexão. A credencial Cloudflare pertence exclusivamente ao ambiente do administrador; nunca colocá-la em convite, binário, código ou configuração pública. Não existe integração TURN habilitável neste serviço.

Depois de autorização explícita de implantação, o operador pode revisar a configuração gerada, alterar somente o gate de implantação e executar Wrangler com `--config .local/signaling/wrangler.json`. A publicação de staging exige conferir DNS/TLS/WSS, plano Free e uso/cotas na conta. O arquivo versionado continua desativado. `npm run build` apenas empacota com `--dry-run` e não publica.

## Política de segurança e limites

- Convites com capacidade aleatória de 256 bits, assinatura do host, validade máxima de sete dias e endpoint/sala vinculados. Nenhum diretório enumerável público.
- WSS público; WS somente loopback no cliente. Sem credenciais em URLs e sem origens de navegador.
- Prova de posse por admissão com timestamp e nonce; replay de admissão bloqueado pelo orçamento global. Um vínculo por identidade e dez participantes por sala.
- Sinais vinculados a identidade, sala, nonce de conexão, sequência por destinatário/geração e prazo. Remetentes emitem prazo de 30 s; receptores aceitam no máximo 60 s para acomodar os 30 s de diferença de relógio admitidos no handshake. O cliente verifica a assinatura antes de aplicar SDP/ICE.
- SDP/envelope limitado a 64 KiB; ICE a 4 KiB; payload somente descrição ou candidato. Rate limit por conexão também cobra bytes de mensagens grandes. Não usar WebSocket de sinalização para chat, arquivos, voz, vídeo, movimento ou jogos.
- Rotação `rotate-invite` exige a conexão autenticada do host, nonce atual e novo convite assinado da mesma sala/origem/chave. O Worker persiste o novo hash, notifica/encerra convidados e confirma `invite-rotated`. O host corta também as conexões P2P antes de anunciar sucesso. Renovar exige redistribuir o novo convite; anteriores passam a ser recusados.
- Metadados limitados: registro do host/capacidade em hash, estado dos sockets hibernáveis e orçamento global. Sem históricos ou anexos na nuvem. Os contadores diários preservam registros ativos ao atravessar UTC midnight.
- Limites padrão: 1.000 admissões/dia e dez salas ativas, com rejeição ao esgotar. Limites do aplicativo não impedem requisições de chegarem à plataforma, não substituem proteção de borda e não garantem teto financeiro em plano Paid.

Antes de habilitar publicamente: revisar abuso antes da autenticação/anti-Sybil, validar dois provedores, CGNAT, UDP bloqueado, expiração/revogação, reconexão e cota esgotada. **TURN permanece bloqueado** até existir política financeira efetiva homologada. Não prometer conectividade universal nem custo zero em uma conta Paid.
