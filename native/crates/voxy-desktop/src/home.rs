//! Home: the entry point of a communication app. Live call first, then calls
//! happening now, servers, friends and notifications. Only real data; empty
//! states carry actions instead of filler.
use super::*;
use crate::{
    design::{Tone, mix, radius, size},
    icons::Icon,
    ui::{self, Ring},
};
use iced::widget::{Space, column, responsive, tooltip};

fn greeting() -> &'static str {
    let hour = platform::local_hour();
    match hour {
        5..=11 => "Bom dia",
        12..=17 => "Boa tarde",
        _ => "Boa noite",
    }
}

fn card<'a>(m: Materials, content: impl Into<Element<'a, Msg>>) -> Element<'a, Msg> {
    container(content)
        .padding(16)
        .width(Fill)
        .style(move |_| m.card())
        .into()
}

fn section_head<'a>(
    m: Materials,
    title: &'a str,
    trailing: Option<Element<'a, Msg>>,
) -> Element<'a, Msg> {
    let mut head = row![
        text(title).size(size::STRONG).font(bold()),
        Space::new().width(Fill)
    ]
    .align_y(iced::Center);
    if let Some(trailing) = trailing {
        head = head.push(trailing);
    }
    let _ = m;
    head.into()
}

fn live_call(app: &App) -> Option<Element<'_, Msg>> {
    let m = app.palette();
    let channel = app.remote.voice?;
    let snapshot = app.remote.snapshot.as_ref()?;
    let name = snapshot
        .channels
        .iter()
        .find(|c| c.id == channel)
        .map(|c| c.name.clone())
        .unwrap_or_default();
    let mut people = row![].spacing(6);
    for p in snapshot
        .members
        .iter()
        .filter(|p| p.voice == Some(channel))
        .take(8)
    {
        people = people.push(ui::avatar(
            m,
            &p.name,
            34.0,
            Ring {
                speaking: chrome::speaking(app, p),
                muted: p.muted,
                deafened: p.deafened,
            },
        ));
    }
    Some(
        container(
            row![
                column![
                    row![
                        ui::dot(m.speaking, 8.0),
                        text("Em chamada agora")
                            .size(size::CAPTION)
                            .font(bold())
                            .color(m.speaking)
                    ]
                    .spacing(6)
                    .align_y(iced::Center),
                    text(name).size(size::TITLE).font(bold()),
                    text(snapshot.server.name.clone())
                        .size(size::SMALL)
                        .color(m.muted),
                    people
                ]
                .spacing(8)
                .width(Fill),
                ui::action(
                    m,
                    Some(Icon::Volume2),
                    "Abrir chamada",
                    Some(Msg::OpenCall),
                    Tone::Primary
                ),
            ]
            .spacing(10)
            .align_y(iced::Center),
        )
        .padding(20)
        .width(Fill)
        .style(move |_| container::Style {
            background: Some(iced::Background::Gradient(
                iced::gradient::Linear::new(iced::Radians(1.9))
                    .add_stop(0.0, mix(m.panel, m.speaking, 0.12))
                    .add_stop(0.6, m.panel)
                    .add_stop(1.0, mix(m.panel, m.accent, 0.1))
                    .into(),
            )),
            border: Border {
                radius: radius::XL.into(),
                width: 1.0,
                color: alpha(m.speaking, 0.35),
            },
            text_color: Some(m.ink),
            ..Default::default()
        })
        .into(),
    )
}

