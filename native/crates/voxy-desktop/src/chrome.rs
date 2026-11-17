//! Window chrome and navigation: titlebar, server rail, contextual sidebar with
//! the connection and profile panels. One implementation of the caption buttons
//! (the native frame is not extended into the client area).
use super::*;
use crate::{
    design::{Tone, mix, radius, size},
    icons::Icon,
    ui::{self, Ring},
};
use iced::widget::{column, tooltip};

pub(super) const RAIL: f32 = 72.0;
pub(super) const SIDEBAR: f32 = 252.0;
pub(super) const TITLEBAR: f32 = 38.0;

pub(super) fn titlebar(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let context = match app.page {
        Page::Home => "Início".to_owned(),
        Page::Direct => "Mensagens privadas".into(),
        Page::Settings => "Configurações".into(),
        Page::News => "Novidades".into(),
        Page::Chat | Page::Call | Page::ServerSettings => app
            .communities
            .iter()
            .find(|s| Some(s.id) == app.server)
            .map(|s| s.name.clone())
            .unwrap_or_else(|| "Servidor".into()),
    };
    let drag = mouse_area(
        container(
            row![
                widget::image(crate::brand::mark()).width(20).height(20),
                text("Voxy").font(bold()).size(size::SMALL),
                text("2.0 Beta 1").size(size::MICRO).color(m.faint),
                text("·").color(m.faint),
                text(context).size(size::SMALL).color(m.muted),
                text(if app.smoke_dir.is_some() {
                    "· fixture visual, sem áudio/rede"
                } else {
                    ""
                })
                .size(size::MICRO)
                .color(m.faint)
            ]
            .spacing(8)
            .align_y(iced::Center),
        )
        .height(TITLEBAR)
        .width(Fill)
        .padding([0, 14])
        .align_y(iced::Center),
    )
    .on_press(Msg::Drag)
    .on_double_click(Msg::Maximize);
    let mut caption = row![].spacing(0);
    for (glyph, label, msg, close) in [
        (Icon::Minus, "Minimizar", Msg::Minimize, false),
        (
            if app.maximized {
                Icon::Copy
            } else {
                Icon::Square
            },
            "Maximizar ou restaurar",
            Msg::Maximize,
            false,
        ),
        (
            Icon::X,
            "Fechar janela · a chamada continua",
            Msg::Close,
            true,
        ),
    ] {
        caption = caption.push(ui::tip(
            m,
            button(
                container(ui::icon(
                    glyph,
                    if glyph == Icon::Copy || glyph == Icon::Square {
                        13.0
                    } else {
                        16.0
                    },
                    m.muted,
                ))
                .id(format!("caption-{label}"))
                .center_x(46)
                .center_y(TITLEBAR),
            )
            .padding(0)
            .style(move |_, status| widget::button::Style {
                background: Some(
                    if matches!(
                        status,
                        widget::button::Status::Hovered | widget::button::Status::Pressed
                    ) {
                        if close {
                            design::rgb(0xc42b1c)
                        } else {
                            alpha(m.ink, 0.08)
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
            tooltip::Position::Bottom,
        ));
    }
    container(row![drag, caption].height(TITLEBAR).align_y(iced::Center))
        .style(move |_| m.surface(m.base))
        .into()
}

/// Rail item with the selection pill on the left edge.
fn rail_item<'a>(
    m: Materials,
    id: String,
    face: Element<'a, Msg>,
    label: String,
    selected: bool,
    unread: bool,
    msg: Msg,
) -> Element<'a, Msg> {
    let pill = container(text(""))
        .width(4)
        .height(if selected {
            32.0
        } else if unread {
            8.0
        } else {
            0.0
        })
        .style(move |_| container::Style {
            background: Some(m.ink.into()),
            border: Border {
                radius: 2.0.into(),
                ..Default::default()
            },
            ..Default::default()
        });
    let body = button(container(face).id(id).width(46).height(46).center(46))
        .padding(0)
        .style(move |_, status| {
            let hover = matches!(
                status,
                widget::button::Status::Hovered | widget::button::Status::Pressed
            );
            widget::button::Style {
                background: Some(
                    if selected {
                        alpha(m.accent, 0.22)
                    } else if hover {
                        alpha(m.ink, 0.09)
                    } else {
                        alpha(m.ink, 0.045)
                    }
                    .into(),
                ),
                border: Border {
                    radius: if selected || hover { 16.0 } else { 23.0 }.into(),
                    ..Default::default()
                },
                text_color: m.ink,
                ..Default::default()
            }
        })
        .on_press(msg);
    row![
        container(pill).width(13).height(46).align_y(iced::Center),
        ui::tip(m, body, label, tooltip::Position::Right),
    ]
    .width(RAIL)
    .align_y(iced::Center)
    .into()
}

pub(super) fn rail(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let home_selected = matches!(app.page, Page::Home | Page::Direct);
    let unread_home = app
        .remote
        .snapshot
        .as_ref()
        .is_some_and(|s| s.notifications.iter().any(|n| !n.read));
    let mut top = column![rail_item(
        m,
        "nav-item-Início".into(),
        ui::icon(
            Icon::House,
            20.0,
            if home_selected { m.ink } else { m.muted }
        ),
        "Início".into(),
        home_selected,
        unread_home,
        Msg::Navigate(Page::Home),
    )]
    .spacing(8);
    top = top.push(
        container(
            container(text(""))
                .width(32)
                .height(1)
                .style(move |_| m.surface(alpha(m.ink, 0.1))),
        )
        .width(RAIL)
        .center_x(RAIL),
    );
    let mut servers = column![].spacing(8);
    for server in &app.communities {
        let selected = Some(server.id) == app.server
            && matches!(app.page, Page::Chat | Page::Call | Page::ServerSettings);
        let connected = app
            .remote
            .snapshot
            .as_ref()
            .is_some_and(|s| s.server.id == server.id);
        let tint = ui::person_color(&server.name);
        let face = container(
            text(ui::initials(&server.name))
                .size(size::STRONG)
                .font(bold())
                .color(Color::WHITE),
        )
        .width(46)
        .height(46)
        .center(46)
        .style(move |_| container::Style {
            background: Some(alpha(mix(tint, m.canvas, 0.35), 0.9).into()),
            border: Border {
                radius: if selected { 16.0 } else { 23.0 }.into(),
                width: if connected { 2.0 } else { 0.0 },
                color: m.speaking,
            },
            ..Default::default()
        });
        servers = servers.push(rail_item(
            m,
            format!("rail-server-{}", server.name),
            face.into(),
            if connected {
                format!("{} · conectado", server.name)
            } else {
                server.name.clone()
            },
            selected,
            false,
            Msg::Server(server.id),
        ));
    }
    for (glyph, label, msg) in [
        (Icon::Plus, "Criar servidor", Msg::NewServer),
        (Icon::LogIn, "Entrar por convite", Msg::JoinDialog),
    ] {
        servers = servers.push(rail_item(
            m,
            format!("rail-{label}"),
            ui::icon(glyph, 20.0, m.speaking),
            label.into(),
            false,
            false,
            msg,
        ));
    }
    let news_selected = app.page == Page::News;
    let bottom = rail_item(
        m,
        "nav-item-Novidades".into(),
        ui::icon(
            Icon::Sparkles,
            19.0,
            if news_selected { m.ink } else { m.muted },
        ),
        "Novidades".into(),
        news_selected,
        app.notes_pending,
        Msg::Navigate(Page::News),
    );
    container(
        column![
            top,
            scrollable(servers).width(RAIL).height(Fill).direction(
                iced::widget::scrollable::Direction::Vertical(
                    iced::widget::scrollable::Scrollbar::new()
                        .width(0)
                        .scroller_width(0)
                )
            ),
            bottom
        ]
        .spacing(8)
        .padding(iced::Padding::new(0.0).top(10.0).bottom(12.0)),
    )
    .width(RAIL)
    .height(Fill)
    .style(move |_| m.surface(m.rail))
    .into()
}

/// One sidebar row: icon, label, optional trailing element.
pub(super) fn side_row<'a>(
    m: Materials,
    glyph: Icon,
    label: String,
    trailing: Option<Element<'a, Msg>>,
    selected: bool,
    msg: Msg,
) -> Element<'a, Msg> {
    let color = if selected { m.ink } else { m.muted };
    let mut content = row![
        ui::icon(glyph, 18.0, color),
        text(label).size(size::BODY).color(color).width(Fill)
    ]
    .spacing(10)
    .align_y(iced::Center);
    if let Some(trailing) = trailing {
        content = content.push(trailing);
    }
    button(content)
        .padding([7, 10])
        .width(Fill)
        .style(m.navigation(selected))
        .on_press(msg)
        .into()
}

pub(super) fn speaking(app: &App, member: &voxy_core::room::Member) -> bool {
    app.speaking_until
        .get(&member.id)
        .is_some_and(|until| *until > std::time::Instant::now())
        && !member.muted
        && !member.deafened
}

fn server_sidebar(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let server = app.communities.iter().find(|s| Some(s.id) == app.server);
    let name = server.map(|s| s.name.as_str()).unwrap_or("Servidor");
    let owner = server.is_some_and(|s| s.owner == app.profile.id);
    let connected = app
        .remote
        .snapshot
        .as_ref()
        .is_some_and(|s| Some(s.server.id) == app.server);
    let mut actions = row![].spacing(2).align_y(iced::Center);
    if connected && app.remote.invite.is_some() {
        actions = actions.push(ui::icon_button(
            m,
            Icon::UserPlus,
            "Copiar convite",
            Some(Msg::CopyInvite),
            Tone::Ghost,
            30.0,
        ));
    }
    if owner {
        actions = actions.push(ui::icon_button(
            m,
            Icon::Settings,
            "Gerenciar servidor",
            Some(Msg::ManageServer),
            Tone::Ghost,
            30.0,
        ));
    }
    if connected {
        actions = actions.push(ui::icon_button(
            m,
            Icon::LogOut,
            "Desconectar do servidor",
            Some(Msg::Disconnect),
            Tone::Ghost,
            30.0,
        ));
    }
    let header = container(
        row![
            column![
                text(name.to_owned()).size(size::STRONG).font(bold()),
                row![
                    ui::dot(if connected { m.speaking } else { m.faint }, 7.0),
                    text(if connected {
                        "Conectado"
                    } else if owner {
                        "Local · não hospedado"
                    } else {
                        "Desconectado"
                    })
                    .size(size::CAPTION)
                    .color(m.muted)
                ]
                .spacing(6)
                .align_y(iced::Center)
            ]
            .spacing(3)
            .width(Fill),
            actions
        ]
        .align_y(iced::Center),
    )
    .padding([12, 14])
    .height(60)
    .align_y(iced::Center);
    let mut list = column![].spacing(2);
    for kind in [ChannelKind::Text, ChannelKind::Voice] {
        list = list.push(
            container(ui::label(
                m,
                if kind == ChannelKind::Text {
                    "Canais de texto"
                } else {
                    "Canais de voz"
                },
            ))
            .padding(iced::Padding::new(0.0).top(14.0).bottom(4.0).left(10.0)),
        );
        for channel in app.channels.iter().filter(|c| c.kind == kind) {
            if kind == ChannelKind::Text {
                let selected = Some(channel.id) == app.channel && app.page == Page::Chat;
                list = list.push(side_row(
                    m,
                    Icon::Hash,
                    channel.name.clone(),
                    None,
                    selected,
                    Msg::Channel(channel.id),
                ));
                continue;
            }
            let members: Vec<_> = app
                .remote
                .snapshot
                .as_ref()
                .map(|s| {
                    s.members
                        .iter()
                        .filter(|p| p.voice == Some(channel.id))
                        .collect()
                })
                .unwrap_or_default();
            let in_this = app.remote.voice == Some(channel.id);
            let count: Option<Element<'_, Msg>> = (!members.is_empty()).then(|| {
                text(members.len().to_string())
                    .size(size::CAPTION)
                    .color(m.faint)
                    .into()
            });
            list = list.push(side_row(
                m,
                Icon::Volume2,
                channel.name.clone(),
                count,
                (app.page == Page::Call && app.call_channel == Some(channel.id)) || in_this,
                Msg::Channel(channel.id),
            ));
            for member in members {
                let (talking, state) = (speaking(app, member), app.member_icons(member));
                let mut line = row![
                    ui::avatar(
                        m,
                        &member.name,
                        22.0,
                        Ring {
                            speaking: talking,
                            ..Default::default()
                        }
                    ),
                    text(member.name.clone())
                        .size(size::SMALL)
                        .color(if talking { m.ink } else { m.muted })
                        .width(Fill)
                ]
                .spacing(8)
                .align_y(iced::Center);
                for (glyph, color, _) in state {
                    line = line.push(ui::icon(glyph, 14.0, color));
                }
                list = list.push(
                    container(line).padding(
                        iced::Padding::new(0.0)
                            .left(26.0)
                            .right(10.0)
                            .top(1.0)
                            .bottom(1.0),
                    ),
                );
            }
        }
    }
    if app.channels.is_empty() {
        list = list.push(
            text("Nenhum canal. O dono pode criar canais em Gerenciar servidor.")
                .size(size::CAPTION)
                .color(m.faint),
        );
    }
    let mut tail = column![].spacing(6);
    if !connected && server.is_some() {
        tail = tail.push(
            ui::action(
                m,
                Some(if owner { Icon::Radio } else { Icon::RefreshCw }),
                if owner {
                    "Hospedar servidor"
                } else {
                    "Reconectar"
                },
                Some(if owner {
                    Msg::HostRemote
                } else {
                    Msg::Reconnect(app.server.unwrap_or_default())
                }),
                Tone::Primary,
            )
            .width(Fill),
        );
    }
    column![
        header,
        container(text(""))
            .height(1)
            .width(Fill)
            .style(move |_| m.surface(m.border)),
        scrollable(container(list).padding([0, 8]))
            .height(Fill)
            .direction(design::vertical_scrollbar())
            .style(m.scroll()),
        container(tail).padding([0, 10])
    ]
    .into()
}

