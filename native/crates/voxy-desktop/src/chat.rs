//! Server text channel: grouped history, overlay hover actions (no layout
//! shift), replies, reactions, images, composer and the members panel with a
//! mini profile. All actions go to the real core.
use super::*;
use crate::{
    design::{Tone, mix, radius, size},
    icons::Icon,
    ui::{self, Ring},
};
use iced::widget::{Space, column, tooltip};

/// "#RRGGBB" → color.
pub(super) fn hex(value: &str) -> Option<Color> {
    let v = value.strip_prefix('#')?;
    (v.len() == 6)
        .then(|| u32::from_str_radix(v, 16).ok())
        .flatten()
        .map(design::rgb)
}
/// Nickname color, else the highest-positioned colored role.
pub(super) fn name_color(app: &App, member: uuid::Uuid) -> Option<Color> {
    let snapshot = app.remote.snapshot.as_ref()?;
    if let Some(color) = snapshot
        .profiles
        .iter()
        .find(|p| p.id == member)
        .and_then(|p| hex(&p.nickname_color))
    {
        return Some(color);
    }
    snapshot
        .member_roles
        .iter()
        .filter(|r| r.member == member)
        .filter_map(|r| snapshot.roles.iter().find(|x| x.id == r.role))
        .filter(|r| hex(&r.color).is_some())
        .max_by_key(|r| r.position)
        .and_then(|r| hex(&r.color))
}

fn message_text(message: &str, m: Materials) -> Element<'_, Msg> {
    let spans = voxy_core::links::message_parts(message)
        .into_iter()
        .map(|(label, link)| {
            let color = if link.is_some() { m.accent } else { m.ink };
            let span = widget::span(label).color(color);
            let span = if link.is_some() {
                span.underline(true)
            } else {
                span
            };
            span.link_maybe(link)
        })
        .collect::<Vec<_>>();
    widget::rich_text(spans)
        .size(size::BODY)
        .line_height(1.45)
        .on_link_click(Msg::OpenLink)
        .into()
}

fn hover_tools<'a>(app: &'a App, message: &'a ChatMessage) -> Element<'a, Msg> {
    let m = app.palette();
    let mut tools = row![].spacing(2).align_y(iced::Center);
    for emoji in ["👍", "❤️", "😂"] {
        tools = tools.push(ui::tip(
            m,
            button(text(emoji).size(size::BODY))
                .padding([3, 6])
                .style(m.tone(Tone::Ghost))
                .on_press(Msg::ReactMessage(message.id, emoji.into())),
            format!("Reagir com {emoji}"),
            tooltip::Position::Top,
        ));
    }
    tools = tools.push(ui::icon_button(
        m,
        Icon::Reply,
        "Responder",
        Some(Msg::ReplyMessage(message.id)),
        Tone::Ghost,
        28.0,
    ));
    if message.author == app.profile.id {
        tools = tools
            .push(ui::icon_button(
                m,
                Icon::Pencil,
                "Editar",
                Some(Msg::EditMessage(message.id)),
                Tone::Ghost,
                28.0,
            ))
            .push(ui::icon_button(
                m,
                Icon::Trash2,
                "Excluir",
                Some(Msg::Delete(message.id)),
                Tone::Ghost,
                28.0,
            ));
    }
    container(tools)
        .padding(3)
        .style(move |_| {
            let mut s = m.floating();
            s.border.radius = radius::M.into();
            s
        })
        .into()
}