fn calls_now(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let Some(snapshot) = &app.remote.snapshot else {
        return card(
            m,
            row![
                ui::icon(Icon::WifiOff, 20.0, m.muted),
                column![
                    text("Nenhum servidor conectado").size(size::BODY).font(bold()),
                    text("Hospede um servidor seu ou reconecte um servidor salvo para ver quem está em chamada.")
                        .size(size::CAPTION)
                        .color(m.muted)
                ]
                .spacing(3)
            ]
            .spacing(12)
            .align_y(iced::Center),
        );
    };
    let mut list = column![].spacing(8);
    let mut voice: Vec<_> = snapshot
        .channels
        .iter()
        .filter(|c| c.kind == ChannelKind::Voice)
        .collect();
    let count = |id: uuid::Uuid| {
        snapshot
            .members
            .iter()
            .filter(|p| p.voice == Some(id))
            .count()
    };
    voice.sort_by_key(|c| std::cmp::Reverse(count(c.id)));
    for channel in voice {
        let members: Vec<_> = snapshot
            .members
            .iter()
            .filter(|p| p.voice == Some(channel.id))
            .collect();
        let joined = app.remote.voice == Some(channel.id);
        let empty = members.is_empty();
        let mut faces = row![].spacing(-6.0);
        for p in members.iter().take(6) {
            faces = faces.push(ui::avatar(
                m,
                &p.name,
                26.0,
                Ring {
                    speaking: chrome::speaking(app, p),
                    ..Default::default()
                },
            ));
        }
        list = list.push(
            container(
                row![
                    container(ui::icon(
                        Icon::Volume2,
                        18.0,
                        if members.is_empty() {
                            m.muted
                        } else {
                            m.speaking
                        }
                    ))
                    .width(36)
                    .height(36)
                    .center(36)
                    .style(move |_| container::Style {
                        background: Some(alpha(if empty { m.ink } else { m.speaking }, 0.1).into()),
                        border: Border {
                            radius: radius::M.into(),
                            ..Default::default()
                        },
                        ..Default::default()
                    }),
                    column![
                        text(channel.name.clone()).size(size::BODY).font(bold()),
                        text(match members.len() {
                            0 => "Ninguém agora".to_owned(),
                            1 => "1 pessoa".to_owned(),
                            n => format!("{n} pessoas"),
                        })
                        .size(size::CAPTION)
                        .color(m.muted)
                    ]
                    .spacing(2)
                    .width(Fill),
                    faces,
                    if joined {
                        ui::action(
                            m,
                            Some(Icon::Volume2),
                            "Abrir",
                            Some(Msg::OpenCall),
                            Tone::Secondary,
                        )
                    } else {
                        ui::action(
                            m,
                            Some(Icon::Phone),
                            "Entrar",
                            Some(Msg::Channel(channel.id)),
                            Tone::Secondary,
                        )
                    }
                ]
                .spacing(12)
                .align_y(iced::Center),
            )
            .padding([10, 12])
            .style(move |_| m.card()),
        );
    }
    column![
        section_head(
            m,
            "Chamadas agora",
            Some(
                text(snapshot.server.name.clone())
                    .size(size::CAPTION)
                    .color(m.faint)
                    .into()
            )
        ),
        list
    ]
    .spacing(10)
    .into()
}

