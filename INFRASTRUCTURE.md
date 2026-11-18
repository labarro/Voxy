# Infraestrutura experimental — Voxy 2.0

## Atualização implantada em 18/11/2026 (Beta 3)

Versão do Worker `9c6ca307-714e-4e78-a875-ef19645ea49b`, implantada com `wrangler deploy --config .local/signaling/wrangler.json` (`routes: []`; o Custom Domain existente não foi alterado). Health: `{"protocol":3,"relay":false,"codes":true,"passes":true}`. Autorização do usuário: alterações estritamente necessárias para os convites, sem custo e sem afetar outros serviços.

- **Nova classe `InviteCodes`** (Durable Object SQLite, migration `v2`, disponível no plano Free). Instância global única com códigos de 8 caracteres → convite atual da sala. Entradas expiram com o convite e são apagadas na rotação; há limpeza oportunista.
- **Rotas novas:**
  - `GET /join/CODE`: página HTML estática sem consulta ao armazenamento e sem o segredo, logo não permite enumerar códigos.
  - `GET /v3/code/CODE` (WebSocket): resolve o código, com 10 consultas/minuto por endereço e 600 falhas globais por 10 minutos.
- **Acesso salvo** (`X-Voxy-Pass`): assinado pela chave do host registrada para a sala, vinculado à chave do membro (prova de posse obrigatória), com validade máxima de 180 dias e época mínima armazenada na sala. O `rotate-invite` pode elevar a época, nunca reduzir.
- **Admissão consumida só depois** de a sala confirmar o host online: tentativas com o servidor offline e recusas não gastam a cota diária de 1.000.
- **Reconexão da mesma identidade** substitui o socket antigo (mensagem `replaced`) em vez de recusar.

Impacto nos limites gratuitos (estimativa, não medição de faturamento):
- Cada convidado aguardando um host offline faz 1 requisição de Worker + 1 de Durable Object a cada 20 s, enquanto o aplicativo estiver aguardando. Três convidados por 1 hora somam cerca de 1.080 + 1.080, ante o limite diário de 100.000 de cada.
- Registrar código: 1 mensagem por hospedagem ou rotação. Resolver código: 1 requisição + 1 DO.
- Armazenamento: algumas centenas de bytes por sala ativa (no máximo dez salas).
- Sem D1/R2/TURN/SFU; relay continua desligado.

## Estado implantado em 17/11/2026

Endpoint **wss://voxy.devbarros.com**, health [HTTPS](https://voxy.devbarros.com/health). Worker voxy-native-signaling-experimental, classes SignalRoom e AdmissionBudget com SQLite migration v1 e WebSocket Hibernation. VOXY_DEPLOYMENT_ENABLED=true, VOXY_RELAY_ENABLED=false, 1.000 admissões/dia, dez salas e dez participantes/sala. Não há D1, R2, SFU ou TURN, nem transporte de chat/imagem/voz/jogo pelo Worker.

Wrangler whoami confirmou a conta c94a2b1ed3c401c62b4a8b112479ca18 e permissões Workers/routes/zone/SSL. Zona ativa. Changeset do Custom Domain não encontrou origens ou DNS conflitantes; PUT foi feito com override_existing_dns_record=false e override_existing_origin=false. Nenhum outro serviço/registro do domínio foi alterado. API devolveu o domínio e certificado criados. Versão remota habilitada: c36174b1-0409-4e13-92f3-af73146f23d5. A configuração local fica em .local/signaling/wrangler.json (ignorada pelo Git); o template versionado permanece desativado para não publicar acidentalmente.

**Plano Free confirmado pelo operador.** A API de subscriptions e listagem de DNS retornou 403 para a credencial local; não se afirma auditoria independente de faturamento ou de consumo compartilhado. API workers/account-settings retorna modelo standard, que por si só não atesta plano Free. Nenhuma assinatura, checkout, upgrade ou API faturável de relay foi acionada. Os limites abaixo foram reconferidos na documentação oficial em 17/11/2026; limites internos do Voxy não são teto financeiro de uma conta Paid.

DNS A foi resolvido via HTTPS; HTTPS/TLS e WSS autenticado foram verificados preservando hostname/certificado. O resolvedor Windows desta máquina retorna ENOTFOUND para o novo domínio. Teste público usa override exclusivo de debug após DNS sobre HTTPS; o aplicativo release não contém IP fixo, não ignora TLS e usa DNS normal. [Evidência](evidence/native-2.0/public/session-integration.json).

