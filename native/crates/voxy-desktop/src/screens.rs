//! Social desktop surfaces. Every action below targets the real core or local store.
use super::*;
use iced::widget::{column, rule, toggler, tooltip};

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
fn message_text(message: &str, m: Materials) -> Element<'_, Msg> {
    let spans = voxy_core::links::message_parts(message)
        .into_iter()
        .map(|(label, link)| {
            let color = if link.is_some() { m.accent } else { m.ink };
            widget::span(label).color(color).link_maybe(link)
        })
        .collect::<Vec<_>>();
    widget::rich_text(spans)
        .size(14)
        .on_link_click(Msg::OpenLink)
        .into()
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
pub(super) fn home(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let header = row![
        column![
            text("Início").size(25).font(bold()),
            text(format!("{} · Seu grupo, por perto", app.profile.name))
                .size(13)
                .color(m.muted)
        ]
        .spacing(4),
        space::horizontal(),
        app.action("Entrar por convite", Msg::JoinDialog, false),
        app.action("Criar servidor", Msg::NewServer, true)
    ]
    .spacing(8)
    .align_y(iced::Center);
    let mut servers = column![
        row![
            section("Servidores", m),
            space::horizontal(),
            text(format!("{} salvos", app.communities.len()))
                .size(12)
                .color(m.muted)
        ]
        .align_y(iced::Center)
    ]
    .spacing(10);
    for server in &app.communities {
        let connected = app
            .remote
            .snapshot
            .as_ref()
            .is_some_and(|s| s.server.id == server.id);
        let detail = if connected {
            format!(
                "{} participantes · conectado",
                app.remote.snapshot.as_ref().unwrap().members.len()
            )
        } else {
            "Salvo neste dispositivo".into()
        };
        let reconnect: Element<'_, Msg> = if !connected && server.owner != app.profile.id {
            column![
                app.action("Reconectar", Msg::Reconnect(server.id), false),
                app.action("Remover salvo", Msg::ForgetRecent(server.id), false)
            ]
            .spacing(4)
            .into()
        } else {
            space::horizontal().width(0).into()
        };
        servers = servers.push(
            row![
                button(
                    row![
                        avatar(&server.name, m, 36),
                        column![
                            text(&server.name).size(15).font(bold()),
                            text(detail).size(12).color(m.muted)
                        ]
                        .spacing(4),
                        space::horizontal(),
                        text(if connected { "●" } else { "›" })
                            .size(17)
                            .color(if connected {
                                design::rgb(0x9ec9b1)
                            } else {
                                m.muted
                            })
                    ]
                    .spacing(12)
                    .align_y(iced::Center)
                )
                .padding(10)
                .width(Fill)
                .style(m.button(false))
                .on_press(Msg::Server(server.id)),
                reconnect
            ]
            .spacing(8)
            .align_y(iced::Center),
        );
    }
    if app.communities.is_empty() {
        servers = servers.push(
            container(
                column![
                    text("Nenhum servidor salvo").size(16),
                    text("Crie um servidor ou use o convite do seu grupo.")
                        .size(13)
                        .color(m.muted),
                    app.action("Entrar por convite", Msg::JoinDialog, false)
                ]
                .spacing(10),
            )
            .padding(18)
            .style(move |_| m.glass(false)),
        );
    }
    let mut calls = column![section("Chamadas disponíveis", m)].spacing(10);
    if let Some(snapshot) = &app.remote.snapshot {
        for channel in snapshot
            .channels
            .iter()
            .filter(|c| c.kind == ChannelKind::Voice)
        {
            let participants: Vec<_> = snapshot
                .members
                .iter()
                .filter(|p| p.voice == Some(channel.id))
                .collect();
            let mut people = row![].spacing(5);
            for person in participants.iter().take(5) {
                people = people.push(avatar(&person.name, m, 25));
            }
            calls = calls.push(
                container(
                    row![
                        widget::canvas(art::Icon(art::NavIcon::Conversation, m.accent))
                            .width(22)
                            .height(22),
                        column![
                            text(&channel.name).font(bold()).size(14),
                            text(format!("{} na chamada", participants.len()))
                                .size(12)
                                .color(m.muted)
                        ]
                        .spacing(4),
                        people,
                        space::horizontal(),
                        app.action(
                            if app.remote.voice == Some(channel.id) {
                                "Sair"
                            } else {
                                "Entrar"
                            },
                            if app.remote.voice == Some(channel.id) {
                                Msg::LeaveVoice
                            } else {
                                Msg::Channel(channel.id)
                            },
                            false
                        )
                    ]
                    .spacing(12)
                    .align_y(iced::Center),
                )
                .padding(12)
                .style(move |_| m.glass(true)),
            );
        }
    } else {
        calls = calls.push(
            text("Conecte um servidor para ver as chamadas do grupo.")
                .size(13)
                .color(m.muted),
        );
    }
    let mut activity = column![section("Atividade recente", m)].spacing(12);
    if let Some(snapshot) = &app.remote.snapshot {
        for message in snapshot.messages.iter().rev().take(3) {
            activity = activity.push(
                row![
                    avatar(&message.name, m, 28),
                    column![
                        text(&message.name).size(12).font(bold()),
                        text(&message.text).size(13).color(m.muted)
                    ]
                    .spacing(3)
                ]
                .spacing(9),
            );
        }
    }
    if app
        .remote
        .snapshot
        .as_ref()
        .is_none_or(|s| s.messages.is_empty())
    {
        activity = activity.push(
            text("As últimas mensagens do servidor conectado aparecem aqui.")
                .size(13)
                .color(m.muted),
        );
    }
    let mut notifications = column![section("Notificações neste servidor", m)].spacing(8);
    if let Some(snapshot) = &app.remote.snapshot {
        for note in snapshot.notifications.iter().take(20) {
            let name = snapshot
                .members
                .iter()
                .find(|member| member.id == note.sender)
                .map(|member| member.name.clone())
                .unwrap_or_else(|| note.sender.to_string());
            let kind = match note.kind.as_str() {
                "reply" => "Respondeu à sua mensagem",
                "mention" => "Mencionou você",
                "direct" => "Mensagem privada",
                "friend-request" => "Solicitação de amizade",
                "friend-accepted" => "Amizade aceita",
                _ => "Atividade",
            };
            notifications = notifications.push(
                app.action(
                    &format!("{} {} · {}", if note.read { "✓" } else { "●" }, kind, name),
                    Msg::NotificationOpen(note.id),
                    !note.read,
                )
                .width(Fill),
            );
        }
        if snapshot.notifications.is_empty() {
            notifications =
                notifications.push(text("Nenhuma notificação.").size(12).color(m.muted));
        }
    }
    let main = column![
        servers,
        calls,
        rule::horizontal(1),
        activity,
        rule::horizontal(1),
        notifications
    ]
    .spacing(20)
    .padding(iced::Padding {
        right: 14.,
        ..Default::default()
    })
    .width(Fill);
    let friends = friends(app);
    column![
        header,
        rule::horizontal(1),
        row![
            scrollable(main)
                .width(Fill)
                .height(Fill)
                .direction(design::vertical_scrollbar())
                .style(m.scroll()),
            container(
                scrollable(friends)
                    .width(Fill)
                    .height(Fill)
                    .direction(design::vertical_scrollbar())
                    .style(m.scroll())
            )
            .width(282)
            .padding(18)
            .height(Fill)
            .style(move |_| m.glass(false))
        ]
        .spacing(22)
        .height(Fill)
    ]
    .spacing(22)
    .padding([22, 26])
    .into()
}
fn friends(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let add = tooltip(
        button(
            container(text("+").size(20))
                .width(32)
                .height(32)
                .align_x(iced::Center)
                .align_y(iced::Center),
        )
        .padding(0)
        .style(m.button(false))
        .on_press(Msg::FriendRequest),
        "Enviar solicitação",
        tooltip::Position::Top,
    );
    let mut list = column![
        row![
            text("Amigos").size(16).font(bold()),
            space::horizontal(),
            text("neste servidor").size(11).color(m.muted)
        ]
        .align_y(iced::Center),
        row![
            text_input("ID do perfil", &app.friend_id)
                .on_input(Msg::FriendId)
                .on_submit(Msg::FriendRequest)
                .padding(9)
                .size(12)
                .width(Fill)
                .style(m.input()),
            add
        ]
        .spacing(6)
    ]
    .spacing(12);
    let mut count = 0;
    if let Some(snapshot) = &app.remote.snapshot {
        for friend in &snapshot.friends {
            let outgoing = friend.requester == app.profile.id;
            let peer = if outgoing {
                friend.recipient
            } else {
                friend.requester
            };
            let name = if outgoing {
                &friend.recipient_name
            } else {
                &friend.requester_name
            };
            let online = snapshot.members.iter().any(|member| member.id == peer);
            let status = if friend.accepted {
                if online {
                    "Online"
                } else {
                    "Offline neste servidor"
                }
            } else if outgoing {
                "Solicitação enviada"
            } else {
                "Solicitação recebida"
            };
            let unread = snapshot
                .direct
                .iter()
                .filter(|message| {
                    message.from == peer
                        && message.to == app.profile.id
                        && message.read_at.is_none()
                })
                .count();
            let mut line = row![
                avatar(name, m, 32),
                column![
                    text(name).size(13).font(bold()),
                    text(if unread > 0 {
                        format!("{status} · {unread} não lidas recentes")
                    } else {
                        status.into()
                    })
                    .size(11)
                    .color(m.muted)
                ]
                .spacing(3)
                .width(Fill)
            ]
            .spacing(9)
            .align_y(iced::Center);
            if friend.accepted {
                line = line.push(tooltip(
                    button(
                        container(
                            widget::canvas(art::Icon(art::NavIcon::Conversation, m.muted))
                                .width(16)
                                .height(16),
                        )
                        .width(26)
                        .height(28)
                        .align_x(iced::Center)
                        .align_y(iced::Center),
                    )
                    .padding(0)
                    .style(m.navigation(false))
                    .on_press(Msg::Direct(peer)),
                    "Mensagem privada",
                    tooltip::Position::Top,
                ));
                line = line.push(tooltip(
                    button(
                        container(text("×").size(15))
                            .width(24)
                            .height(28)
                            .align_x(iced::Center)
                            .align_y(iced::Center),
                    )
                    .padding(0)
                    .style(m.navigation(false))
                    .on_press(Msg::FriendRemove(peer)),
                    "Remover amizade",
                    tooltip::Position::Top,
                ));
            }
            let mut entry = column![line].spacing(8);
            if !friend.accepted && !outgoing {
                entry = entry.push(
                    row![
                        app.action("Aceitar", Msg::FriendRespond(peer, true), true),
                        app.action("Recusar", Msg::FriendRespond(peer, false), false)
                    ]
                    .spacing(6),
                );
            }
            list = list.push(rule::horizontal(1)).push(entry);
            count += 1;
        }
    }
    if count == 0 {
        list = list.push(
            text("Adicione alguém que já entrou neste servidor pelo ID de perfil.")
                .size(12)
                .color(m.muted),
        );
    }
    list.push(rule::horizontal(1))
        .push(text("Prévias 3D nativas").size(13).font(bold()))
        .push(
            text("Sem multiplayer, avatar dinâmico ou interação com jogos nesta prévia.")
                .size(12)
                .color(m.muted),
        )
        .push(
            app.action("Lounge", Msg::World("lounge"), false)
                .width(Fill),
        )
        .push(
            app.action("Cinema", Msg::World("cinema"), false)
                .width(Fill),
        )
        .push(
            app.action("Rooftop", Msg::World("rooftop"), false)
                .width(Fill),
        )
        .push(
            app.action("Encerrar prévia", Msg::CloseWorld, false)
                .width(Fill),
        )
        .into()
}
pub(super) fn chat(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    if app.server.is_none() {
        return container(
            column![
                text("Conversas").size(25).font(bold()),
                text("Escolha um servidor na lateral.").color(m.muted),
                app.action("Entrar por convite", Msg::JoinDialog, true)
            ]
            .spacing(14),
        )
        .padding(28)
        .into();
    }
    let server = app.communities.iter().find(|s| Some(s.id) == app.server);
    let name = server.map(|s| s.name.as_str()).unwrap_or("Servidor");
    let owner = server.is_some_and(|s| s.owner == app.profile.id);
    let mut channels = column![
        row![avatar(name, m, 32), text(name).size(15).font(bold())]
            .spacing(10)
            .align_y(iced::Center),
        rule::horizontal(1)
    ]
    .spacing(10);
    for kind in [ChannelKind::Text, ChannelKind::Voice] {
        channels = channels.push(section(
            if kind == ChannelKind::Text {
                "Texto"
            } else {
                "Voz"
            },
            m,
        ));
        for channel in app.channels.iter().filter(|c| c.kind == kind) {
            let label = format!(
                "{}  {}",
                if kind == ChannelKind::Text {
                    "#"
                } else {
                    "◉"
                },
                channel.name
            );
            channels = channels.push(
                app.action(
                    &label,
                    Msg::Channel(channel.id),
                    Some(channel.id) == app.channel || app.remote.voice == Some(channel.id),
                )
                .width(Fill)
                .style(m.navigation(
                    Some(channel.id) == app.channel || app.remote.voice == Some(channel.id),
                )),
            );
            if let Some(snapshot) = &app.remote.snapshot {
                for member in snapshot
                    .members
                    .iter()
                    .filter(|p| p.voice == Some(channel.id))
                {
                    let (speaking, tags) = app.member_tags(member);
                    channels = channels.push(
                        row![
                            space::horizontal().width(18),
                            text(if speaking { "●" } else { "○" })
                                .size(10)
                                .color(if speaking {
                                    design::rgb(0x9ec9b1)
                                } else {
                                    m.muted
                                }),
                            avatar(&member.name, m, 21),
                            column![
                                text(&member.name).size(12).color(if speaking {
                                    m.ink
                                } else {
                                    m.muted
                                }),
                                text(tags).size(10).color(m.muted),
                            ]
                            .spacing(1),
                            space::horizontal(),
                            if (member.screen || member.camera)
                                && member.id != app.profile.id
                                && app.remote.voice == member.voice
                            {
                                let watching =
                                    app.watching(member.id, false) || app.watching(member.id, true);
                                Element::from(app.action(
                                    if watching { "Assistindo" } else { "Assistir" },
                                    Msg::Watch(member.id, !watching),
                                    watching,
                                ))
                            } else {
                                Element::from(space::horizontal().width(0))
                            }
                        ]
                        .spacing(7)
                        .align_y(iced::Center),
                    );
                }
            }
        }
    }
    let mut channels = column![
        scrollable(channels)
            .height(Fill)
            .width(Fill)
            .direction(design::vertical_scrollbar())
            .style(m.scroll())
    ]
    .spacing(8);
    if owner {
        channels = channels.push(
            app.action("Gerenciar servidor", Msg::ManageServer, false)
                .width(Fill),
        );
    }
    channels = channels.push(
        app.action(
            if app.is_remote() {
                "Desconectar"
            } else {
                "Hospedar servidor"
            },
            if app.is_remote() {
                Msg::Disconnect
            } else {
                Msg::HostRemote
            },
            false,
        )
        .width(Fill),
    );
    if app.remote.invite.is_some() && app.is_remote() {
        channels = channels.push(
            app.action("Copiar convite", Msg::CopyInvite, false)
                .width(Fill),
        );
    }
    if app.is_remote() {
        channels = channels.push(
            app.action("Copiar diagnóstico", Msg::CopyDiagnostics, false)
                .width(Fill),
        );
    }
    let channel_name = app
        .channels
        .iter()
        .find(|c| Some(c.id) == app.channel)
        .map(|c| c.name.as_str())
        .unwrap_or("conversa");
    let header = column![
        row![
            text(format!("# {channel_name}")).size(16).font(bold()),
            text(if app.is_remote() {
                "Conectado"
            } else {
                "Local"
            })
            .size(11)
            .color(m.muted),
            space::horizontal()
        ]
        .spacing(12)
        .align_y(iced::Center),
        row![
            text_input("Buscar neste histórico", &app.search)
                .on_input(Msg::Search)
                .on_submit(Msg::SearchRemote)
                .padding(8)
                .size(12)
                .width(Fill)
                .style(m.input()),
            app.action("Buscar", Msg::SearchRemote, false),
            app.action("Anteriores", Msg::OlderMessages, false)
        ]
        .spacing(6)
        .align_y(iced::Center)
    ]
    .spacing(8);
    let mut history = column![].spacing(16);
    for message in app.messages.iter().filter(|message| {
        app.search.is_empty()
            || message
                .text
                .to_lowercase()
                .contains(&app.search.to_lowercase())
    }) {
        let time = platform::time_label(message.time);
        let actions: Element<'_, Msg> =
            if app.message_hover == Some(message.id) || app.message_menu == Some(message.id) {
                tooltip(
                    button(
                        container(text("···").size(14))
                            .width(26)
                            .height(24)
                            .align_x(iced::Center)
                            .align_y(iced::Center),
                    )
                    .padding(0)
                    .style(m.navigation(false))
                    .on_press(Msg::MessageMenu(message.id)),
                    "Ações da mensagem",
                    tooltip::Position::Top,
                )
                .into()
            } else {
                space::horizontal().width(26).height(24).into()
            };
        let mut content = column![
            row![
                text(&message.name).size(13).font(bold()),
                text(time).size(11).color(m.muted),
                text(if server.is_some_and(|s| s.owner == message.author) {
                    "Dono"
                } else {
                    ""
                })
                .size(10)
                .color(m.secondary),
                space::horizontal(),
                actions
            ]
            .spacing(8)
            .align_y(iced::Center),
            message_text(&message.text, m)
        ]
        .spacing(4)
        .width(Fill);
        if let Some(target) = message.reply_to {
            let preview = app
                .messages
                .iter()
                .find(|m| m.id == target)
                .map(|m| {
                    format!(
                        "↳ {}: {}",
                        m.name,
                        m.text.chars().take(100).collect::<String>()
                    )
                })
                .unwrap_or_else(|| "↳ Resposta a mensagem anterior".into());
            content = content.push(text(preview).size(11).color(m.muted));
        }
        if !message.reactions.is_empty() {
            let mut reactions = row![].spacing(4);
            for (emoji, actors) in &message.reactions {
                reactions = reactions.push(app.action(
                    &format!("{} {}", emoji, actors.len()),
                    Msg::ReactMessage(message.id, emoji.clone()),
                    actors.contains(&app.profile.id),
                ));
            }
            content = content.push(reactions);
        }
        for attachment in &message.attachments {
            content = content.push(app.action(
                &format!(
                    "Abrir imagem · {} · {}×{}",
                    attachment.name, attachment.width, attachment.height
                ),
                Msg::OpenImage(attachment.clone()),
                false,
            ));
        }
        if app.message_menu == Some(message.id) {
            let mut menu = row![
                app.action("Responder", Msg::ReplyMessage(message.id), false),
                app.action("👍", Msg::ReactMessage(message.id, "👍".into()), false),
                app.action("❤️", Msg::ReactMessage(message.id, "❤️".into()), false)
            ]
            .spacing(6);
            if message.author == app.profile.id {
                menu = menu
                    .push(app.action("Editar", Msg::EditMessage(message.id), false))
                    .push(app.action("Excluir", Msg::Delete(message.id), false));
            } else {
                menu = menu.push(
                    text("Somente o autor pode editar esta mensagem.")
                        .size(11)
                        .color(m.muted),
                );
            }
            content = content.push(menu);
        }
        history = history.push(
            mouse_area(row![avatar(&message.name, m, 32), content].spacing(10))
                .on_enter(Msg::MessageHover(Some(message.id)))
                .on_exit(Msg::MessageHover(None))
                .on_right_press(Msg::MessageMenu(message.id)),
        );
    }
    if app.messages.is_empty() {
        history = history.push(
            text("Nenhuma mensagem neste canal.")
                .size(13)
                .color(m.muted),
        );
    }
    let mut composer = column![].spacing(6);
    if app.is_remote() {
        composer = composer.push(image_actions(app));
    }
    if app.editing_message.is_some() || app.replying_message.is_some() {
        composer = composer.push(row![
            text(if app.editing_message.is_some() {
                "Editando mensagem"
            } else {
                "Respondendo mensagem"
            })
            .size(12)
            .color(m.secondary),
            space::horizontal(),
            app.action("Cancelar", Msg::CancelEdit, false)
        ]);
    }
    composer = composer.push(
        row![
            text_input(
                if app.editing_message.is_some() {
                    "Editar mensagem"
                } else {
                    "Mensagem"
                },
                &app.draft
            )
            .on_input(Msg::Draft)
            .on_submit(Msg::Send)
            .padding(12)
            .size(14)
            .style(m.input()),
            app.action(
                if app.pending_message.is_some() {
                    "Reenviar"
                } else {
                    "Enviar"
                },
                Msg::Send,
                true
            )
        ]
        .spacing(8)
        .align_y(iced::Center),
    );
    let body = column![
        header,
        rule::horizontal(1),
        scrollable(history.padding(iced::Padding {
            top: 8.,
            bottom: 8.,
            left: 0.,
            right: 14.
        }))
        .height(Fill)
        .width(Fill)
        .direction(design::vertical_scrollbar())
        .style(m.scroll()),
        composer
    ]
    .spacing(14)
    .padding([18, 22])
    .width(Fill);
    let mut people = column![section("Participantes", m)].spacing(15);
    if let Some(snapshot) = app
        .remote
        .snapshot
        .as_ref()
        .filter(|s| Some(s.server.id) == app.server)
    {
        for person in &snapshot.members {
            people = people.push(
                row![
                    avatar(&person.name, m, 28),
                    column![
                        text(&person.name).size(12).font(bold()),
                        text(if person.voice.is_some() {
                            if person.deafened {
                                "Áudio desativado"
                            } else if person.muted {
                                "Microfone mudo"
                            } else {
                                "Em chamada"
                            }
                        } else {
                            "Online"
                        })
                        .size(10)
                        .color(m.muted)
                    ]
                    .spacing(3)
                ]
                .spacing(9)
                .align_y(iced::Center),
            );
            if let Some(profile) = snapshot.profiles.iter().find(|p| p.id == person.id) {
                people = people.push(
                    text(match profile.presence {
                        voxy_core::room::Presence::Online => "Online",
                        voxy_core::room::Presence::Away => "Ausente",
                        voxy_core::room::Presence::Busy => "Ocupado",
                    })
                    .size(10)
                    .color(m.muted),
                );
            }
            for assignment in snapshot
                .member_roles
                .iter()
                .filter(|r| r.member == person.id)
            {
                if let Some(role) = snapshot.roles.iter().find(|r| r.id == assignment.role) {
                    people = people.push(text(&role.name).size(10).color(m.secondary));
                }
            }
            people = people.push(app.action("Mencionar", Msg::Mention(person.id), false));
            if person.id != app.profile.id
                && let Some(peer) = app.remote.peers.iter().find(|p| p.key == person.public_key)
            {
                let id = peer.id;
                people = people.push(
                    column![
                        row![
                            text("Volume").size(10).color(m.muted),
                            space::horizontal(),
                            text(format!("{}%", (peer.volume * 100.) as i32))
                                .size(10)
                                .color(m.muted)
                        ],
                        slider(0.0..=2.0, peer.volume, move |volume| Msg::PeerVolume(
                            id, volume
                        ))
                        .step(0.05_f32)
                        .style(m.slider())
                    ]
                    .spacing(5),
                );
            }
        }
    } else {
        people = people.push(
            row![
                avatar(&app.profile.name, m, 28),
                text(&app.profile.name).size(12)
            ]
            .spacing(8),
        );
    }
    row![
        container(channels)
            .width(210)
            .height(Fill)
            .padding(14)
            .style(move |_| m.glass(false)),
        body,
        container(
            scrollable(people)
                .height(Fill)
                .width(Fill)
                .direction(design::vertical_scrollbar())
                .style(m.scroll())
        )
        .width(172)
        .padding([22, 12])
        .height(Fill)
        .style(move |_| container::Style {
            background: Some(alpha(m.panel, 0.35).into()),
            ..Default::default()
        })
    ]
    .height(Fill)
    .into()
}
pub(super) fn direct(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let peer = app.direct_peer;
    let friend = app.remote.snapshot.as_ref().and_then(|s| {
        s.friends
            .iter()
            .find(|f| Some(f.requester) == peer || Some(f.recipient) == peer)
    });
    let name = friend
        .map(|f| {
            if f.requester == app.profile.id {
                f.recipient_name.as_str()
            } else {
                f.requester_name.as_str()
            }
        })
        .unwrap_or("Mensagem privada");
    let mut history = column![].spacing(16);
    if app.remote.snapshot.is_some() {
        for message in app
            .direct_entries()
            .iter()
            .filter(|d| Some(d.from) == peer || Some(d.to) == peer)
        {
            let author = if message.from == app.profile.id {
                app.profile.name.as_str()
            } else {
                name
            };
            let mut body = column![
                text(author).font(bold()).size(12),
                message_text(&message.text, m)
            ]
            .spacing(5);
            let mut actions = row![
                text(platform::time_label(message.time))
                    .size(10)
                    .color(m.muted)
            ]
            .spacing(6);
            if message.from == app.profile.id {
                actions = actions
                    .push(
                        text(if message.read_at.is_some() {
                            "Lida"
                        } else {
                            "Enviada"
                        })
                        .size(10)
                        .color(m.muted),
                    )
                    .push(app.action("Editar", Msg::DirectEdit(message.id), false))
                    .push(app.action("Excluir", Msg::DirectDelete(message.id), false));
            }
            if message.edited_at.is_some() {
                actions = actions.push(text("editada").size(10).color(m.muted));
            }
            body = body.push(actions);
            for attachment in &message.attachments {
                body = body.push(app.action(
                    &format!(
                        "Abrir imagem · {} · {}×{}",
                        attachment.name, attachment.width, attachment.height
                    ),
                    Msg::OpenImage(attachment.clone()),
                    false,
                ));
            }
            history = history.push(row![avatar(author, m, 30), body].spacing(10));
        }
    }
    column![
        row![
            avatar(name, m, 34),
            column![
                text(name).font(bold()).size(18),
                text("Conversa privada neste servidor · histórico mantido pelo host")
                    .size(12)
                    .color(m.muted)
            ]
            .spacing(4),
            space::horizontal(),
            app.action("Marcar lidas", Msg::DirectReadAll, false),
            app.action("Voltar", Msg::Navigate(Page::Home), false)
        ]
        .spacing(12)
        .align_y(iced::Center),
        rule::horizontal(1),
        row![
            app.action(
                if app.direct_request.is_some() {
                    "Carregando…"
                } else {
                    "Mensagens anteriores"
                },
                Msg::DirectOlder,
                false
            ),
            app.action("Mensagens recentes", Msg::DirectLatest, false)
        ]
        .spacing(8),
        scrollable(history)
            .height(Fill)
            .direction(design::vertical_scrollbar())
            .style(m.scroll()),
        image_actions(app),
        row![
            text_input(
                if app.editing_message.is_some() {
                    "Editar mensagem privada"
                } else {
                    "Mensagem privada"
                },
                &app.draft
            )
            .on_input(Msg::Draft)
            .on_submit(Msg::DirectSend)
            .padding(12)
            .style(m.input()),
            app.action(
                if app.editing_message.is_some() {
                    "Salvar edição"
                } else if app.pending_message.is_some() {
                    "Reenviar"
                } else {
                    "Enviar"
                },
                Msg::DirectSend,
                true
            ),
            app.action("Cancelar", Msg::CancelEdit, false)
        ]
        .spacing(8)
    ]
    .spacing(18)
    .padding(26)
    .into()
}
fn image_actions(app: &App) -> Element<'_, Msg> {
    if app.image_transfer.is_some() {
        row![
            text("Transferindo imagem…").size(12),
            space::horizontal(),
            app.action("Cancelar transferência", Msg::CancelImage, false)
        ]
        .spacing(8)
        .align_y(iced::Center)
        .into()
    } else {
        row![
            app.action("Enviar imagem", Msg::PickImage, false),
            text("PNG/JPEG · até 3 MiB")
                .size(11)
                .color(app.palette().muted)
        ]
        .spacing(8)
        .align_y(iced::Center)
        .into()
    }
}
pub(super) fn settings(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut nav = column![
        text("Configurações").font(bold()).size(17),
        space::vertical().height(8)
    ]
    .spacing(7);
    for (label, section) in [
        ("Perfil", Section::Profile),
        ("Windows", Section::Windows),
        ("Áudio e voz", Section::Audio),
        ("Aparência", Section::Appearance),
        ("Rede e privacidade", Section::Privacy),
    ] {
        nav = nav.push(
            app.action(label, Msg::Section(section), app.section == section)
                .width(Fill),
        );
    }
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
        Section::Privacy=>column![text("Rede e privacidade").size(22).font(bold()),section("Sinalização do host",m),text_input("wss://seu-subdomínio",&app.endpoint).on_input(Msg::EndpointText).padding(10).style(m.input()),section("STUN (separar por vírgula)",m),text_input("stun:servidor:3478",&app.stun_text).on_input(Msg::StunText).padding(10).style(m.input()),text("O convite informa a sinalização aos convidados. Nenhum IP manual é necessário para entrar.").size(12).color(m.muted),rule::horizontal(1),text("P2P compartilha endereços de rede com os participantes. O host armazena as mensagens e consegue ler seu conteúdo.").size(13),text("TURN bloqueado: não há limite financeiro rígido homologado. Redes que exigem retransmissão ainda podem falhar.").size(13).color(m.muted),text("Dados da 1.4.1 permanecem separados. Nenhum plano pago é ativado pelo aplicativo.").size(12).color(m.muted)].spacing(15).into(),
    };
    row![
        container(nav)
            .width(205)
            .padding(18)
            .height(Fill)
            .style(move |_| m.glass(false)),
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
    ]
    .height(Fill)
    .into()
}
pub(super) fn admin(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut roles = column![section("Cargos neste servidor", m)].spacing(8);
    if app.is_remote() {
        roles = roles.push(
            row![
                text_input("Nome do cargo", &app.role_name)
                    .on_input(Msg::RoleName)
                    .padding(8)
                    .style(m.input()),
                text_input("#RRGGBB", &app.role_color)
                    .on_input(Msg::RoleColor)
                    .padding(8)
                    .width(120)
                    .style(m.input()),
                app.action("Salvar cargo", Msg::RoleSave, false)
            ]
            .spacing(6),
        );
        if let Some(snapshot) = &app.remote.snapshot {
            for role in &snapshot.roles {
                roles = roles.push(
                    row![
                        text(&role.name).size(13),
                        text(&role.color).size(11),
                        space::horizontal(),
                        app.action("Editar", Msg::RoleEdit(role.id), false),
                        app.action("Excluir", Msg::RoleDelete(role.id), false)
                    ]
                    .spacing(6),
                );
                if app.editing_role == Some(role.id) {
                    for member in &snapshot.members {
                        let assigned = snapshot
                            .member_roles
                            .iter()
                            .any(|r| r.role == role.id && r.member == member.id);
                        roles = roles.push(
                            row![
                                text(&member.name).size(12),
                                space::horizontal(),
                                app.action(
                                    if assigned {
                                        "Remover cargo"
                                    } else {
                                        "Atribuir cargo"
                                    },
                                    Msg::RoleAssign(role.id, member.id, !assigned),
                                    assigned
                                )
                            ]
                            .spacing(6),
                        );
                    }
                }
            }
        }
    } else {
        roles = roles.push(
            text("Hospede o servidor para gerenciar cargos e membros autenticados.")
                .size(12)
                .color(m.muted),
        );
    }
    let mut channels = column![text("Canais").font(bold()).size(16)].spacing(9);
    for channel in &app.channels {
        channels = channels.push(
            row![
                text(if channel.kind == ChannelKind::Text {
                    "#"
                } else {
                    "◉"
                })
                .color(m.muted),
                text(&channel.name).size(13),
                space::horizontal(),
                app.action("Renomear", Msg::AdminChannelEdit(channel.id), false),
                app.action("Excluir canal", Msg::AdminRemove(channel.id), false)
            ]
            .spacing(10)
            .align_y(iced::Center),
        );
        if app.editing_channel == Some(channel.id) {
            channels = channels.push(
                row![
                    text_input("Nome do canal", &app.channel_name)
                        .on_input(Msg::AdminChannelName)
                        .on_submit(Msg::AdminChannelSave)
                        .padding(9)
                        .style(m.input()),
                    app.action("Salvar nome", Msg::AdminChannelSave, true)
                ]
                .spacing(8),
            );
        }
    }
    scrollable(
        column![
            row![
                text("Gerenciar servidor").font(bold()).size(22),
                space::horizontal(),
                app.action("Voltar ao chat", Msg::Navigate(Page::Chat), false)
            ]
            .align_y(iced::Center),
            rule::horizontal(1),
            section("Informações gerais", m),
            row![
                text_input("Nome do servidor", &app.server_name)
                    .on_input(Msg::ServerName)
                    .padding(10)
                    .width(350)
                    .style(m.input()),
                app.action("Renomear", Msg::AdminRename, true)
            ]
            .spacing(10),
            channels,
            roles,
            row![
                app.action(
                    "Adicionar texto",
                    Msg::AdminCreate(ChannelKind::Text),
                    false
                ),
                app.action("Adicionar voz", Msg::AdminCreate(ChannelKind::Voice), false)
            ]
            .spacing(8),
            rule::horizontal(1),
            section("Convites", m),
            row![
                app.action(
                    if app.is_remote() {
                        "Copiar convite"
                    } else {
                        "Hospedar servidor"
                    },
                    if app.is_remote() {
                        Msg::CopyInvite
                    } else {
                        Msg::HostRemote
                    },
                    false
                ),
                app.action("Rede e privacidade", Msg::Section(Section::Privacy), false),
                app.action("Revogar e gerar novo", Msg::RotateInvite, false)
            ]
            .spacing(8),
            text("Excluir remove canais e mensagens deste servidor local. Desconecte antes.")
                .size(12)
                .color(m.muted),
            app.action("Excluir servidor local", Msg::AdminDelete, false)
        ]
        .spacing(18)
        .padding(26),
    )
    .height(Fill)
    .width(Fill)
    .direction(design::vertical_scrollbar())
    .style(m.scroll())
    .into()
}