fn message_row<'a>(
    app: &'a App,
    server: Option<&'a voxy_core::model::Community>,
    message: &'a ChatMessage,
    grouped: bool,
) -> Element<'a, Msg> {
    let m = app.palette();
    let mut content = column![].spacing(4).width(Fill);
    if let Some(target) = message.reply_to {
        let preview = app
            .messages
            .iter()
            .find(|x| x.id == target)
            .map(|x| (x.name.clone(), x.text.chars().take(90).collect::<String>()))
            .unwrap_or_else(|| ("".into(), "Mensagem anterior".into()));
        content = content.push(
            row![
                ui::icon(Icon::Reply, 13.0, m.faint),
                text(preview.0)
                    .size(size::CAPTION)
                    .font(bold())
                    .color(m.muted),
                text(preview.1).size(size::CAPTION).color(m.faint)
            ]
            .spacing(6)
            .align_y(iced::Center),
        );
    }
    if !grouped || message.reply_to.is_some() {
        let color = name_color(app, message.author).unwrap_or(m.ink);
        let mut head = row![
            text(message.name.clone())
                .size(size::STRONG)
                .font(bold())
                .color(color),
            text(platform::time_label(message.time))
                .size(size::MICRO)
                .color(m.faint)
        ]
        .spacing(8)
        .align_y(iced::Center);
        if server.is_some_and(|s| s.owner == message.author) {
            head = head.push(ui::tip(
                m,
                ui::icon(Icon::Crown, 13.0, m.warning),
                "Dono do servidor",
                tooltip::Position::Top,
            ));
        }
        content = content.push(head);
    }
    let mut body = row![message_text(&message.text, m)]
        .spacing(6)
        .align_y(iced::Alignment::End);
    if message.edited_at.is_some() {
        body = body.push(text("(editada)").size(size::MICRO).color(m.faint));
    }
    content = content.push(body);
    for attachment in &message.attachments {
        content = content.push(
            button(
                row![
                    ui::icon(Icon::Image, 18.0, m.accent),
                    column![
                        text(attachment.name.clone()).size(size::SMALL).font(bold()),
                        text(format!(
                            "{}×{} · abrir imagem",
                            attachment.width, attachment.height
                        ))
                        .size(size::MICRO)
                        .color(m.muted)
                    ]
                    .spacing(1)
                ]
                .spacing(10)
                .align_y(iced::Center),
            )
            .padding([8, 12])
            .style(m.tone(Tone::Secondary))
            .on_press(Msg::OpenImage(attachment.clone())),
        );
    }
    if !message.reactions.is_empty() {
        let mut reactions = row![].spacing(4);
        for (emoji, actors) in &message.reactions {
            let mine = actors.contains(&app.profile.id);
            reactions = reactions.push(
                button(
                    row![
                        text(emoji.clone()).size(size::SMALL),
                        text(actors.len().to_string())
                            .size(size::CAPTION)
                            .font(bold())
                    ]
                    .spacing(5)
                    .align_y(iced::Center),
                )
                .padding([3, 8])
                .style(move |_, status| widget::button::Style {
                    background: Some(
                        if mine {
                            alpha(m.accent, 0.2)
                        } else if matches!(status, widget::button::Status::Hovered) {
                            alpha(m.ink, 0.1)
                        } else {
                            alpha(m.ink, 0.05)
                        }
                        .into(),
                    ),
                    text_color: m.ink,
                    border: Border {
                        radius: radius::PILL.into(),
                        width: 1.0,
                        color: if mine {
                            alpha(m.accent, 0.6)
                        } else {
                            Color::TRANSPARENT
                        },
                    },
                    ..Default::default()
                })
                .on_press(Msg::ReactMessage(message.id, emoji.clone())),
            );
        }
        content = content.push(reactions);
    }
    let gutter: Element<'_, Msg> = if grouped && message.reply_to.is_none() {
        let hovered = app.message_hover == Some(message.id);
        container(
            text(if hovered {
                platform::time_label(message.time)
            } else {
                String::new()
            })
            .size(10)
            .color(m.faint),
        )
        .width(46)
        .align_x(iced::Center)
        .padding(iced::Padding::new(0.0).top(4.0))
        .into()
    } else {
        container(ui::avatar(m, &message.name, 36.0, Ring::default()))
            .width(46)
            .into()
    };
    let line = row![gutter, content].spacing(12);
    let active = app.message_hover == Some(message.id) || app.message_menu == Some(message.id);
    let editing =
        app.editing_message == Some(message.id) || app.replying_message == Some(message.id);
    let framed = container(line)
        .padding(
            iced::Padding::new(0.0)
                .top(if grouped { 2.0 } else { 10.0 })
                .bottom(2.0)
                .left(16.0)
                .right(16.0),
        )
        .width(Fill)
        .style(move |_| container::Style {
            background: (active || editing).then(|| {
                if editing {
                    alpha(m.accent, 0.08)
                } else {
                    alpha(m.ink, 0.03)
                }
                .into()
            }),
            ..Default::default()
        });
    let layered: Element<'_, Msg> = if active {
        stack![
            framed,
            container(hover_tools(app, message))
                .width(Fill)
                .align_x(iced::alignment::Horizontal::Right)
                .padding(iced::Padding::new(0.0).right(18.0).top(-14.0_f32.max(0.0)))
        ]
        .into()
    } else {
        framed.into()
    };
    mouse_area(layered)
        .on_enter(Msg::MessageHover(Some(message.id)))
        .on_exit(Msg::MessageHover(None))
        .on_right_press(Msg::MessageMenu(message.id))
        .into()
}