Três testes públicos passaram: chat/imagens/DMs/histórico/autorizações/IPC entre processos, malha SRTP Opus sintética com três peers e isolamento/gate/revogação, quatro reconexões com histórico. Participantes na mesma máquina; redes distintas, CGNAT/NAT simétrico, IPv6, firewall restritivo e acústica permanecem pendentes. [Roteiro externo](native/PUBLIC-TESTING.md).

O desktop usa endpoint público e stun:stun.cloudflare.com:3478 por padrão; overrides opcionais VOXY_SIGNAL_URL/VOXY_STUN_URLS continuam para desenvolvimento. Convites assinados contêm origem/sala/chave/capacidade/expiração. Nenhum token Cloudflare, SDP, convite ou IP privado aparece no recibo versionado. Host precisa estar online. Sem fallback pago ou exposição do HTTP legado.

## Segurança e operação

Assinaturas Ed25519 e prova de posse por admissão, nonce e timestamp, replay global, expiração/alarmes, hash de capacidade, rotação autenticada do host e corte de vínculos anteriores. Limites de 64 KiB de sinal, ICE 4 KiB, token bucket por conexão cobrado por bytes e orçamento global antes de criar salas. Roteamento isolado por sala/destino/geração. Receptores nativos verificam assinatura de SDP/ICE. Storage contém metadados/cotas e sockets hibernáveis, sem histórico de usuário. Observability, previews e workers.dev desativados.

Comandos: npm test --prefix infra/signaling; npm run check --prefix infra/signaling; npm run test:session --prefix infra/signaling; **npm run test:public --prefix infra/signaling**. Testes físicos continuam opt-in separados. A limitação por conta Free é compartilhada; falhas de cota devem recusar admissão, sem contratar capacidade. Proteção contra tráfego pré-autenticação e revisão anti-Sybil continuam gates de exposição ampla; grupo experimental restrito por convites.

## Referência de custos e arquitetura

## Conjunto mínimo proposto

- Worker: entrada HTTPS, descoberta por convite opaco, validação de sessão e emissão de credenciais temporárias.
- Um Durable Object SQLite por sala: rendezvous/sinalização WebSocket com Hibernation API; guarda apenas identidade do host, convites revogáveis, cotas e estado temporário necessário.
- STUN público Cloudflare para descoberta de candidatos.
- TURN: necessário como fallback para redes restritivas, **desativado até validar proteção financeira no provedor**. Não confundir essa proposta com conectividade universal já disponível.
- Sem D1, R2 ou SFU inicialmente. Mensagens, imagens, cargos e estado autoritativo permanecem no computador do host. GitHub Releases e catálogo assinado continuam sendo a origem de distribuição.

Worker/DO não transportam voz, vídeo ou física de jogo. Anexos e snapshots passam por DataChannels autenticados até o host. Sem isso, a retirada da VPN seria incompleta. O servidor só fica disponível enquanto o usuário host está online; não há promessa de mensagens globais/offline nem migração automática de host.

## Limites e preços oficiais