fn home_sidebar(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut list = column![
        side_row(
            m,
            Icon::House,
            "Início".into(),
            None,
            app.page == Page::Home,
            Msg::Navigate(Page::Home)
        ),
        container(ui::label(m, "Mensagens privadas"))
            .padding(iced::Padding::new(0.0).top(16.0).bottom(4.0).left(10.0)),
    ]
    .spacing(2);
    let mut any = false;
    if let Some(snapshot) = &app.remote.snapshot {
        for friend in snapshot.friends.iter().filter(|f| f.accepted) {
            let outgoing = friend.requester == app.profile.id;
            let (peer, name) = if outgoing {
                (friend.recipient, &friend.recipient_name)
            } else {
                (friend.requester, &friend.requester_name)
            };
            let unread = snapshot
                .direct
                .iter()
                .filter(|d| d.from == peer && d.to == app.profile.id && d.read_at.is_none())
                .count();
            let presence = snapshot
                .profiles
                .iter()
                .find(|p| p.id == peer)
                .map(|p| p.presence);
            let online = snapshot.members.iter().any(|x| x.id == peer);
            let selected = app.page == Page::Direct && app.direct_peer == Some(peer);
            let mut line = row![
                iced::widget::stack![
                    ui::avatar(m, name, 30.0, Ring::default()),
                    container(ui::dot(
                        ui::presence_color(m, online.then_some(presence).flatten()),
                        10.0
                    ))
                    .width(34)
                    .height(34)
                    .align_x(iced::alignment::Horizontal::Right)
                    .align_y(iced::alignment::Vertical::Bottom)
                ],
                text(name.clone())
                    .size(size::BODY)
                    .color(if selected || unread > 0 {
                        m.ink
                    } else {
                        m.muted
                    })
                    .width(Fill)
            ]
            .spacing(10)
            .align_y(iced::Center);
            if unread > 0 {
                line = line.push(ui::badge(unread.to_string(), Color::WHITE, m.danger));
            }
            list = list.push(
                button(line)
                    .padding([5, 8])
                    .width(Fill)
                    .style(m.navigation(selected))
                    .on_press(Msg::Direct(peer)),
            );
            any = true;
        }
    }
    if !any {
        list = list.push(
            container(
                text(if app.remote.snapshot.is_some() {
                    "Adicione amigos pelo ID de perfil no Início para conversar em privado."
                } else {
                    "Conecte-se a um servidor para ver amigos e mensagens privadas."
                })
                .size(size::CAPTION)
                .color(m.faint),
            )
            .padding([4, 10]),
        );
    }
    scrollable(container(list).padding([12, 8]))
        .height(Fill)
        .direction(design::vertical_scrollbar())
        .style(m.scroll())
        .into()
}