fn servers(app: &App, columns: usize) -> Element<'_, Msg> {
    let m = app.palette();
    let mut tiles: Vec<Element<'_, Msg>> = Vec::new();
    for server in &app.communities {
        let connected = app
            .remote
            .snapshot
            .as_ref()
            .is_some_and(|s| s.server.id == server.id);
        let owner = server.owner == app.profile.id;
        let waiting = app.remote.waiting_host == Some(server.id);
        let tint = ui::person_color(&server.name);
        let status = if waiting {
            "Offline · o host não está hospedando; tentando a cada 20 s".into()
        } else if connected {
            format!(
                "Conectado · {} online",
                app.remote
                    .snapshot
                    .as_ref()
                    .map(|s| s.members.len())
                    .unwrap_or(0)
            )
        } else if owner {
            "Seu servidor · não hospedado".into()
        } else {
            "Salvo · entre sem novo convite".into()
        };
        let mut actions = row![Space::new().width(Fill)]
            .spacing(4)
            .align_y(iced::Center);
        if waiting {
            actions = actions.push(
                ui::action(
                    m,
                    Some(Icon::X),
                    "Parar de aguardar",
                    Some(Msg::Disconnect),
                    Tone::Secondary,
                )
                .padding([6, 10]),
            );
        } else if !connected && !owner {
            actions = actions
                .push(ui::icon_button(
                    m,
                    Icon::Trash2,
                    "Remover dos salvos",
                    Some(Msg::ForgetRecent(server.id)),
                    Tone::Ghost,
                    30.0,
                ))
                .push(
                    ui::action(
                        m,
                        Some(Icon::RefreshCw),
                        "Reconectar",
                        Some(Msg::Reconnect(server.id)),
                        Tone::Secondary,
                    )
                    .padding([6, 10]),
                );
        }
        tiles.push(
            button(
                column![
                    row![
                        container(
                            text(ui::initials(&server.name))
                                .size(size::STRONG)
                                .font(bold())
                                .color(Color::WHITE)
                        )
                        .width(44)
                        .height(44)
                        .center(44)
                        .style(move |_| container::Style {
                            background: Some(mix(tint, m.canvas, 0.3).into()),
                            border: Border {
                                radius: radius::L.into(),
                                ..Default::default()
                            },
                            ..Default::default()
                        }),
                        column![
                            text(server.name.clone()).size(size::STRONG).font(bold()),
                            row![
                                ui::dot(if connected { m.speaking } else { m.faint }, 7.0),
                                text(status).size(size::CAPTION).color(m.muted)
                            ]
                            .spacing(6)
                            .align_y(iced::Center)
                        ]
                        .spacing(4)
                        .width(Fill)
                    ]
                    .spacing(12)
                    .align_y(iced::Center),
                    actions
                ]
                .spacing(10),
            )
            .padding(14)
            .width(Fill)
            .style(move |_, status| {
                let hover = matches!(status, widget::button::Status::Hovered);
                widget::button::Style {
                    background: Some(
                        if hover {
                            mix(m.panel, Color::WHITE, 0.04)
                        } else {
                            m.panel
                        }
                        .into(),
                    ),
                    text_color: m.ink,
                    border: Border {
                        radius: radius::L.into(),
                        width: 1.0,
                        color: if connected {
                            alpha(m.speaking, 0.35)
                        } else {
                            m.border
                        },
                    },
                    ..Default::default()
                }
            })
            .on_press(Msg::Server(server.id))
            .into(),
        );
    }
    let body: Element<'_, Msg> = if tiles.is_empty() {
        card(
            m,
            column![
                text("Você ainda não tem servidores")
                    .size(size::BODY)
                    .font(bold()),
                text("Crie um espaço para o seu grupo ou cole o convite que recebeu.")
                    .size(size::CAPTION)
                    .color(m.muted),
                row![
                    ui::action(
                        m,
                        Some(Icon::Plus),
                        "Criar servidor",
                        Some(Msg::NewServer),
                        Tone::Primary
                    ),
                    ui::action(
                        m,
                        Some(Icon::LogIn),
                        "Entrar por convite",
                        Some(Msg::JoinDialog),
                        Tone::Secondary
                    )
                ]
                .spacing(8)
            ]
            .spacing(10),
        )
    } else {
        let mut grid = column![].spacing(10);
        let mut iter = tiles.into_iter().peekable();
        while iter.peek().is_some() {
            let mut line = row![].spacing(10);
            for _ in 0..columns {
                line = line.push(match iter.next() {
                    Some(t) => container(t).width(Fill),
                    None => container(Space::new()).width(Fill),
                });
            }
            grid = grid.push(line);
        }
        grid.into()
    };
    column![
        section_head(
            m,
            "Servidores",
            Some(
                text(format!("{}", app.communities.len()))
                    .size(size::CAPTION)
                    .color(m.faint)
                    .into()
            )
        ),
        body
    ]
    .spacing(10)
    .into()
}

fn recent_messages(app: &App) -> Option<Element<'_, Msg>> {
    let m = app.palette();
    let snapshot = app.remote.snapshot.as_ref()?;
    if snapshot.messages.is_empty() {
        return None;
    }
    let mut list = column![].spacing(12);
    for message in snapshot.messages.iter().rev().take(4) {
        let channel = snapshot
            .channels
            .iter()
            .find(|c| c.id == message.channel_id)
            .map(|c| c.name.clone())
            .unwrap_or_default();
        list = list.push(
            row![
                ui::avatar(m, &message.name, 30.0, Ring::default()),
                column![
                    row![
                        text(message.name.clone()).size(size::SMALL).font(bold()),
                        text(format!("#{channel}")).size(size::MICRO).color(m.faint),
                        text(platform::time_label(message.time))
                            .size(size::MICRO)
                            .color(m.faint)
                    ]
                    .spacing(6)
                    .align_y(iced::Center),
                    text(message.text.chars().take(140).collect::<String>())
                        .size(size::SMALL)
                        .color(m.muted)
                ]
                .spacing(2)
                .width(Fill)
            ]
            .spacing(10),
        );
    }
    Some(
        column![section_head(m, "Mensagens recentes", None), card(m, list)]
            .spacing(10)
            .into(),
    )
}