| Serviço | Gratuidade / recursos | Excedente, cartão e decisão |
| --- | --- | --- |
| Workers Free | 100.000 requests/dia, 10 ms CPU/invocação, 128 MB, 50 subrequests/invocação e 6 conexões **de saída** simultâneas por invocação. WebSocket Upgrade conta como request; egress sem tarifa de tráfego | Manter Free; estourar cota causa indisponibilidade, sem upgrade automático pelo aplicativo. Paid tem mínimo US$5/mês e cobranças adicionais; não autorizado. Documentação confirma Free por padrão, mas a exigência específica de cartão na conta do usuário não foi verificada. [Limites](https://developers.cloudflare.com/workers/platform/limits/), [preços](https://developers.cloudflare.com/workers/platform/pricing/). |
| Durable Objects Free (SQLite) | 100.000 requests/dia, 13.000 GB-s/dia; 5 milhões de linhas lidas/dia, 100.000 escritas/dia, 5 GB total. Até 100 classes/conta; mensagem WebSocket recebida até 32 MiB | Free suporta SQLite, não backend KV legado. Incoming WS tem proporção 20:1 para faturamento de compute requests; não interpretar isso como rate limit de segurança. Esgotamento Free falha. Paid: requests US$0,15/milhão além de 1 milhão/mês, duração US$12,50/milhão GB-s além de 400.000; armazenamento também é faturável. Cartão da conta não verificado. [Preços](https://developers.cloudflare.com/durable-objects/platform/pricing/), [limites](https://developers.cloudflare.com/durable-objects/platform/limits/). |
| STUN Cloudflare | `stun.cloudflare.com`, gratuito e sem limite de uso declarado na FAQ | Não retransmite mídia nem resolve NAT simétrico/firewall sozinho. Não exige credencial TURN para consultas STUN. [FAQ oficial](https://developers.cloudflare.com/realtime/turn/faq/). |
| Realtime TURN + SFU | **1.000 GB/mês compartilhados** entre os dois serviços; não somar duas franquias. Ingress SFU gratuito | Egress US$0,05/GB após franquia. FAQ descreve plano self-service com cartão. Nenhum teto financeiro rígido de TURN foi comprovado nesta auditoria. Desativado; conferir produto/conta e controles antes de habilitar. [Preços](https://developers.cloudflare.com/realtime/sfu/platform/pricing/), [FAQ](https://developers.cloudflare.com/realtime/turn/faq/). |
| D1 Free | 5 milhões de linhas lidas/dia, 100.000 escritas/dia, 5 GB total; sem egress | Free bloqueia consultas no limite; Paid cobra leituras/escritas/storage excedentes. Sem necessidade inicial de banco central adicional; cartão específico não verificado. [Preços e comportamento ao exceder](https://developers.cloudflare.com/d1/platform/pricing/). |
| R2 Standard | 10 GB-mês, 1 milhão de operações A/mês, 10 milhões B/mês; egress gratuito | Excedente US$0,015/GB-mês, US$4,50/milhão A e US$0,36/milhão B. Exige assinatura via checkout, com faturamento por uso; não presumir sem cartão. Infrequent Access não recebe essa franquia e tem outras cobranças. Não utilizar inicialmente. [Preços](https://developers.cloudflare.com/r2/pricing/), [ativação](https://developers.cloudflare.com/r2/get-started/). |

Não confundir seis conexões de saída por invocação com seis participantes WebSocket. O aplicativo imporá dez participantes/sala; capacidade máxima de WebSockets/objeto não é critério de dimensionamento para este grupo. Para DO, CPU por requisição tem teto padrão 30 s/configurável até 5 min conforme documentação específica; o orçamento operacional proposto é muito menor. Hibernation é necessária: 128 MB × 86.400 s ≈ 10.800 GB-s por sala continuamente ativa/dia, próximo de toda a franquia de duração para apenas uma sala. Não usar timers permanentes nem `accept()` convencional mantendo DO acordado. [Limites DO](https://developers.cloudflare.com/durable-objects/platform/limits/), [duração](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Limites gratuitos não são SLA de disponibilidade. Não adotar Cloudflare Tunnel como substituto oculto de relay audiovisual nem Workers como proxy TCP/UDP geral. A voz P2P continua dependendo da conectividade dos participantes e, em parte das redes, de retransmissão.

## Proteção de custos: desenho, ainda não implementado

O provedor introduziu limites de gastos para Workers e DO, mas isso não estabelece um teto rígido de fatura: taxa da assinatura e armazenamento podem ficar fora; WebSockets já abertos, execuções em andamento e atrasos de enforcement podem continuar gerando uso. **Não usar conta Paid com limite US$0 como prova de custo zero.** Manter plano Free é a proteção inicial. [Condições de DO](https://developers.cloudflare.com/durable-objects/platform/spend-management/), [Workers](https://developers.cloudflare.com/workers/platform/pricing/).

Política proposta para staging:

| Controle | Valor inicial conservador, a validar |
| --- | --- |
| Participantes | 10/sala, um vínculo ativo por identidade e geração |
| Salas/convites | Grupo fechado; 10 salas simultâneas/instância de implantação; sem diretório público enumerável |
| Sessão/convite | Convite aleatório ≥128 bits; hash no servidor, validade e revogação; sessão assinada vinculada à chave/host e nonce |
| Emissão de sessão | Até 5/min por origem e 10/min por convite, com orçamento global e limite de tentativas; IP não é identidade e CGNAT exige tolerância |
| Sinalização | SDP ≤64 KiB, ICE ≤4 KiB; 512 mensagens burst/128 por segundo por sessão no início da negociação; negar destino/canal incorreto; limite agregado por sala |
| Worker/DO | Meta ≤20.000 unidades de request/dia e duração ≤2.000 GB-s/dia da implantação; fechar novas admissões em 50% da franquia útil disponível, nunca consumir deliberadamente 100% |
| Storage | ≤100 MB de metadados; TTL e limpeza em lotes, contabilizando deletes/índices; sem históricos, anexos ou vídeo na nuvem |
| TURN | `relay_enabled=false`; após eventual homologação: orçamento experimental 50 GB/mês global reservado atomicamente, TTL curto e renovação autenticada |

Rate limit dentro do Worker não evita o custo da requisição que já chegou. Utilizar limites Free, proteção de borda disponível sem contratar add-ons, convites não enumeráveis e limites globais antes de criar DOs. Contadores autoritativos em DO, persistência limitada e atualizações agrupadas; KV eventualmente consistente não pode ser árbitro de orçamento. Evitar um DO global consultado por cada pacote. Observar uso de outros projetos na conta e fechar admissões se dados estiverem indisponíveis/defasados.

Para TURN, reservar previamente por credencial um orçamento pessimista de bitrate × destinos × duração × overhead, contar sessões concorrentes e nunca confiar somente em contadores do cliente. **Credencial TURN comum não impõe automaticamente limite de bytes ou bitrate por usuário.** Um cliente modificado pode abusar da credencial válida. Analytics têm atraso; TTL limita tempo, não garante volume; bloquear emissão não encerra imediatamente todas as alocações. Logo esse mecanismo reduz risco, mas não cumpre sozinho “nenhuma cobrança não autorizada”. Precisamos comprovar corte no provedor ou usar relay sob controle com limite de tráfego real.

Alternativas se não houver corte verificável: relay comunitário/auto-hospedado pelo operador que **já tenha** conectividade pública e banda sob quota (não resolve CGNAT do anfitrião por magia), serviço com franquia sem faturamento excedente contratualmente confirmado, ou modo direto com aviso explícito de indisponibilidade nas redes que exigem relay. Não foi identificado e homologado nesta sessão um fornecedor que garanta simultaneamente todas essas condições. O modo direto é útil para testes, mas **não aprova a Fase 2 nem o produto final**.

Quando um fallback homologado existir, emitir credenciais temporárias apenas pelo backend, com chave permanente em secret remoto e escopo mínimo. Preferir ICE direto; fornecer relay sob política de admissão e comprovar par selecionado. Reduzir transmissões retransmitidas inicialmente para 480p/15 e 500 kbps; avisar motivo/qualidade e dar prioridade à voz. Se o orçamento não comportar vídeo, bloquear vídeo; se não comportar voz, informar que a conexão não pode ser mantida no plano gratuito. Valores são proposta, não implementação. Opção “ocultar meu IP” exige relay-only e consome franquia; nunca acionar cobrança para cumprir essa preferência.

## Estimativas reproduzíveis, não medições

GB decimais, `GB = bitrate_bps × segundos × fluxos_de_saida / 8 / 1e9`; acrescentar reserva de overhead, retransmissões e pacotes TURN. Fala descontínua pode reduzir uso; não contar com isso para admissão.

| Exemplo inteiramente retransmitido | Payload calculado | Com reserva ilustrativa de 50% |
| --- | --- | --- |
| 6 amigos, 32 kbps/voz, mesh 30 fluxos, 60 h/mês | 25,92 GB | 38,88 GB |
| 10 amigos, 32 kbps/voz, mesh 90 fluxos, 60 h/mês | 77,76 GB | 116,64 GB |
| Uma tela 2 Mbps para 5 receptores, 60 h/mês | 270 GB | 405 GB |
| Uma tela 2 Mbps para 9 receptores, 60 h/mês | 486 GB | 729 GB |

Esses números contam a entrega a cada destinatário; o total faturado real depende de quais pontas usam TURN, caminho selecionado e método do provedor. Não são promessa de horas gratuitas. Com voz e várias telas simultâneas, a franquia pode acabar rapidamente. SFU pode reduzir upload do transmissor mas não elimina egress nem mensalidade excedente; adiar até medições de malha com dez usuários.

Exemplo de sinalização: seis participantes × 30 mensagens/min × 120 min = 21.600 mensagens recebidas/dia (1.080 unidades na proporção 20:1, além de upgrades/HTTP/RPC). É cenário estimado sem 3D/voz no DO. Movimentos 20 Hz × seis pessoas × duas horas seriam 864.000 eventos; enviá-los ao DO desperdiçaria infraestrutura. Mover estado contínuo ao canal P2P.

## Domínio e implantação futura

Nomes configuráveis, sem domínio/credenciais inventados:

| Configuração proposta | Papel |
| --- | --- |
| `VOXY_API_URL` | API HTTPS de sessões/descoberta |
| `VOXY_SIGNAL_URL` | WebSocket WSS de rendezvous |
| `VOXY_INVITE_ORIGIN` | Origem HTTPS para convites; segredo na parte que não é enviada automaticamente em referrer/log |
| `VOXY_UPDATE_URL` | Catálogo experimental assinado, isolado do estável |
| `VOXY_RELAY_ENABLED` | Falso por padrão; não basta para autorizar faturamento |
| `VOXY_RELAY_MONTHLY_BUDGET_BYTES` | Reserva conservadora de relay após homologação |
| Secret remoto `TURN_API_TOKEN` / ID da chave | Somente backend; nunca no binário, `.env` versionado ou logs |

As variáveis são especificação; não há código que as leia ainda. Um mesmo Worker pode servir API/sinalização/convites; separar nomes DNS por organização não exige três serviços. `api.<domínio>`, `signal.<domínio>`, `invite.<domínio>` e `updates.<domínio>` são padrões, não registros criados.

Sequência de implantação ainda pendente:

1. Implementar protocolo e emulador local; validar DO SQLite/hibernation/quotas com testes de expiração, reconexão, abuso e desligamento.
2. Confirmar conta Free e cotas disponíveis; reconfirmar cartão/termos por produto. Qualquer checkout ou mudança para Paid exige autorização explícita, ausente nesta etapa.
3. Preparar configuração Wrangler sem IDs/segredos fictícios, bindings, migração SQLite e domínio informado pelo operador; usar secrets fora do repositório.
4. Implantar staging somente quando dentro do escopo autorizado; TLS/WSS e allowlist de origens/versões; redigir tokens, SDP, IP e convites dos logs. Não criar ambiente estável por acidente.
5. Validar dois ISPs/CGNAT/IPv4/IPv6/TURN TCP/TLS, medir tráfego real e ensaiar cota esgotada/serviço indisponível. TURN TCP/TLS é transporte cliente-relay; não confundir com suporte a relay TCP RFC6062, que a FAQ não oferece. A FAQ também informa relay addresses somente IPv4, apesar de acesso ao serviço por IPv6.
6. Publicar recibo de custos/controles e configuração sem segredos; somente liberar rede de produção após os gates do PLAN.

A sequência acima é a referência histórica; implantação e verificações efetivamente realizadas estão no início deste documento. Diagnóstico exportável deverá informar modo direto/retransmitido, motivo da limitação e estado de cota sem expor IP, SDP, nome de dispositivo ou credenciais.


## Execução contínua — 17/11/2026

Worker verifica sala, esquema, deadline, sequência por destino/nonce, tamanhos e orçamento de bytes. Renovação exige host autenticado; após ack, o host encerra os vínculos antigos. Eventos peer-left são vinculados à geração. Testes locais não homologam internet pública. Deploy experimental realizado; sem contratação de plano pago; TURN bloqueado. Configuração externa agrupada: conta Free/account ID, subdomínio, login Wrangler escopado, revisão de cotas e duas redes reais. Nunca incluir token no binário ou convite. Preparação local e bundle sem deploy em infra/signaling/README.md.


## Consolidação da retomada

Comandos de imagem Begin/Chunk/Read/Cancel não retransmitem snapshots completos; bytes via DataChannel, sem levar imagens ao Worker. Novo teste de sessão percorre upload, commit, metadados e leitura pelo IPC/P2P local. Isso não homologa redes externas, NAT restritivo ou relay financeiro.