fn settings_sidebar(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut list = column![
        container(text("Configurações").size(size::STRONG).font(bold()))
            .padding(iced::Padding::new(0.0).left(10.0).bottom(10.0).top(6.0))
    ]
    .spacing(2);
    for (glyph, label, section) in [
        (Icon::AudioLines, "Áudio e voz", Section::Audio),
        (Icon::Video, "Vídeo e transmissão", Section::Video),
        (Icon::UserRound, "Perfil", Section::Profile),
        (Icon::Palette, "Aparência", Section::Appearance),
        (Icon::Bell, "Notificações e sons", Section::Notifications),
        (Icon::Shield, "Rede e privacidade", Section::Privacy),
        (Icon::AppWindow, "Windows", Section::Windows),
    ] {
        list = list.push(side_row(
            m,
            glyph,
            label.into(),
            None,
            app.section == section,
            Msg::Section(section),
        ));
    }
    scrollable(container(list).padding([12, 8]))
        .height(Fill)
        .direction(design::vertical_scrollbar())
        .style(m.scroll())
        .into()
}

/// Shown while a voice channel is active: room, effective state, quality and
/// access to diagnostics and disconnect.
fn connection_panel(app: &App) -> Option<Element<'_, Msg>> {
    let m = app.palette();
    let channel = app.remote.voice?;
    let snapshot = app.remote.snapshot.as_ref();
    let room = snapshot
        .and_then(|s| s.channels.iter().find(|c| c.id == channel))
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "Canal de voz".into());
    let server = snapshot.map(|s| s.server.name.clone()).unwrap_or_default();
    let quality = app.call_quality();
    let (color, title) = match quality {
        CallQuality::Opening => (m.warning, "Abrindo áudio…"),
        CallQuality::Negotiating => (m.warning, "Conectando mídia…"),
        CallQuality::Reconnecting => (m.warning, "Reconectando…"),
        CallQuality::Alone => (m.speaking, "Voz conectada"),
        CallQuality::Good(_) => (m.speaking, "Voz conectada"),
        CallQuality::Degraded => (m.danger, "Mídia interrompida"),
    };
    let detail = match quality {
        CallQuality::Good(Some(rtt)) => format!("{room} · {server} · {rtt} ms"),
        _ => format!("{room} · {server}"),
    };
    let open: Element<'_, Msg> = button(
        column![
            row![
                ui::icon(Icon::Signal, 15.0, color),
                text(title).size(size::SMALL).font(bold()).color(color)
            ]
            .spacing(6)
            .align_y(iced::Center),
            text(detail).size(size::CAPTION).color(m.muted)
        ]
        .spacing(2),
    )
    .padding([4, 6])
    .width(Fill)
    .style(m.tone(Tone::Ghost))
    .on_press(Msg::OpenCall)
    .into();
    Some(
        container(
            row![
                open,
                ui::icon_button(
                    m,
                    Icon::Activity,
                    "Copiar diagnóstico",
                    Some(Msg::CopyDiagnostics),
                    Tone::Ghost,
                    30.0
                ),
                ui::icon_button(
                    m,
                    Icon::PhoneOff,
                    "Sair da chamada",
                    Some(Msg::LeaveVoice),
                    Tone::Ghost,
                    30.0
                ),
            ]
            .spacing(2)
            .align_y(iced::Center),
        )
        .padding([8, 8])
        .style(move |_| container::Style {
            background: Some(mix(m.sidebar, Color::BLACK, 0.18).into()),
            border: Border {
                color: m.border,
                width: 1.0,
                radius: radius::M.into(),
            },
            ..Default::default()
        })
        .into(),
    )
}

