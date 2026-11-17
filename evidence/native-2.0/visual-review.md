# Revisão visual do incremento nativo

As capturas em liquid-glass/ documentam uma revisão anterior rejeitada: avatares se expandiam e deslocavam mensagens/participantes; sidebar e caption tinham proporções inconsistentes. Elas são históricas, não a apresentação atual.

A revisão atual está em [liquid-glass-reviewed](liquid-glass-reviewed/ui-smoke.json): 15 capturas, dez participantes e trinta mensagens de fixture explicitamente sintética, isolada dos dados reais. Foram inspecionados Home, chat, participantes, configurações, administração, DMs, perfil, menus, modais e temas, incluindo janela 900×640.

Correções: avatares com dimensões fixas; sidebar 64 px e botões 44×44; caption 36 px e controles 46×36; chat com colunas 210 px/conteúdo flexível/172 px; rolagens independentes e gutters; ações contextuais; modais com superfície quase opaca para evitar texto do fundo atravessando o conteúdo. A consulta dos bounds reais de widgets verificou 227 elementos, sem falhas nas invariantes verificadas. Isso não cobre todo aspecto de alinhamento ou qualidade artística.

[Chat atual](liquid-glass-reviewed/chat.png) · [Home compacta](liquid-glass-reviewed/home-900.png) · [Administração](liquid-glass-reviewed/server-settings.png) · [Configurações](liquid-glass-reviewed/audio.png).

Capturas pelo renderer Iced e mensagens internas da aplicação, sem automação de mouse/teclado do Windows. Não houve teste humano de usabilidade, variação real de DPI ou certificação de acessibilidade. Acrylic aceito pela API não comprova refração óptica; não há shader Liquid Glass completo. O redesign continua sem aprovação do usuário.
