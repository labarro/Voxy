//! Private conversation with a friend, same visual language as channels.
use super::*;
use crate::{
    design::{Tone, radius, size},
    icons::Icon,
    ui::{self, Ring},
};
use iced::widget::{Space, column, tooltip};

pub(super) fn view(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let Some(peer) = app.direct_peer else {
        return ui::empty(
            m,
            Icon::MessageCircle,
            "Nenhuma conversa aberta",
            "Escolha um amigo na lateral para conversar em privado.",
            vec![],
        );
    };
    let snapshot = app.remote.snapshot.as_ref();
    let name = snapshot
        .and_then(|s| {
            s.friends
                .iter()
                .find(|f| f.requester == peer || f.recipient == peer)
        })
        .map(|f| {
            if f.requester == app.profile.id {
                f.recipient_name.clone()
            } else {
                f.requester_name.clone()
            }
        })
        .unwrap_or_else(|| "Mensagem privada".into());
    let online = snapshot.is_some_and(|s| s.members.iter().any(|x| x.id == peer));
    let presence = snapshot
        .and_then(|s| s.profiles.iter().find(|p| p.id == peer))
        .map(|p| p.presence);
    let header = container(
        row![
            iced::widget::stack![
                ui::avatar(m, &name, 32.0, Ring::default()),
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
                text(name.clone()).size(size::HEADING).font(bold()),
                text(if online {
                    "Online neste servidor · histórico guardado pelo host"
                } else {
                    "Fora deste servidor · histórico guardado pelo host"
                })
                .size(size::CAPTION)
                .color(m.muted)
            ]
            .spacing(1)
            .width(Fill),
            ui::icon_button(
                m,
                Icon::History,
                if app.direct_request.is_some() {
                    "Carregando…"
                } else {
                    "Mensagens anteriores"
                },
                Some(Msg::DirectOlder),
                Tone::Ghost,
                32.0
            ),
            ui::icon_button(
                m,
                Icon::RefreshCw,
                "Mensagens recentes",
                Some(Msg::DirectLatest),
                Tone::Ghost,
                32.0
            ),
            ui::icon_button(
                m,
                Icon::CheckCheck,
                "Marcar como lidas",
                Some(Msg::DirectReadAll),
                Tone::Ghost,
                32.0
            ),
        ]
        .spacing(10)
        .align_y(iced::Center),
    )
    .padding([0, 18])
    .height(64)
    .align_y(iced::Center);
    let entries: Vec<&voxy_core::room::DirectMessage> = if snapshot.is_some() {
        app.direct_entries()
            .iter()
            .filter(|d| d.from == peer || d.to == peer)
            .collect()
    } else {
        vec![]
    };
    let mut history = column![].spacing(0);
    let mut previous: Option<&voxy_core::room::DirectMessage> = None;
    for message in &entries {
        let mine = message.from == app.profile.id;
        let author = if mine {
            app.profile.name.clone()
        } else {
            name.clone()
        };
        let grouped = previous
            .is_some_and(|p| p.from == message.from && message.time - p.time < 7 * 60 * 1000);
        previous = Some(message);
        let mut content = column![].spacing(4).width(Fill);
        if !grouped {
            content = content.push(
                row![
                    text(author.clone()).size(size::STRONG).font(bold()),
                    text(platform::time_label(message.time))
                        .size(size::MICRO)
                        .color(m.faint)
                ]
                .spacing(8)
                .align_y(iced::Center),
            );
        }
        let mut body = row![chat::message_text(&message.text, m)]
            .spacing(6)
            .align_y(iced::Alignment::End);
        if message.edited_at.is_some() {
            body = body.push(text("(editada)").size(size::MICRO).color(m.faint));
        }
        if mine {
            let read = message.read_at.is_some();
            body = body.push(ui::tip(
                m,
                ui::icon(
                    if read { Icon::CheckCheck } else { Icon::Check },
                    13.0,
                    if read { m.accent } else { m.faint },
                ),
                if read { "Lida" } else { "Enviada" },
                tooltip::Position::Top,
            ));
        }
        content = content.push(body);
        for attachment in &message.attachments {
            content = content.push(
                ui::action(
                    m,
                    Some(Icon::Image),
                    &format!(
                        "{} · {}×{}",
                        attachment.name, attachment.width, attachment.height
                    ),
                    Some(Msg::OpenImage(attachment.clone())),
                    Tone::Secondary,
                )
                .padding([6, 10]),
            );
        }
        let gutter: Element<'_, Msg> = if grouped {
            Space::new().width(46).into()
        } else {
            container(ui::avatar(m, &author, 36.0, Ring::default()))
                .width(46)
                .into()
        };
        let line = container(row![gutter, content].spacing(12))
            .padding(
                iced::Padding::new(0.0)
                    .top(if grouped { 2.0 } else { 10.0 })
                    .bottom(2.0)
                    .left(16.0)
                    .right(16.0),
            )
            .width(Fill);
        let layered: Element<'_, Msg> = if app.message_hover == Some(message.id) && mine {
            stack![
                line,
                container(
                    container(
                        row![
                            ui::icon_button(
                                m,
                                Icon::Pencil,
                                "Editar",
                                Some(Msg::DirectEdit(message.id)),
                                Tone::Ghost,
                                28.0
                            ),
                            ui::icon_button(
                                m,
                                Icon::Trash2,
                                "Excluir",
                                Some(Msg::DirectDelete(message.id)),
                                Tone::Ghost,
                                28.0
                            )
                        ]
                        .spacing(2)
                    )
                    .padding(3)
                    .style(move |_| m.floating())
                )
                .width(Fill)
                .align_x(iced::alignment::Horizontal::Right)
                .padding(iced::Padding::new(0.0).right(18.0))
            ]
            .into()
        } else {
            line.into()
        };
        history = history.push(
            mouse_area(layered)
                .on_enter(Msg::MessageHover(Some(message.id)))
                .on_exit(Msg::MessageHover(None)),
        );
    }
    let history: Element<'_, Msg> = if entries.is_empty() {
        ui::empty(
            m,
            Icon::MessageCircle,
            &format!("Converse com {name}"),
            "Mensagens privadas ficam guardadas pelo host do servidor; só vocês dois podem lê-las.",
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
    if app.editing_message.is_some() {
        composer = composer.push(
            row![
                ui::icon(Icon::Pencil, 14.0, m.accent),
                text("Editando mensagem privada")
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
    let send_label = if app.editing_message.is_some() {
        "Salvar edição"
    } else if app.pending_message.is_some() {
        "Reenviar"
    } else {
        "Enviar"
    };
    composer = composer.push(
        container(
            row![
                ui::icon_button(
                    m,
                    Icon::Image,
                    "Enviar imagem (PNG/JPEG até 3 MiB)",
                    (app.image_transfer.is_none() && snapshot.is_some()).then_some(Msg::PickImage),
                    Tone::Ghost,
                    34.0
                ),
                text_input(&format!("Mensagem para {name}"), &app.draft)
                    .on_input(Msg::Draft)
                    .on_submit(Msg::DirectSend)
                    .padding([10, 4])
                    .size(size::BODY)
                    .style(move |theme, status| {
                        let mut s = m.input()(theme, status);
                        s.background = Color::TRANSPARENT.into();
                        s.border.width = 0.0;
                        s
                    }),
                ui::icon_button(
                    m,
                    Icon::SendHorizontal,
                    send_label,
                    (!app.draft.trim().is_empty() || app.pending_message.is_some())
                        .then_some(Msg::DirectSend),
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
    column![
        header,
        container(Space::new().height(1))
            .width(Fill)
            .style(move |_| m.surface(m.border)),
        history,
        container(composer).padding(iced::Padding::new(16.0).top(6.0))
    ]
    .width(Fill)
    .height(Fill)
    .into()
}
