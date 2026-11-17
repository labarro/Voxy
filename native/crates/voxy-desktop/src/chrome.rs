//! Fixed geometry for native window chrome and navigation.
use super::*;
use iced::widget::{column, rule, tooltip};
pub(super) fn titlebar(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let drag = mouse_area(
        container(
            row![
                text("voxy").font(bold()).size(13),
                text("2.0").size(10).color(m.muted),
                text(if app.smoke_dir.is_some() {
                    "Fixture visual · sem áudio/rede"
                } else {
                    ""
                })
                .size(10)
                .color(m.muted)
            ]
            .spacing(8)
            .align_y(iced::Center),
        )
        .height(36)
        .width(Fill)
        .padding([0, 18])
        .align_y(iced::Center),
    )
    .on_press(Msg::Drag)
    .on_double_click(Msg::Maximize);
    let mut caption = row![].spacing(0);
    for (kind, label, msg) in [
        (art::CaptionKind::Minimize, "Minimizar", Msg::Minimize),
        (
            if app.maximized {
                art::CaptionKind::Restore
            } else {
                art::CaptionKind::Maximize
            },
            "Maximizar ou restaurar",
            Msg::Maximize,
        ),
        (
            art::CaptionKind::Close,
            "Fechar janela · a chamada continua",
            Msg::Close,
        ),
    ] {
        caption = caption.push(tooltip(
            button(
                container(
                    widget::canvas(art::Caption(kind, m.ink))
                        .width(12)
                        .height(12),
                )
                .id(format!("caption-{label}"))
                .width(46)
                .height(36)
                .align_x(iced::Center)
                .align_y(iced::Center),
            )
            .padding(0)
            .style(move |_, status| widget::button::Style {
                background: Some(
                    if matches!(
                        status,
                        widget::button::Status::Hovered | widget::button::Status::Pressed
                    ) {
                        if matches!(kind, art::CaptionKind::Close) {
                            design::rgb(0xb83939)
                        } else {
                            alpha(m.ink, 0.1)
                        }
                    } else {
                        Color::TRANSPARENT
                    }
                    .into(),
                ),
                text_color: m.ink,
                ..Default::default()
            })
            .on_press(msg),
            label,
            widget::tooltip::Position::Bottom,
        ));
    }
    row![drag, caption].height(36).align_y(iced::Center).into()
}
pub(super) fn sidebar(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut primary = column![
        container(text("v").size(28).font(bold()).color(m.ink))
            .width(44)
            .height(42)
            .align_x(iced::Center)
            .align_y(iced::Center)
    ]
    .spacing(6)
    .align_x(iced::Center);
    for (icon, label, page) in [
        (art::NavIcon::Home, "Início", Page::Home),
        (art::NavIcon::Conversation, "Conversas", Page::Chat),
        (art::NavIcon::News, "Novidades", Page::News),
        (art::NavIcon::Settings, "Configurações", Page::Settings),
    ] {
        let selected = app.page == page
            || (page == Page::Chat && matches!(app.page, Page::Direct | Page::ServerSettings));
        primary = primary.push(tooltip(
            button(
                container(
                    widget::canvas(art::Icon(icon, if selected { m.ink } else { m.muted }))
                        .width(22)
                        .height(22),
                )
                .id(format!("nav-item-{label}"))
                .width(44)
                .height(44)
                .align_x(iced::Center)
                .align_y(iced::Center),
            )
            .padding(0)
            .style(move |_, status| widget::button::Style {
                background: Some(
                    alpha(
                        m.ink,
                        if selected {
                            0.1
                        } else if matches!(status, widget::button::Status::Hovered) {
                            0.06
                        } else {
                            0.0
                        },
                    )
                    .into(),
                ),
                border: Border {
                    radius: 11.0.into(),
                    width: if selected { 1. } else { 0. },
                    color: alpha(m.ink, 0.17),
                },
                text_color: m.ink,
                ..Default::default()
            })
            .on_press(Msg::Navigate(page)),
            label,
            tooltip::Position::Right,
        ));
    }
    let mut servers = column![].spacing(9).align_x(iced::Center);
    for server in &app.communities {
        let selected =
            Some(server.id) == app.server && matches!(app.page, Page::Chat | Page::ServerSettings);
        let initial = server
            .name
            .chars()
            .next()
            .unwrap_or('V')
            .to_uppercase()
            .to_string();
        servers = servers.push(tooltip(
            button(
                container(text(initial).font(bold()).size(15))
                    .width(38)
                    .height(38)
                    .align_x(iced::Center)
                    .align_y(iced::Center),
            )
            .padding(0)
            .style(move |_, status| widget::button::Style {
                background: Some(
                    alpha(
                        m.secondary,
                        if selected {
                            0.26
                        } else if matches!(status, widget::button::Status::Hovered) {
                            0.21
                        } else {
                            0.12
                        },
                    )
                    .into(),
                ),
                border: Border {
                    radius: 13.0.into(),
                    width: 1.,
                    color: if selected {
                        alpha(m.ink, 0.55)
                    } else {
                        alpha(m.ink, 0.1)
                    },
                },
                text_color: m.ink,
                ..Default::default()
            })
            .on_press(Msg::Server(server.id)),
            text(server.name.clone()).size(12),
            tooltip::Position::Right,
        ));
    }
    servers = servers.push(tooltip(
        button(
            container(text("+").size(22).color(m.muted))
                .width(38)
                .height(36)
                .align_x(iced::Center)
                .align_y(iced::Center),
        )
        .padding(0)
        .style(m.button(false))
        .on_press(Msg::NewServer),
        "Criar servidor",
        tooltip::Position::Right,
    ));
    let profile = tooltip(
        button(
            container(
                text(app.profile.name.chars().next().unwrap_or('V'))
                    .size(16)
                    .font(bold()),
            )
            .width(38)
            .height(38)
            .align_x(iced::Center)
            .align_y(iced::Center),
        )
        .padding(0)
        .style(m.button(false))
        .on_press(Msg::ProfileSettings),
        text(app.profile.name.clone()).size(12),
        tooltip::Position::Right,
    );
    container(
        column![
            primary,
            container(rule::horizontal(1)).width(30),
            scrollable(servers)
                .width(44)
                .height(Fill)
                .direction(design::vertical_scrollbar())
                .style(m.scroll()),
            profile
        ]
        .spacing(16)
        .align_x(iced::Center),
    )
    .width(64)
    .padding([10, 10])
    .height(Fill)
    .style(move |_| container::Style {
        background: Some(alpha(m.base, 0.78).into()),
        ..Default::default()
    })
    .into()
}
pub(super) fn footer(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    // Local action messages first, then confirmed session errors, then the call summary.
    let local_message = !app.status.is_empty()
        && app.status != app.remote.phase
        && Some(&app.status) != app.remote.error.as_ref();
    let status: String = if local_message {
        app.status.clone()
    } else if let Some(error) = &app.remote.error {
        error.clone()
    } else if let Some(summary) = app.call_summary() {
        summary
    } else if !app.remote.phase.is_empty() {
        app.remote.phase.clone()
    } else {
        "Nenhuma chamada ativa".into()
    };
    let pending_mute = app.control.muted.load(Ordering::Relaxed) != app.remote.muted;
    let pending_deafen = app.control.deafened.load(Ordering::Relaxed) != app.remote.deafened;
    container(
        row![
            text(if app.remote.microphone_ready {
                "●"
            } else {
                "◌"
            })
            .size(10)
            .color(if app.remote.microphone_ready {
                design::rgb(0x9ec9b1)
            } else {
                m.muted
            }),
            text(status).size(11).color(m.muted).width(Fill),
            app.action(
                if app.remote.voice.is_some() {
                    "Sair da chamada"
                } else {
                    "Áudio e voz"
                },
                if app.remote.voice.is_some() {
                    Msg::LeaveVoice
                } else {
                    Msg::AudioSettings
                },
                false
            ),
            app.action(
                match (app.remote.muted, pending_mute) {
                    (_, true) => "Microfone …",
                    (true, false) => "Mic mudo",
                    (false, false) => "Microfone",
                },
                Msg::Mute,
                false
            ),
            app.action(
                match (app.remote.deafened, pending_deafen) {
                    (_, true) => "Áudio …",
                    (true, false) => "Áudio mudo",
                    (false, false) => "Áudio",
                },
                Msg::Deafen,
                false
            )
        ]
        .spacing(7)
        .align_y(iced::Center),
    )
    .height(48)
    .padding([6, 16])
    .align_y(iced::Center)
    .style(move |_| container::Style {
        background: Some(alpha(m.base, 0.86).into()),
        ..Default::default()
    })
    .into()
}
