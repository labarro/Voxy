# Análise de referência — Voxy

Análise realizada em 19/10/2026, antes da implementação. Skill: `C:/Users/luisa/.agents/skills/reverse-engineer-anything/SKILL.md`, versão 42. Ferramenta real: REA `capture_browser_scenario`, Edge headless, perfil temporário, viewport 1280×720, acesso a https://discord.com/app e espera de 4 segundos. Evidência: `evidence/discord-rea.json`; ID `ev_14ba70380c0630905813fd416a041cedac9d1fdfd8e714006e31a9106615dc48`.

## Evidência observada e limites

A navegação foi concluída e redirecionou para https://discord.com/login. A captura de DOM/acessibilidade identificou o formulário de autenticação e tema escuro. Não havia credenciais ou sessão fornecida. Não foram acessados servidores, dispositivos, chamadas ou transmissões do Discord. Não foi feito login, extraído código proprietário ou usada API privada. O DOM proprietário foi excluído do arquivo exportado; sua identidade SHA-256 foi preservada. As primeiras chamadas rejeitadas pela validação de ações não constituem observações.

## Fluxos documentados publicamente

Referências oficiais: [guia inicial](https://support.discord.com/hc/en-us/articles/360045138571-Beginner-s-Guide-to-Discord), [Go Live](https://support.discord.com/hc/en-us/articles/360040816151-Go-Live-and-Screen-Share), [videochamadas](https://support.discord.com/hc/en-us/articles/360041721052-Video-Calls), [diagnóstico de voz](https://support.discord.com/hc/en-us/articles/360045138471-Discord-Voice-and-Video-Troubleshooting-Guide). Estes fluxos foram estudados a partir de documentação, não observados em uma sessão autenticada.

| Área | Organização / fluxo de referência | Decisão para Voxy |
| --- | --- | --- |
| Servidores | Navegação persistente à esquerda, seleção de comunidade | Trilho compacto com iniciais, seleção, criar e conectar |
| Canais | Lista por tipo, texto e voz distintos | Categorias texto/voz, ícones e participantes abaixo da voz |
| Texto | Histórico central, autor, horário e composição inferior | Histórico SQLite limitado a 500 mensagens por canal na carga |
| Voz | Entrar em canal, ver participantes, controles persistentes | Canal isolado, estado ICE real e saída explícita |
| Microfone / áudio | Mute e silenciar recepção são ações diferentes | Track.enabled no microfone; deafen local nos players |
| Transmissão | Entrar em voz, escolher janela/tela e qualidade, iniciar | Seletor de fontes Electron com miniaturas e presets |
| Assistir | Selecionar transmissão, ampliar, fechar visualização | Player grande e fullscreen; fechar não desconecta voz |
| Encerrar | Parar vídeo mantendo a conversa | replaceTrack(null) nas trilhas de tela, microfone preservado |
| Configurações | Entrada/saída e controle de áudio | Dispositivos locais, volume individual, diagnóstico |
| Falhas | Diferenciar conexão, permissão e dispositivo | Erros explícitos; saída limpa em desconexão e tentativa de sinalização |

## Identidade própria

Nome Voxy, símbolo V próprio. Paleta: azul noite #131722, painel #1b2130, conteúdo #232b3b, lavanda #a69bff, texto #edf0f8, sucesso #68d6b1. Tipografia Segoe UI do Windows. Trilho de 72px, canais de 250px, conteúdo flexível; alinhamento à esquerda e chamada central. O foco visual é a transmissão, com controles compactos. Sem mascote, marca, fontes ou imagens do Discord. A hierarquia familiar atende ao pedido; elementos decorativos de landing page foram descartados.