fn friends_card(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut list = column![
        row![
            text_input("ID de perfil do amigo", &app.friend_id)
                .on_input(Msg::FriendId)
                .on_submit(Msg::FriendRequest)
                .padding([8, 10])
                .size(size::SMALL)
                .width(Fill)
                .style(m.input()),
            ui::icon_button(
                m,
                Icon::UserPlus,
                "Enviar solicitação",
                (app.remote.snapshot.is_some() && !app.friend_id.trim().is_empty())
                    .then_some(Msg::FriendRequest),
                Tone::Secondary,
                36.0
            )
        ]
        .spacing(6)
        .align_y(iced::Center)
    ]
    .spacing(10);
    let mut count = 0;
    if let Some(snapshot) = &app.remote.snapshot {
        let mut friends: Vec<_> = snapshot.friends.iter().collect();
        friends.sort_by_key(|f| f.accepted);
        for friend in friends {
            let outgoing = friend.requester == app.profile.id;
            let (peer, name) = if outgoing {
                (friend.recipient, &friend.recipient_name)
            } else {
                (friend.requester, &friend.requester_name)
            };
            let online = snapshot.members.iter().any(|x| x.id == peer);
            let presence = snapshot
                .profiles
                .iter()
                .find(|p| p.id == peer)
                .map(|p| p.presence);
            let status = if friend.accepted {
                if online {
                    "Online neste servidor"
                } else {
                    "Fora deste servidor"
                }
            } else if outgoing {
                "Solicitação enviada"
            } else {
                "Quer ser seu amigo"
            };
            let mut line = row![
                iced::widget::stack![
                    ui::avatar(m, name, 32.0, Ring::default()),
                    container(ui::dot(
                        ui::presence_color(m, online.then_some(presence).flatten()),
                        10.0
                    ))
                    .width(41)
                    .height(41)
                    .align_x(iced::alignment::Horizontal::Right)
                    .align_y(iced::alignment::Vertical::Bottom)
                ],
                column![
                    text(name.clone()).size(size::SMALL).font(bold()),
                    text(status).size(size::MICRO).color(m.muted)
                ]
                .spacing(1)
                .width(Fill)
            ]
            .spacing(8)
            .align_y(iced::Center);
            if friend.accepted {
                line = line
                    .push(ui::icon_button(
                        m,
                        Icon::MessageCircle,
                        "Mensagem privada",
                        Some(Msg::Direct(peer)),
                        Tone::Ghost,
                        30.0,
                    ))
                    .push(ui::icon_button(
                        m,
                        Icon::UserX,
                        "Remover amizade",
                        Some(Msg::FriendRemove(peer)),
                        Tone::Ghost,
                        30.0,
                    ));
            } else if !outgoing {
                line = line
                    .push(ui::icon_button(
                        m,
                        Icon::Check,
                        "Aceitar",
                        Some(Msg::FriendRespond(peer, true)),
                        Tone::Primary,
                        30.0,
                    ))
                    .push(ui::icon_button(
                        m,
                        Icon::X,
                        "Recusar",
                        Some(Msg::FriendRespond(peer, false)),
                        Tone::Ghost,
                        30.0,
                    ));
            }
            list = list.push(line);
            count += 1;
        }
    }
    if count == 0 {
        list = list.push(
            text(if app.remote.snapshot.is_some() {
                "Peça o ID de perfil de alguém deste servidor (Configurações › Perfil) e envie uma solicitação."
            } else {
                "Amigos e mensagens privadas ficam disponíveis com um servidor conectado."
            })
            .size(size::CAPTION)
            .color(m.faint),
        );
    }
    column![section_head(m, "Amigos", None), card(m, list)]
        .spacing(10)
        .into()
}

