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
    for server in app.communities.iter().take(3) {
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
            app.action("Reconectar", Msg::Reconnect(server.id), false)
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
    let main = column![servers, calls, rule::horizontal(1), activity]
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
            let mut line = row![
                avatar(name, m, 32),
                column![
                    text(name).size(13).font(bold()),
                    text(status).size(11).color(m.muted)
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
        .push(text("Salas 3D").size(13).font(bold()))
        .push(
            text("Indisponíveis nesta versão nativa.")
                .size(12)
                .color(m.muted),
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
                    channels = channels.push(
                        row![
                            space::horizontal().width(18),
                            avatar(&member.name, m, 21),
                            text(&member.name).size(12).color(m.muted),
                            text(if member.deafened {
                                "◌"
                            } else if member.muted {
                                "−"
                            } else {
                                ""
                            })
                            .size(11)
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
    let channel_name = app
        .channels
        .iter()
        .find(|c| Some(c.id) == app.channel)
        .map(|c| c.name.as_str())
        .unwrap_or("conversa");
    let header = row![
        text(format!("# {channel_name}")).size(16).font(bold()),
        text(if app.is_remote() {
            "Conectado"
        } else {
            "Local"
        })
        .size(11)
        .color(m.muted),
        space::horizontal(),
        text_input("Buscar neste histórico", &app.search)
            .on_input(Msg::Search)
            .padding(8)
            .size(12)
            .width(190)
            .style(m.input())
    ]
    .spacing(12)
    .align_y(iced::Center);
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
            text(&message.text).size(14)
        ]
        .spacing(4)
        .width(Fill);
        if app.message_menu == Some(message.id) {
            let mut menu = row![].spacing(6);
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
    if app.editing_message.is_some() {
        composer = composer.push(row![
            text("Editando mensagem").size(12).color(m.secondary),
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
    if let Some(snapshot) = &app.remote.snapshot {
        for message in snapshot
            .direct
            .iter()
            .filter(|d| Some(d.from) == peer || Some(d.to) == peer)
        {
            let author = if message.from == app.profile.id {
                app.profile.name.as_str()
            } else {
                name
            };
            history = history.push(
                row![
                    avatar(author, m, 30),
                    column![
                        text(author).font(bold()).size(12),
                        text(&message.text).size(14)
                    ]
                    .spacing(5)
                ]
                .spacing(10),
            );
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
            app.action("Voltar", Msg::Navigate(Page::Home), false)
        ]
        .spacing(12)
        .align_y(iced::Center),
        rule::horizontal(1),
        scrollable(history)
            .height(Fill)
            .direction(design::vertical_scrollbar())
            .style(m.scroll()),
        row![
            text_input("Mensagem privada", &app.draft)
                .on_input(Msg::Draft)
                .on_submit(Msg::DirectSend)
                .padding(12)
                .style(m.input()),
            app.action("Enviar", Msg::DirectSend, true)
        ]
        .spacing(8)
    ]
    .spacing(18)
    .padding(26)
    .into()
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
        Section::Profile=>column![text("Perfil").size(22).font(bold()),row![avatar(&app.editing.name,m,60),column![text("Nome de exibição").size(12).color(m.muted),text_input("Seu nome",&app.editing.name).on_input(Msg::Name).padding(10).style(m.input()).width(300)].spacing(6)].spacing(18).align_y(iced::Center),rule::horizontal(1),text("ID do perfil").size(12).color(m.muted),text(app.profile.id.to_string()).size(13),text("Use este ID para adicionar amigos no servidor conectado.").size(12).color(m.muted)].spacing(16).into(),
        Section::Appearance=>{
            let mut themes=row![].spacing(8);
            for (name,theme) in [("Voxy",ProfileTheme::Voxy),("Oceano",ProfileTheme::Ocean),("Bosque",ProfileTheme::Forest),("Kuromi",ProfileTheme::Kuromi)]{let palette=Materials::new(theme);themes=themes.push(button(container(column![text("V").size(24).font(bold()).color(palette.accent),text(name).size(12).color(palette.ink)].spacing(14)).padding(15).width(Fill).style(move |_|palette.glass(true))).width(Fill).style(m.navigation(app.editing.theme==theme)).on_press(Msg::Theme(theme)));}
            column![text("Aparência").size(22).font(bold()),text("Tema").size(13).color(m.muted),themes,rule::horizontal(1),row![row_label("Reduzir efeitos visuais","Materiais opacos e sem composição Acrylic.",m),space::horizontal(),toggler(app.editing.low_resource_mode).on_toggle(Msg::Low).style(m.toggle())].align_y(iced::Center)].spacing(20).into()
        },
        Section::Audio=>{
            let inputs:Vec<String>=std::iter::once("Padrão do Windows".into()).chain(app.devices.iter().filter(|d|d.input).map(|d|d.name.clone())).collect();
            let outputs:Vec<String>=std::iter::once("Padrão do Windows".into()).chain(app.devices.iter().filter(|d|!d.input).map(|d|d.name.clone())).collect();
            let input=app.devices.iter().find(|d|d.id==app.editing.input).map(|d|d.name.clone()).unwrap_or_else(||"Padrão do Windows".into());let output=app.devices.iter().find(|d|d.id==app.editing.output).map(|d|d.name.clone()).unwrap_or_else(||"Padrão do Windows".into());let ins=app.devices.clone();let outs=app.devices.clone();
            column![row![text("Áudio e voz").size(22).font(bold()),space::horizontal(),app.action("Atualizar",Msg::Refresh,false)],row![column![section("Microfone",m),pick_list(inputs,Some(input),move|name|Msg::Input(ins.iter().find(|d|d.input&&d.name==name).map(|d|d.id.clone()).unwrap_or_default())).padding(10).width(Fill).style(m.select()).menu_style(m.menu())].spacing(7).width(Fill),column![section("Saída",m),pick_list(outputs,Some(output),move|name|Msg::Output(outs.iter().find(|d|!d.input&&d.name==name).map(|d|d.id.clone()).unwrap_or_default())).padding(10).width(Fill).style(m.select()).menu_style(m.menu())].spacing(7).width(Fill)].spacing(16),rule::horizontal(1),row![text("Volume do microfone").size(14),space::horizontal(),text(format!("{}%",(app.editing.input_volume*100.)as i32)).size(12).color(m.muted)],slider(0.0..=2.0,app.editing.input_volume,Msg::Gain).step(0.01_f32).style(m.slider()),row![app.action(if app.mic_test.is_some(){"Encerrar teste"}else{"Teste privado"},Msg::Test,false),widget::progress_bar(0.0..=0.4,app.control.level()).length(Fill).style(move |_|widget::progress_bar::Style{background:alpha(m.ink,0.06).into(),bar:m.accent.into(),border:Border{radius:3.0.into(),..Default::default()}})].spacing(16).align_y(iced::Center),text("Use fones no teste privado. O monitor local não usa cancelamento de eco.").size(12).color(m.muted),rule::horizontal(1),row![row_label("Push-to-Talk","Funciona no núcleo mesmo com a janela fechada.",m),space::horizontal(),toggler(app.editing.ptt_enabled).on_toggle(Msg::Ptt).style(m.toggle())].align_y(iced::Center),pick_list(vec!["Mouse4".into(),"Mouse5".into(),"Space".into(),"F8".into(),"F9".into()],Some(app.editing.ptt_key.clone()),Msg::PttKey).padding(9).width(190).style(m.select()).menu_style(m.menu()),text("As alterações de dispositivo e PTT entram em vigor na próxima entrada na chamada.").size(12).color(m.muted)].spacing(17).into()
        },
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
                app.action("Excluir canal", Msg::AdminRemove(channel.id), false)
            ]
            .spacing(10)
            .align_y(iced::Center),
        );
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
                app.action("Rede e privacidade", Msg::Section(Section::Privacy), false)
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