fn members_panel(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut list = column![].spacing(2);
    if let Some(snapshot) = app
        .remote
        .snapshot
        .as_ref()
        .filter(|s| Some(s.server.id) == app.server)
    {
        let (calling, idle): (Vec<_>, Vec<_>) =
            snapshot.members.iter().partition(|p| p.voice.is_some());
        for (title, group) in [("Em chamada", calling), ("Online", idle)] {
            if group.is_empty() {
                continue;
            }
            list = list.push(
                container(ui::label(m, format!("{title} — {}", group.len())))
                    .padding(iced::Padding::new(0.0).top(14.0).bottom(4.0).left(8.0)),
            );
            for person in group {
                let presence = snapshot
                    .profiles
                    .iter()
                    .find(|p| p.id == person.id)
                    .map(|p| p.presence);
                let talking = chrome::speaking(app, person);
                let color = name_color(app, person.id).unwrap_or(m.ink);
                let role = snapshot
                    .member_roles
                    .iter()
                    .filter(|r| r.member == person.id)
                    .filter_map(|r| snapshot.roles.iter().find(|x| x.id == r.role))
                    .max_by_key(|r| r.position)
                    .map(|r| r.name.clone());
                let subtitle = if person.voice.is_some() {
                    Some(if person.deafened {
                        "Ensurdecido".to_owned()
                    } else if person.muted {
                        "Microfone mudo".into()
                    } else {
                        "Em chamada".into()
                    })
                } else {
                    role
                };
                let mut info = column![
                    text(person.name.clone())
                        .size(size::SMALL)
                        .font(bold())
                        .color(color)
                ]
                .spacing(1);
                if let Some(subtitle) = subtitle {
                    info = info.push(text(subtitle).size(size::MICRO).color(m.muted));
                }
                let selected = app.member_popover == Some(person.id);
                list = list.push(
                    button(
                        row![
                            iced::widget::stack![
                                ui::avatar(
                                    m,
                                    &person.name,
                                    32.0,
                                    Ring {
                                        speaking: talking,
                                        ..Default::default()
                                    }
                                ),
                                container(ui::dot(ui::presence_color(m, presence), 10.0))
                                    .width(40)
                                    .height(40)
                                    .align_x(iced::alignment::Horizontal::Right)
                                    .align_y(iced::alignment::Vertical::Bottom)
                            ],
                            info
                        ]
                        .spacing(8)
                        .align_y(iced::Center),
                    )
                    .padding([3, 8])
                    .width(Fill)
                    .style(m.navigation(selected))
                    .on_press(Msg::MemberPopover(if selected {
                        None
                    } else {
                        Some(person.id)
                    })),
                );
            }
        }
    } else {
        list = list.push(
            container(
                text("Hospede ou conecte o servidor para ver quem está online.")
                    .size(size::CAPTION)
                    .color(m.faint),
            )
            .padding([14, 8]),
        );
    }
    let panel: Element<'_, Msg> = scrollable(container(list).padding([6, 8]))
        .height(Fill)
        .direction(design::vertical_scrollbar())
        .style(m.scroll())
        .into();
    let panel = container(panel)
        .width(248)
        .height(Fill)
        .style(move |_| m.surface(mix(m.canvas, m.sidebar, 0.55)));
    match app.member_popover.and_then(|id| {
        app.remote
            .snapshot
            .as_ref()
            .and_then(|s| s.members.iter().find(|x| x.id == id))
    }) {
        Some(member) => stack![panel, container(mini_profile(app, member)).padding(10)].into(),
        None => panel.into(),
    }
}