fn notifications_card(app: &App) -> Option<Element<'_, Msg>> {
    let m = app.palette();
    let snapshot = app.remote.snapshot.as_ref()?;
    let mut list = column![].spacing(4);
    let unread = snapshot.notifications.iter().filter(|n| !n.read).count();
    for note in snapshot.notifications.iter().take(8) {
        let name = snapshot
            .members
            .iter()
            .find(|x| x.id == note.sender)
            .map(|x| x.name.clone())
            .unwrap_or_else(|| "Alguém".into());
        let (glyph, kind) = match note.kind.as_str() {
            "reply" => (Icon::Reply, "respondeu você"),
            "mention" => (Icon::AtSign, "mencionou você"),
            "direct" => (Icon::MessageCircle, "enviou mensagem privada"),
            "friend-request" => (Icon::UserPlus, "quer ser seu amigo"),
            "friend-accepted" => (Icon::UserCheck, "aceitou sua amizade"),
            _ => (Icon::Bell, "atividade"),
        };
        list = list.push(
            button(
                row![
                    ui::icon(glyph, 16.0, if note.read { m.faint } else { m.accent }),
                    text(format!("{name} {kind}"))
                        .size(size::SMALL)
                        .color(if note.read { m.muted } else { m.ink })
                        .width(Fill),
                    if note.read {
                        Space::new().width(0).into()
                    } else {
                        ui::dot(m.accent, 7.0)
                    }
                ]
                .spacing(10)
                .align_y(iced::Center),
            )
            .padding([7, 8])
            .width(Fill)
            .style(m.navigation(false))
            .on_press(Msg::NotificationOpen(note.id)),
        );
    }
    if snapshot.notifications.is_empty() {
        list = list.push(text("Tudo em dia.").size(size::CAPTION).color(m.faint));
    }
    Some(
        column![
            section_head(
                m,
                "Notificações",
                (unread > 0).then(|| ui::badge(unread.to_string(), Color::WHITE, m.danger))
            ),
            card(m, list)
        ]
        .spacing(10)
        .into(),
    )
}

fn header(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let subtitle = match (&app.remote.snapshot, app.remote.voice) {
        (Some(s), Some(_)) => format!("Em chamada em {}", s.server.name),
        (Some(s), None) => {
            let calling = s.members.iter().filter(|p| p.voice.is_some()).count();
            if calling > 0 {
                format!("{} · {calling} em chamada agora", s.server.name)
            } else {
                format!("Conectado a {}", s.server.name)
            }
        }
        _ => "Nenhum servidor conectado".into(),
    };
    row![
        column![
            text(format!("{}, {}", greeting(), app.profile.name))
                .size(size::DISPLAY)
                .font(bold()),
            text(subtitle).size(size::BODY).color(m.muted)
        ]
        .spacing(4)
        .width(Fill),
        ui::action(
            m,
            Some(Icon::LogIn),
            "Entrar por convite",
            Some(Msg::JoinDialog),
            Tone::Secondary
        ),
        ui::action(
            m,
            Some(Icon::Plus),
            "Criar servidor",
            Some(Msg::NewServer),
            Tone::Primary
        ),
    ]
    .spacing(8)
    .align_y(iced::Center)
    .into()
}

pub(super) fn view(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let content = responsive(move |bounds| {
        let wide = bounds.width >= 980.0;
        let mut main = column![].spacing(26);
        if let Some(call) = live_call(app) {
            main = main.push(call);
        }
        main = main.push(calls_now(app));
        main = main.push(servers(
            app,
            if bounds.width >= 1300.0 { 3 } else { 2 }.min(if wide { 3 } else { 2 }),
        ));
        if let Some(recent) = recent_messages(app) {
            main = main.push(recent);
        }
        let mut side = column![friends_card(app)].spacing(26);
        if let Some(notes) = notifications_card(app) {
            side = side.push(notes);
        }
        let body: Element<'_, Msg> = if wide {
            row![main.width(Fill), side.width(320)].spacing(26).into()
        } else {
            column![main, side].spacing(26).into()
        };
        scrollable(
            container(column![header(app), body].spacing(28))
                .padding([28, 32])
                .max_width(1320),
        )
        .height(Fill)
        .width(Fill)
        .direction(design::vertical_scrollbar())
        .style(m.scroll())
        .into()
    });
    let _ = tooltip::Position::Top;
    content.into()
}
