//! Social desktop surfaces. Every action below targets the real core or local store.
use super::*;
use iced::widget::{column, rule, toggler};

fn avatar<'a>(name: &str, m: Materials, size: u16) -> Element<'a, Msg> {
    let initial = name
        .chars()
        .next()
        .unwrap_or('V')
        .to_uppercase()
        .to_string();
    container(
        text(initial)
            .size(size as f32 * 0.4)
            .font(bold())
            .color(m.ink),
    )
    .width(size as f32)
    .height(size as f32)
    .id(format!("avatar-{size}"))
    .align_x(iced::Center)
    .align_y(iced::Center)
    .style(move |_| container::Style {
        background: Some(alpha(m.secondary, 0.17).into()),
        border: Border {
            radius: (size as f32 * 0.34).into(),
            width: 1.,
            color: alpha(m.ink, 0.12),
        },
        ..Default::default()
    })
    .into()
}
fn section<'a>(title: &'a str, m: Materials) -> Element<'a, Msg> {
    text(title).size(13).color(m.muted).font(bold()).into()
}
fn row_label<'a>(title: &'a str, description: &'a str, m: Materials) -> Element<'a, Msg> {
    column![
        text(title).size(14),
        text(description).size(12).color(m.muted)
    ]
    .spacing(4)
    .into()
}
pub(super) fn news(app: &App) -> Element<'_, Msg> {
    static NOTES: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    let catalog = NOTES.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../src/shared/releases.json"
        )))
        .expect("Catálogo inválido")
    });
    let notes = &catalog[voxy_core::VERSION];
    let m = app.palette();
    let mut body = column![
        text("Novidades").size(24).font(bold()),
        text(format!("Voxy {} · em desenvolvimento", voxy_core::VERSION))
            .size(12)
            .color(m.muted),
        rule::horizontal(1)
    ]
    .spacing(16);
    for (key, title) in [
        ("features", "Funcionalidades"),
        ("improvements", "Melhorias"),
        ("fixes", "Correções"),
    ] {
        if let Some(items) = notes[key].as_array() {
            body = body.push(text(title).size(16).font(bold()));
            for item in items {
                if let Some(item) = item.as_str() {
                    body = body.push(
                        row![text("·").color(m.muted), text(item).size(13).width(Fill)].spacing(8),
                    );
                }
            }
        }
    }
    if app.notes_pending {
        body = body.push(app.action("Marcar como lido", Msg::MarkNotes, false));
    }
    scrollable(body.padding(26).max_width(820))
        .height(Fill)
        .width(Fill)
        .direction(design::vertical_scrollbar())
        .style(m.scroll())
        .into()
}
pub(super) fn settings(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let content:Element<'_,Msg>=match app.section {
        Section::Profile=>column![text("Perfil").size(22).font(bold()),row![avatar(&app.editing.name,m,60),column![text("Nome de exibição").size(12).color(m.muted),text_input("Seu nome",&app.editing.name).on_input(Msg::Name).padding(10).style(m.input()).width(300)].spacing(6)].spacing(18).align_y(iced::Center),rule::horizontal(1),text("Presença").size(12).color(m.muted),pick_list(vec!["online".to_string(),"away".to_string(),"busy".to_string()],Some(app.editing.retained.get("presence").and_then(|v|v.as_str()).unwrap_or("online").to_string()),Msg::Presence).padding(8).style(m.select()).menu_style(m.menu()),text_input("Cor do nickname (#RRGGBB ou vazio)",app.editing.retained.get("nicknameColor").and_then(|v|v.as_str()).unwrap_or_default()).on_input(Msg::NicknameColor).padding(8).style(m.input()),text("ID do perfil").size(12).color(m.muted),text(app.profile.id.to_string()).size(13),text("Use este ID para adicionar amigos no servidor conectado.").size(12).color(m.muted)].spacing(16).into(),
        Section::Appearance=>{
            let mut themes=row![].spacing(8);
            for (name,theme) in [("Voxy",ProfileTheme::Voxy),("Oceano",ProfileTheme::Ocean),("Bosque",ProfileTheme::Forest),("Kuromi",ProfileTheme::Kuromi)]{let palette=Materials::new(theme);themes=themes.push(button(container(column![text("V").size(24).font(bold()).color(palette.accent),text(name).size(12).color(palette.ink)].spacing(14)).padding(15).width(Fill).style(move |_|palette.glass(true))).width(Fill).style(m.navigation(app.editing.theme==theme)).on_press(Msg::Theme(theme)));}
            column![text("Aparência").size(22).font(bold()),text("Tema").size(13).color(m.muted),themes,rule::horizontal(1),row![row_label("Reduzir efeitos visuais","Materiais opacos e sem composição Acrylic.",m),space::horizontal(),toggler(app.editing.low_resource_mode).on_toggle(Msg::Low).style(m.toggle())].align_y(iced::Center)].spacing(20).into()
        },
        Section::Audio=>{
            let inputs:Vec<String>=std::iter::once("Padrão do Windows".into()).chain(app.devices.iter().filter(|d|d.input).map(|d|d.name.clone())).collect();
            let outputs:Vec<String>=std::iter::once("Padrão do Windows".into()).chain(app.devices.iter().filter(|d|!d.input).map(|d|d.name.clone())).collect();
            let input=app.devices.iter().find(|d|d.id==app.editing.input).map(|d|d.name.clone()).unwrap_or_else(||"Padrão do Windows".into());let output=app.devices.iter().find(|d|d.id==app.editing.output).map(|d|d.name.clone()).unwrap_or_else(||"Padrão do Windows".into());let ins=app.devices.clone();let outs=app.devices.clone();
            let base=column![row![text("Áudio e voz").size(22).font(bold()),space::horizontal(),app.action("Atualizar",Msg::Refresh,false)],row![column![section("Microfone",m),pick_list(inputs,Some(input),move|name|Msg::Input(ins.iter().find(|d|d.input&&d.name==name).map(|d|d.id.clone()).unwrap_or_default())).padding(10).width(Fill).style(m.select()).menu_style(m.menu())].spacing(7).width(Fill),column![section("Saída",m),pick_list(outputs,Some(output),move|name|Msg::Output(outs.iter().find(|d|!d.input&&d.name==name).map(|d|d.id.clone()).unwrap_or_default())).padding(10).width(Fill).style(m.select()).menu_style(m.menu())].spacing(7).width(Fill)].spacing(16),rule::horizontal(1),row![text("Volume do microfone").size(14),space::horizontal(),text(format!("{}%",(app.editing.input_volume*100.)as i32)).size(12).color(m.muted)],slider(0.0..=2.0,app.editing.input_volume,Msg::Gain).step(0.01_f32).style(m.slider()),row![app.action(if app.mic_test.is_some(){"Encerrar teste"}else{"Teste privado"},Msg::Test,false),widget::progress_bar(0.0..=0.4,app.mic_control.level()).length(Fill).style(move |_|widget::progress_bar::Style{background:alpha(m.ink,0.06).into(),bar:m.accent.into(),border:Border{radius:3.0.into(),..Default::default()}})].spacing(16).align_y(iced::Center),text("Use fones no teste privado. O monitor local não usa cancelamento de eco.").size(12).color(m.muted),rule::horizontal(1),row![row_label("Push-to-Talk","Funciona no núcleo mesmo com a janela fechada.",m),space::horizontal(),toggler(app.editing.ptt_enabled).on_toggle(Msg::Ptt).style(m.toggle())].align_y(iced::Center),pick_list(vec!["Mouse4".into(),"Mouse5".into(),"Space".into(),"F8".into(),"F9".into()],Some(app.editing.ptt_key.clone()),Msg::PttKey).padding(9).width(190).style(m.select()).menu_style(m.menu()),text("As alterações de dispositivo e PTT entram em vigor na próxima entrada na chamada.").size(12).color(m.muted)].spacing(17);column![base,rule::horizontal(1),row![text("Supressão de ruído"),space::horizontal(),toggler(app.editing.retained.get("noiseSuppression").and_then(|v|v.as_bool()).unwrap_or(true)).on_toggle(|v|Msg::AudioBoolean("noiseSuppression",v)).style(m.toggle())],row![text("Ganho automático"),space::horizontal(),toggler(app.editing.retained.get("autoGainControl").and_then(|v|v.as_bool()).unwrap_or(true)).on_toggle(|v|Msg::AudioBoolean("autoGainControl",v)).style(m.toggle())],row![text("Detecção de atividade de voz"),space::horizontal(),toggler(app.editing.voice_detection).on_toggle(|v|Msg::AudioBoolean("voiceDetection",v)).style(m.toggle())],text(format!("Sensibilidade: {:.0} dB",app.editing.voice_threshold)).size(12),slider(-80.0..=-10.0,app.editing.voice_threshold,Msg::VoiceThreshold).step(1.0_f32).style(m.slider()),text_input("Tecla PTT: Mouse4, Mouse5, KeyK, F8…",&app.editing.ptt_key).on_input(Msg::PttKey).padding(9).style(m.input()),text("Atalhos globais: modificadores Control, Alt e Shift; vazio desativa.").size(12).color(m.muted),text_input("Mudo: Control+Shift+KeyM",&app.mute_shortcut).on_input(|v|Msg::Shortcut("mute",v)).padding(9).style(m.input()),text_input("Ensurdecer: Control+Shift+KeyD",&app.deafen_shortcut).on_input(|v|Msg::Shortcut("deafen",v)).padding(9).style(m.input())].spacing(17).into()
        },
        Section::Windows=>column![text("Windows").size(22).font(bold()),row![text("Fechar janela conserva a chamada na bandeja"),space::horizontal(),toggler(app.editing.retained.get("closeToTray").and_then(|v|v.as_bool()).unwrap_or(true)).on_toggle(|v|Msg::WindowsSetting("close",v)).style(m.toggle())],app.action("Alternar tela cheia (Esc retorna)",Msg::Fullscreen,false),text("Somente a identidade experimental; protocolo estavel preservado.").size(12).color(m.muted),row![text("Iniciar ao entrar no Windows"),space::horizontal(),toggler(app.windows_settings.launch_at_login).on_toggle(|v|Msg::WindowsSetting("launch",v)).style(m.toggle())],row![text("Iniciar minimizado no login"),space::horizontal(),toggler(app.windows_settings.start_minimized).on_toggle(|v|Msg::WindowsSetting("minimized",v)).style(m.toggle())],row![text("Registrar voxy-native://"),space::horizontal(),toggler(app.windows_settings.register_experimental_protocol).on_toggle(|v|Msg::WindowsSetting("protocol",v)).style(m.toggle())],row![text("Alertas nativos com interface encerrada"),space::horizontal(),toggler(app.editing.retained.get("notifications").and_then(|p|p.get("native")).and_then(|v|v.as_bool()).unwrap_or(true)).on_toggle(|v|Msg::NotificationPreference("native",v)).style(m.toggle())],row![text("Som dos alertas do Windows"),space::horizontal(),toggler(app.editing.retained.get("notifications").and_then(|p|p.get("sounds")).and_then(|v|v.as_bool()).unwrap_or(true)).on_toggle(|v|Msg::NotificationPreference("sounds",v)).style(m.toggle())],row![text("Não Perturbe por uma hora"),space::horizontal(),toggler(app.editing.retained.get("notifications").and_then(|p|p.get("dndUntil")).and_then(|v|v.as_i64()).is_some_and(|t|t>voxy_core::store::now_ms())).on_toggle(Msg::DndHour).style(m.toggle())],text("Aplicado somente ao Salvar. Iniciar o aplicativo nunca abre o microfone automaticamente.").size(12).color(m.muted)].spacing(18).into(),
        Section::Notifications=>{
            let sounds=app.editing.retained.get("sounds");
            let flag=|key:&str|sounds.and_then(|s|s.get(key)).and_then(|v|v.as_bool()).unwrap_or(true);
            let volume=sounds.and_then(|s|s.get("volume")).and_then(|v|v.as_f64()).unwrap_or(0.6) as f32;
            let notif=app.editing.retained.get("notifications");
            let nflag=|key:&str|notif.and_then(|p|p.get(key)).and_then(|v|v.as_bool()).unwrap_or(true);
            let setting=|title:&'static str,detail:&'static str,on:bool,msg:fn(bool)->Msg|->Element<'_,Msg>{row![row_label(title,detail,m),space::horizontal(),toggler(on).on_toggle(msg).style(m.toggle())].spacing(16).align_y(iced::Center).into()};
            column![
                text("Notificações e sons").size(22).font(bold()),
                section("Sons da interface",m),
                setting("Sons ativados","Desligar silencia todos os sons do Voxy.",flag("enabled"),|v|Msg::SoundSetting("enabled",serde_json::json!(v))),
                row![text("Volume dos sons").size(14).width(180),slider(0.0..=1.0,volume,|v|Msg::SoundSetting("volume",serde_json::json!((v*100.0).round()/100.0))).step(0.05_f32).style(m.slider()),text(format!("{}%",(volume*100.0).round() as i32)).size(12).color(m.muted).width(44),app.action("Testar",Msg::PreviewSound,false)].spacing(12).align_y(iced::Center),
                setting("Chamada","Entrar e sair, participantes entrando e saindo.",flag("call"),|v|Msg::SoundSetting("call",serde_json::json!(v))),
                setting("Controles","Microfone, ensurdecer e push-to-talk.",flag("controls"),|v|Msg::SoundSetting("controls",serde_json::json!(v))),
                setting("Transmissões","Início e fim de compartilhamento de tela e câmera.",flag("media"),|v|Msg::SoundSetting("media",serde_json::json!(v))),
                setting("Social","Mensagens privadas, menções e solicitações de amizade.",flag("social"),|v|Msg::SoundSetting("social",serde_json::json!(v))),
                text("Sons acompanham apenas eventos confirmados pela sessão e tocam também com a janela fechada. Não Perturbe silencia os sons sociais; os sons dos seus próprios controles continuam.").size(12).color(m.muted),
                rule::horizontal(1),
                section("Alertas do Windows",m),
                setting("Alertas com a interface fechada","Notificação nativa para menções, respostas e mensagens privadas.",nflag("native"),|v|Msg::NotificationPreference("native",v)),
                setting("Som dos alertas do Windows","Usa o som padrão do sistema na notificação.",nflag("sounds"),|v|Msg::NotificationPreference("sounds",v)),
                row![row_label("Não Perturbe por uma hora","Silencia alertas e sons sociais.",m),space::horizontal(),toggler(notif.and_then(|p|p.get("dndUntil")).and_then(|v|v.as_i64()).is_some_and(|t|t>voxy_core::store::now_ms())).on_toggle(Msg::DndHour).style(m.toggle())].align_y(iced::Center),
            ].spacing(16).into()
        },
        Section::Video=>{
            let presets:Vec<String>=voxy_core::ipc::CAMERA_PRESETS.iter().map(|p|p.0.to_string()).collect();
            let mut cams=column![section("Câmeras detectadas",m)].spacing(8);
            if app.cameras.is_empty(){cams=cams.push(text("Nenhuma câmera listada. Use Atualizar após conectar uma câmera.").size(13).color(m.muted));}
            for (index,(_,name)) in app.cameras.iter().enumerate(){cams=cams.push(row![text(name.clone()).size(14).width(Fill),app.action(if app.camera_selected==Some(index){"Prévia ativa"}else{"Prévia privada"},Msg::CameraSelect(index),app.camera_selected==Some(index))].spacing(8).align_y(iced::Center));}
            if let Some(preview)=&app.camera_preview{cams=cams.push(container(widget::image(preview.clone()).width(Fill).height(240).content_fit(iced::ContentFit::Contain)).style(move|_|m.card()).padding(6));}
            column![
                row![text("Vídeo e transmissão").size(22).font(bold()),space::horizontal(),app.action("Atualizar",Msg::CameraOpenSettings,false)].align_y(iced::Center),
                cams,
                text("A prévia privada é capturada só neste computador e nunca é publicada. A câmera só liga na chamada pelo botão de câmera.").size(12).color(m.muted),
                rule::horizontal(1),
                section("Qualidade padrão da câmera",m),
                pick_list(presets,Some(app.camera_preset.clone()),Msg::CameraPreset).padding(8).style(m.select()).menu_style(m.menu()),
                section("Codificação de vídeo",m),
                text(crate::streams::encoder_summary()).size(13),
                text("Aceleração por hardware é usada somente quando o Media Foundation oferece um codificador H.264 de hardware funcional; caso contrário, o codificador por software é mantido. Esta tela mostra o que está efetivamente disponível, não uma promessa.").size(12).color(m.muted),
            ].spacing(16).into()
        },
        Section::Privacy=>column![text("Rede e privacidade").size(22).font(bold()),section("Sinalização do host",m),text_input("wss://seu-subdomínio",&app.endpoint).on_input(Msg::EndpointText).padding(10).style(m.input()),section("STUN (separar por vírgula)",m),text_input("stun:servidor:3478",&app.stun_text).on_input(Msg::StunText).padding(10).style(m.input()),text("O convite informa a sinalização aos convidados. Nenhum IP manual é necessário para entrar.").size(12).color(m.muted),rule::horizontal(1),text("P2P compartilha endereços de rede com os participantes. O host armazena as mensagens e consegue ler seu conteúdo.").size(13),text("TURN bloqueado: não há limite financeiro rígido homologado. Redes que exigem retransmissão ainda podem falhar.").size(13).color(m.muted),text("Dados da 1.4.1 permanecem separados. Nenhum plano pago é ativado pelo aplicativo.").size(12).color(m.muted)].spacing(15).into(),
    };
    column![
        scrollable(container(content).max_width(760).width(Fill))
            .height(Fill)
            .direction(design::vertical_scrollbar())
            .style(m.scroll()),
        rule::horizontal(1),
        row![
            text("Preferências locais").size(12).color(m.muted),
            space::horizontal(),
            app.action("Desfazer", Msg::Navigate(Page::Settings), false),
            app.action("Salvar", Msg::Save, true)
        ]
        .spacing(8)
        .align_y(iced::Center)
    ]
    .spacing(16)
    .padding(26)
    .width(Fill)
    .height(Fill)
    .into()
}