fn profile_panel(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let presence = match app
        .profile
        .retained
        .get("presence")
        .and_then(|v| v.as_str())
    {
        Some("away") => (voxy_core::room::Presence::Away, "Ausente"),
        Some("busy") => (voxy_core::room::Presence::Busy, "Não perturbe"),
        _ => (voxy_core::room::Presence::Online, "Online"),
    };
    let me = app
        .remote
        .snapshot
        .as_ref()
        .and_then(|s| s.members.iter().find(|x| x.id == app.profile.id));
    let talking = me.is_some_and(|me| speaking(app, me));
    let identity = button(
        row![
            iced::widget::stack![
                ui::avatar(
                    m,
                    &app.profile.name,
                    32.0,
                    Ring {
                        speaking: talking,
                        ..Default::default()
                    }
                ),
                container(ui::dot(ui::presence_color(m, Some(presence.0)), 10.0))
                    .width(38)
                    .height(38)
                    .align_x(iced::alignment::Horizontal::Right)
                    .align_y(iced::alignment::Vertical::Bottom)
            ],
            column![
                text(app.profile.name.clone())
                    .size(size::SMALL)
                    .font(bold()),
                text(presence.1).size(size::MICRO).color(m.muted)
            ]
            .spacing(1)
            .width(Fill)
        ]
        .spacing(8)
        .align_y(iced::Center),
    )
    .padding([4, 4])
    .width(Fill)
    .style(m.tone(Tone::Ghost))
    .on_press(Msg::ProfileSettings);
    let mut controls = row![].spacing(2).align_y(iced::Center);
    // Microphone and deafen live in the call dock while the call view is open.
    if !(app.page == Page::Call && app.remote.voice.is_some()) {
        let (mute, deafen) = app.control_icons();
        controls = controls.push(mute).push(deafen);
    }
    controls = controls.push(ui::icon_button(
        m,
        Icon::Settings,
        "Configurações",
        Some(Msg::Navigate(Page::Settings)),
        Tone::Ghost,
        30.0,
    ));
    container(row![identity, controls].spacing(4).align_y(iced::Center))
        .id("profile-panel")
        .padding([8, 8])
        .style(move |_| m.surface(mix(m.sidebar, Color::BLACK, 0.22)))
        .into()
}

pub(super) fn sidebar(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let context = match app.page {
        Page::Settings => settings_sidebar(app),
        Page::Chat | Page::Call | Page::ServerSettings if app.server.is_some() => {
            server_sidebar(app)
        }
        _ => home_sidebar(app),
    };
    let mut bottom = column![].spacing(8);
    if let Some(panel) = connection_panel(app) {
        bottom = bottom.push(container(panel).padding([0, 8]));
    }
    // Status from local actions or confirmed session errors (never silent).
    let local = !app.status.is_empty()
        && app.status != app.remote.phase
        && Some(&app.status) != app.remote.error.as_ref();
    if let Some(message) = if local {
        Some(app.status.clone())
    } else {
        app.remote.error.clone()
    } {
        bottom = bottom.push(
            container(
                row![
                    ui::icon(Icon::CircleAlert, 15.0, m.warning),
                    text(message).size(size::CAPTION).color(m.muted).width(Fill)
                ]
                .spacing(8),
            )
            .padding([0, 14]),
        );
    }
    bottom = bottom.push(profile_panel(app));
    container(column![context, bottom].spacing(8))
        .width(SIDEBAR)
        .height(Fill)
        .style(move |_| m.surface(m.sidebar))
        .into()
}