/// Mini profile popover with real actions.
pub(super) fn mini_profile<'a>(
    app: &'a App,
    member: &'a voxy_core::room::Member,
) -> Element<'a, Msg> {
    let m = app.palette();
    let snapshot = app.remote.snapshot.as_ref();
    let presence = snapshot
        .and_then(|s| s.profiles.iter().find(|p| p.id == member.id))
        .map(|p| p.presence);
    let color = name_color(app, member.id).unwrap_or(m.ink);
    let tint = ui::person_color(&member.name);
    let banner = container(Space::new().height(56))
        .width(Fill)
        .style(move |_| container::Style {
            background: Some(iced::Background::Gradient(
                iced::gradient::Linear::new(iced::Radians(1.2))
                    .add_stop(0.0, mix(tint, m.elevated, 0.2))
                    .add_stop(1.0, mix(m.accent, m.elevated, 0.55))
                    .into(),
            )),
            border: Border {
                radius: iced::border::Radius {
                    top_left: 14.0,
                    top_right: 14.0,
                    bottom_right: 0.0,
                    bottom_left: 0.0,
                },
                ..Default::default()
            },
            ..Default::default()
        });
    let mut roles = row![].spacing(4);
    if let Some(s) = snapshot {
        for role in s
            .member_roles
            .iter()
            .filter(|r| r.member == member.id)
            .filter_map(|r| s.roles.iter().find(|x| x.id == r.role))
        {
            roles = roles.push(ui::badge(
                role.name.clone(),
                hex(&role.color).unwrap_or(m.ink),
                alpha(m.ink, 0.07),
            ));
        }
    }
    let mut body = column![
        row![
            ui::avatar(
                m,
                &member.name,
                56.0,
                Ring {
                    speaking: chrome::speaking(app, member),
                    muted: member.muted,
                    deafened: member.deafened
                }
            ),
            Space::new().width(Fill),
            ui::icon_button(
                m,
                Icon::X,
                "Fechar perfil",
                Some(Msg::MemberPopover(None)),
                Tone::Ghost,
                28.0
            )
        ]
        .align_y(iced::Center),
        text(member.name.clone())
            .size(size::HEADING)
            .font(bold())
            .color(color),
        row![
            ui::dot(ui::presence_color(m, presence), 8.0),
            text(match presence {
                Some(voxy_core::room::Presence::Away) => "Ausente",
                Some(voxy_core::room::Presence::Busy) => "Não perturbe",
                _ => "Online",
            })
            .size(size::CAPTION)
            .color(m.muted)
        ]
        .spacing(6)
        .align_y(iced::Center),
        roles,
    ]
    .spacing(8);
    if member.id != app.profile.id {
        body = body.push(
            row![
                ui::action(
                    m,
                    Some(Icon::AtSign),
                    "Mencionar",
                    Some(Msg::Mention(member.id)),
                    Tone::Secondary
                )
                .padding([6, 10]),
                ui::action(
                    m,
                    Some(Icon::MessageCircle),
                    "Mensagem",
                    Some(Msg::Direct(member.id)),
                    Tone::Primary
                )
                .padding([6, 10]),
            ]
            .spacing(6),
        );
        if let Some(peer) = app.remote.peers.iter().find(|p| p.key == member.public_key) {
            let id = peer.id;
            body = body.push(
                row![
                    ui::icon(Icon::Volume2, 15.0, m.muted),
                    slider(0.0..=2.0, peer.volume, move |v| Msg::PeerVolume(id, v))
                        .step(0.05_f32)
                        .width(Fill)
                        .style(m.slider()),
                    text(format!("{}%", (peer.volume * 100.0).round() as i32))
                        .size(size::CAPTION)
                        .color(m.muted)
                        .width(40)
                ]
                .spacing(8)
                .align_y(iced::Center),
            );
        }
    } else {
        body = body.push(
            ui::action(
                m,
                Some(Icon::Pencil),
                "Editar perfil",
                Some(Msg::ProfileSettings),
                Tone::Secondary,
            )
            .padding([6, 10]),
        );
    }
    container(
        column![
            banner,
            container(body).padding(iced::Padding::new(14.0).top(0.0))
        ]
        .spacing(0),
    )
    .width(Fill)
    .style(move |_| m.floating())
    .into()
}

pub(super) fn view(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    if app.server.is_none() {
        return ui::empty(
            m,
            Icon::MessageCircle,
            "Nenhum servidor aberto",
            "Escolha um servidor na barra à esquerda, crie um novo ou entre pelo convite do seu grupo.",
            vec![
                ui::action(
                    m,
                    Some(Icon::LogIn),
                    "Entrar por convite",
                    Some(Msg::JoinDialog),
                    Tone::Primary,
                )
                .into(),
                ui::action(
                    m,
                    Some(Icon::Plus),
                    "Criar servidor",
                    Some(Msg::NewServer),
                    Tone::Secondary,
                )
                .into(),
            ],
        );
    }
    let server = app.communities.iter().find(|s| Some(s.id) == app.server);
    let channel_name = app
        .channels
        .iter()
        .find(|c| Some(c.id) == app.channel)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "conversa".into());
    let header = container(
        row![
            ui::icon(Icon::Hash, 20.0, m.muted),
            text(channel_name.clone()).size(size::HEADING).font(bold()),
            Space::new().width(Fill),
            text_input("Buscar neste histórico", &app.search)
                .on_input(Msg::Search)
                .on_submit(Msg::SearchRemote)
                .padding([7, 10])
                .size(size::SMALL)
                .width(220)
                .style(m.input()),
            ui::icon_button(
                m,
                Icon::Search,
                "Buscar",
                Some(Msg::SearchRemote),
                Tone::Ghost,
                32.0
            ),
            ui::icon_button(
                m,
                Icon::History,
                "Anteriores",
                Some(Msg::OlderMessages),
                Tone::Ghost,
                32.0
            ),
            ui::icon_button(
                m,
                Icon::Users,
                if app.members_panel {
                    "Ocultar membros"
                } else {
                    "Mostrar membros"
                },
                Some(Msg::ToggleMembers),
                if app.members_panel {
                    Tone::Active
                } else {
                    Tone::Ghost
                },
                32.0
            ),
        ]
        .spacing(8)
        .align_y(iced::Center),
    )
    .padding([0, 18])
    .height(56)
    .align_y(iced::Center);
    let filter = app.search.to_lowercase();
    let visible: Vec<&ChatMessage> = app
        .messages
        .iter()
        .filter(|message| filter.is_empty() || message.text.to_lowercase().contains(&filter))
        .collect();
    let mut history = column![].spacing(0);
    let mut previous: Option<&ChatMessage> = None;
    for message in &visible {
        let grouped = previous
            .is_some_and(|p| p.author == message.author && message.time - p.time < 7 * 60 * 1000);
        history = history.push(message_row(app, server, message, grouped));
        previous = Some(message);
    }
    let history: Element<'_, Msg> = if visible.is_empty() {
        ui::empty(
            m,
            if filter.is_empty() {
                Icon::Hash
            } else {
                Icon::Search
            },
            &if filter.is_empty() {
                format!("Bem-vindo a #{channel_name}")
            } else {
                "Nada encontrado".into()
            },
            if filter.is_empty() {
                "Este é o começo do canal. Envie a primeira mensagem."
            } else {
                "Nenhuma mensagem carregada contém esse termo. Busque no histórico do servidor com Enter."
            },
            vec![],
        )
    } else {
        scrollable(history.padding(iced::Padding::new(0.0).top(8.0).bottom(16.0)))
            .anchor_bottom()
            .height(Fill)
            .width(Fill)
            .direction(design::vertical_scrollbar())
            .style(m.scroll())
            .into()
    };
    let mut composer = column![].spacing(6);
    if let Some(id) = app.editing_message.or(app.replying_message) {
        let editing = app.editing_message.is_some();
        let target = app
            .messages
            .iter()
            .find(|x| x.id == id)
            .map(|x| x.name.clone())
            .unwrap_or_default();
        composer = composer.push(
            row![
                ui::icon(
                    if editing { Icon::Pencil } else { Icon::Reply },
                    14.0,
                    m.accent
                ),
                text(if editing {
                    "Editando sua mensagem".to_owned()
                } else {
                    format!("Respondendo a {target}")
                })
                .size(size::CAPTION)
                .color(m.muted)
                .width(Fill),
                ui::icon_button(
                    m,
                    Icon::X,
                    "Cancelar",
                    Some(Msg::CancelEdit),
                    Tone::Ghost,
                    26.0
                )
            ]
            .spacing(8)
            .align_y(iced::Center),
        );
    }
    if app.image_transfer.is_some() {
        composer = composer.push(
            row![
                ui::icon(Icon::LoaderCircle, 14.0, m.accent),
                text("Transferindo imagem…")
                    .size(size::CAPTION)
                    .color(m.muted)
                    .width(Fill),
                ui::action(
                    m,
                    None,
                    "Cancelar transferência",
                    Some(Msg::CancelImage),
                    Tone::Ghost
                )
            ]
            .spacing(8)
            .align_y(iced::Center),
        );
    }
    let input = text_input(
        &if app.editing_message.is_some() {
            "Editar mensagem".to_owned()
        } else {
            format!("Conversar em #{channel_name}")
        },
        &app.draft,
    )
    .on_input(Msg::Draft)
    .on_submit(Msg::Send)
    .padding([10, 4])
    .size(size::BODY)
    .style(move |theme, status| {
        let mut s = m.input()(theme, status);
        s.background = Color::TRANSPARENT.into();
        s.border.width = 0.0;
        s
    });
    composer = composer.push(
        container(
            row![
                ui::icon_button(
                    m,
                    Icon::Image,
                    "Enviar imagem (PNG/JPEG até 3 MiB)",
                    (app.is_remote() && app.image_transfer.is_none()).then_some(Msg::PickImage),
                    Tone::Ghost,
                    34.0
                ),
                input,
                ui::icon_button(
                    m,
                    Icon::SendHorizontal,
                    if app.pending_message.is_some() {
                        "Reenviar"
                    } else {
                        "Enviar"
                    },
                    (!app.draft.trim().is_empty() || app.pending_message.is_some())
                        .then_some(Msg::Send),
                    if app.draft.trim().is_empty() {
                        Tone::Ghost
                    } else {
                        Tone::Primary
                    },
                    34.0
                )
            ]
            .spacing(6)
            .align_y(iced::Center),
        )
        .padding([4, 6])
        .style(move |_| container::Style {
            background: Some(m.panel.into()),
            border: Border {
                radius: radius::L.into(),
                width: 1.0,
                color: m.border,
            },
            ..Default::default()
        }),
    );
    let main = column![
        header,
        container(Space::new().height(1))
            .width(Fill)
            .style(move |_| m.surface(m.border)),
        history,
        container(composer).padding(iced::Padding::new(16.0).top(6.0))
    ]
    .width(Fill)
    .height(Fill);
    if app.members_panel {
        row![main, members_panel(app)].height(Fill).into()
    } else {
        main.into()
    }
}
