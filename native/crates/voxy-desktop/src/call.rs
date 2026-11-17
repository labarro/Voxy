//! Dedicated call view: participants grid, live media tiles, spotlight with a
//! side strip, and the call dock. Everything shown comes from session-confirmed
//! state and real decoded frames; nothing is a placeholder image.
use super::*;
use crate::{
    design::{Tone, mix, radius, size},
    icons::Icon,
    ui::{self, Ring},
};
use iced::widget::{Space, column, responsive};

type StreamKey = (uuid::Uuid, bool);

#[derive(Clone, Copy)]
enum Item<'a> {
    Person(&'a voxy_core::room::Member),
    Stream(StreamKey),
}

/// Columns maximizing 16:9 tile area for `n` tiles inside `w`×`h`.
pub(super) fn layout(n: usize, w: f32, h: f32, gap: f32, max_tile: f32) -> (usize, f32, f32) {
    let n = n.max(1);
    let mut best = (1, 0.0, 0.0);
    for cols in 1..=n {
        let rows = n.div_ceil(cols);
        let tw = ((w - gap * (cols as f32 - 1.0)) / cols as f32).min(max_tile);
        let th_fit = (h - gap * (rows as f32 - 1.0)) / rows as f32;
        let (tw, th) = if tw * 9.0 / 16.0 > th_fit {
            (th_fit * 16.0 / 9.0, th_fit)
        } else {
            (tw, tw * 9.0 / 16.0)
        };
        if tw > best.1 {
            best = (cols, tw.max(0.0), th.max(0.0));
        }
    }
    best
}

fn member_of(app: &App, id: uuid::Uuid) -> Option<&voxy_core::room::Member> {
    app.remote
        .snapshot
        .as_ref()
        .and_then(|s| s.members.iter().find(|m| m.id == id))
}

fn person_tile<'a>(
    app: &'a App,
    member: &'a voxy_core::room::Member,
    w: f32,
    h: f32,
) -> Element<'a, Msg> {
    let m = app.palette();
    let talking = chrome::speaking(app, member);
    let local = member.id == app.profile.id;
    let avatar_px = (h * 0.38).clamp(36.0, 104.0);
    let center = container(ui::avatar(
        m,
        &member.name,
        avatar_px,
        Ring {
            speaking: talking,
            ..Default::default()
        },
    ))
    .center(Fill);
    let mut plate = row![].spacing(6).align_y(iced::Center);
    for (glyph, color, _) in app.member_icons(member) {
        plate = plate.push(ui::icon(glyph, 14.0, color));
    }
    plate = plate.push(
        text(if local {
            format!("{} (você)", member.name)
        } else {
            member.name.clone()
        })
        .size(size::SMALL)
        .font(bold()),
    );
    let plate = container(plate)
        .padding([4, 9])
        .style(move |_| container::Style {
            background: Some(alpha(Color::BLACK, 0.45).into()),
            border: Border {
                radius: radius::S.into(),
                ..Default::default()
            },
            ..Default::default()
        });
    // Media this person publishes that we are not watching yet.
    let mut offers = row![].spacing(6);
    if !local && app.remote.voice.is_some() && app.remote.voice == member.voice {
        for (camera, available, label) in [
            (false, member.screen, "Assistir tela"),
            (true, member.camera, "Assistir câmera"),
        ] {
            if available && !app.watching(member.id, camera) {
                offers = offers.push(
                    ui::action(
                        m,
                        Some(if camera {
                            Icon::Video
                        } else {
                            Icon::ScreenShare
                        }),
                        "Assistir",
                        Some(Msg::Watch(member.id, true)),
                        Tone::Primary,
                    )
                    .padding([5, 10]),
                );
                let _ = label;
            }
        }
    }
    let mut top = row![Space::new().width(Fill)].align_y(iced::Center);
    if !local {
        top = top.push(ui::icon_button(
            m,
            Icon::Ellipsis,
            &format!("Opções de {}", member.name),
            Some(Msg::TileMenu(Some(member.id))),
            Tone::Ghost,
            28.0,
        ));
    }
    let mut overlay = column![top, Space::new().height(Fill)];
    if app.tile_menu == Some(member.id) {
        overlay = overlay.push(tile_menu(app, member));
    } else {
        overlay = overlay
            .push(row![plate, Space::new().width(Fill), offers].align_y(iced::Alignment::End));
    }
    let tint = ui::person_color(&member.name);
    let body = stack![center, container(overlay).padding(10)];
    mouse_area(container(body).width(w).height(h).style(move |_| {
        container::Style {
            background: Some(iced::Background::Gradient(
                iced::gradient::Linear::new(iced::Radians(std::f32::consts::PI))
                    .add_stop(0.0, mix(m.panel, tint, 0.14))
                    .add_stop(1.0, m.panel)
                    .into(),
            )),
            border: Border {
                radius: radius::L.into(),
                width: if talking { 2.0 } else { 1.0 },
                color: if talking { m.speaking } else { m.border },
            },
            ..Default::default()
        }
    }))
    .on_right_press(Msg::TileMenu(Some(member.id)))
    .into()
}

fn tile_menu<'a>(app: &'a App, member: &'a voxy_core::room::Member) -> Element<'a, Msg> {
    let m = app.palette();
    let mut menu = column![
        row![
            text(member.name.clone())
                .size(size::SMALL)
                .font(bold())
                .width(Fill),
            ui::icon_button(
                m,
                Icon::X,
                "Fechar opções",
                Some(Msg::TileMenu(None)),
                Tone::Ghost,
                26.0
            )
        ]
        .align_y(iced::Center)
    ]
    .spacing(6);
    if let Some(peer) = app.remote.peers.iter().find(|p| p.key == member.public_key) {
        let id = peer.id;
        menu = menu.push(
            row![
                ui::icon(
                    if peer.volume == 0.0 {
                        Icon::VolumeX
                    } else {
                        Icon::Volume2
                    },
                    15.0,
                    m.muted
                ),
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
    menu = menu.push(
        row![
            ui::action(
                m,
                Some(Icon::AtSign),
                "Mencionar",
                Some(Msg::Mention(member.id)),
                Tone::Secondary
            )
            .padding([5, 10]),
            ui::action(
                m,
                Some(Icon::MessageCircle),
                "Mensagem",
                Some(Msg::Direct(member.id)),
                Tone::Secondary
            )
            .padding([5, 10]),
        ]
        .spacing(6),
    );
    container(menu)
        .padding(10)
        .style(move |_| m.floating())
        .into()
}

fn stream_tile<'a>(
    app: &'a App,
    key: StreamKey,
    w: f32,
    h: f32,
    focused: bool,
) -> Element<'a, Msg> {
    let m = app.palette();
    let (member, camera) = key;
    let name = member_of(app, member)
        .map(|x| x.name.clone())
        .unwrap_or_default();
    let talking = member_of(app, member).is_some_and(|x| chrome::speaking(app, x));
    let picture: Element<'a, Msg> = match app.streams.get(&key) {
        Some(frame) => iced::widget::image(frame.handle.clone())
            .width(Fill)
            .height(Fill)
            .content_fit(iced::ContentFit::Contain)
            .into(),
        None => container(
            column![
                ui::icon(Icon::LoaderCircle, 22.0, m.muted),
                text("Aguardando vídeo…").size(size::CAPTION).color(m.muted)
            ]
            .spacing(8)
            .align_x(iced::Center),
        )
        .center(Fill)
        .into(),
    };
    let stats = app.streams.get(&key).map(|f| {
        format!(
            "{}p{}",
            f.height,
            if f.fps > 0.0 {
                format!(" · {:.0} fps", f.fps)
            } else {
                String::new()
            }
        )
    });
    let mut info = row![
        ui::badge(
            if camera { "CÂMERA" } else { "AO VIVO" },
            Color::WHITE,
            if camera {
                alpha(Color::BLACK, 0.55)
            } else {
                m.live
            }
        ),
        text(name)
            .size(size::SMALL)
            .font(bold())
            .color(Color::WHITE)
    ]
    .spacing(8)
    .align_y(iced::Center);
    // Camera tiles stand for the person: show microphone/deafen state too.
    if camera && let Some(owner) = member_of(app, member) {
        for (glyph, color, _) in app.member_icons(owner) {
            if matches!(glyph, Icon::MicOff | Icon::HeadphoneOff | Icon::WifiOff) {
                info = info.push(ui::icon(glyph, 14.0, color));
            }
        }
    }
    if let Some(stats) = stats {
        info = info.push(ui::badge(stats, rgb_text(), alpha(Color::BLACK, 0.55)));
    }
    let controls = row![
        ui::icon_button(
            m,
            if focused {
                Icon::Minimize2
            } else {
                Icon::Maximize2
            },
            if focused {
                "Voltar à grade"
            } else {
                "Ampliar"
            },
            Some(Msg::StreamFocus(if focused { None } else { Some(key) })),
            Tone::Ghost,
            30.0
        ),
        ui::icon_button(
            m,
            Icon::PictureInPicture2,
            "Picture-in-Picture",
            Some(Msg::StreamPipOf(key)),
            Tone::Ghost,
            30.0
        ),
        ui::icon_button(
            m,
            Icon::Maximize,
            "Tela cheia",
            Some(Msg::StreamFullscreenOf(key)),
            Tone::Ghost,
            30.0
        ),
        ui::icon_button(
            m,
            Icon::EyeOff,
            "Parar de assistir",
            Some(Msg::Watch(member, false)),
            Tone::Ghost,
            30.0
        ),
    ]
    .spacing(2);
    let bar = container(row![info, Space::new().width(Fill), controls].align_y(iced::Center))
        .padding([6, 8])
        .style(|_| container::Style {
            background: Some(iced::Background::Gradient(
                iced::gradient::Linear::new(iced::Radians(0.0))
                    .add_stop(0.0, alpha(Color::BLACK, 0.7))
                    .add_stop(1.0, alpha(Color::BLACK, 0.0))
                    .into(),
            )),
            ..Default::default()
        });
    container(stack![picture, column![Space::new().height(Fill), bar]])
        .width(w)
        .height(h)
        .padding(2)
        .clip(true)
        .style(move |_| container::Style {
            background: Some(Color::BLACK.into()),
            border: Border {
                radius: radius::L.into(),
                width: if talking { 2.0 } else { 1.0 },
                color: if talking { m.speaking } else { m.border },
            },
            ..Default::default()
        })
        .into()
}
fn rgb_text() -> Color {
    Color::from_rgb8(0xe8, 0xea, 0xf0)
}

fn tile<'a>(app: &'a App, item: Item<'a>, w: f32, h: f32) -> Element<'a, Msg> {
    match item {
        Item::Person(member) => person_tile(app, member, w, h),
        Item::Stream(key) => stream_tile(app, key, w, h, false),
    }
}

fn items(app: &App, channel: uuid::Uuid) -> Vec<Item<'_>> {
    let mut list: Vec<Item<'_>> = streams::watched(app)
        .into_iter()
        .map(Item::Stream)
        .collect();
    if let Some(snapshot) = &app.remote.snapshot {
        let mut people: Vec<_> = snapshot
            .members
            .iter()
            .filter(|p| p.voice == Some(channel))
            .collect();
        people.sort_by_key(|p| (p.id != app.profile.id, p.name.to_lowercase()));
        // A watched camera already represents its owner; no duplicate avatar tile.
        let cameras: Vec<uuid::Uuid> = list
            .iter()
            .filter_map(|i| match i {
                Item::Stream((member, true)) => Some(*member),
                _ => None,
            })
            .collect();
        list.extend(
            people
                .into_iter()
                .filter(|p| !cameras.contains(&p.id))
                .map(Item::Person),
        );
    }
    list
}

fn stage(app: &App, channel: uuid::Uuid) -> Element<'_, Msg> {
    let focused = app
        .stream_focus
        .filter(|f| streams::watched(app).contains(f));
    responsive(move |bounds| {
        let all = items(app, channel);
        let gap = 10.0;
        if let Some(key) = focused {
            let rest: Vec<_> = all
                .into_iter()
                .filter(|i| !matches!(i, Item::Stream(k) if *k == key))
                .collect();
            let wide = bounds.width >= 900.0;
            let strip = if rest.is_empty() {
                0.0
            } else if wide {
                220.0
            } else {
                132.0
            };
            let (mw, mh) = if wide {
                (
                    bounds.width - strip - if strip > 0.0 { gap } else { 0.0 },
                    bounds.height,
                )
            } else {
                (
                    bounds.width,
                    bounds.height - strip - if strip > 0.0 { gap } else { 0.0 },
                )
            };
            let main = stream_tile(app, key, mw.max(0.0), mh.max(0.0), true);
            if rest.is_empty() {
                return main;
            }
            let tw = if wide { strip } else { strip * 16.0 / 9.0 };
            let th = tw * 9.0 / 16.0;
            let tiles: Vec<Element<'_, Msg>> =
                rest.into_iter().map(|i| tile(app, i, tw, th)).collect();
            if wide {
                row![
                    main,
                    scrollable(iced::widget::Column::with_children(tiles).spacing(gap))
                        .width(strip)
                        .height(Fill)
                        .direction(design::vertical_scrollbar())
                        .style(app.palette().scroll())
                ]
                .spacing(gap)
                .into()
            } else {
                column![
                    main,
                    scrollable(iced::widget::Row::with_children(tiles).spacing(gap))
                        .height(strip)
                        .width(Fill)
                        .direction(iced::widget::scrollable::Direction::Horizontal(
                            iced::widget::scrollable::Scrollbar::new()
                                .width(4)
                                .scroller_width(4)
                        ))
                        .style(app.palette().scroll())
                ]
                .spacing(gap)
                .into()
            }
        } else {
            let has_video = all.iter().any(|i| matches!(i, Item::Stream(_)));
            // Voice-only tiles stay compact instead of becoming giant empty cards.
            let max_tile = if has_video { 1600.0 } else { 440.0 };
            let (cols, tw, th) = layout(all.len(), bounds.width, bounds.height, gap, max_tile);
            let mut grid = column![].spacing(gap).align_x(iced::Center);
            let mut iter = all.into_iter().peekable();
            while iter.peek().is_some() {
                let mut line = row![].spacing(gap);
                for _ in 0..cols {
                    if let Some(item) = iter.next() {
                        line = line.push(tile(app, item, tw, th));
                    }
                }
                grid = grid.push(line);
            }
            container(grid).center(Fill).into()
        }
    })
    .into()
}

fn dock(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let (mute, deafen) = app.control_icons_sized(44.0);
    let in_call = app.remote.voice.is_some() && app.remote.microphone_ready;
    let camera = ui::icon_button(
        m,
        if app.remote.camera.is_some() {
            Icon::Video
        } else {
            Icon::VideoOff
        },
        if app.remote.camera.is_some() {
            "Desligar câmera"
        } else {
            "Ligar câmera"
        },
        in_call.then_some(if app.remote.camera.is_some() {
            Msg::CameraStop
        } else {
            Msg::CameraOpen
        }),
        if app.remote.camera.is_some() {
            Tone::Active
        } else {
            Tone::Secondary
        },
        44.0,
    );
    let share = ui::icon_button(
        m,
        if app.remote.screen.is_some() {
            Icon::ScreenShareOff
        } else {
            Icon::ScreenShare
        },
        if app.remote.screen.is_some() {
            "Parar compartilhamento"
        } else {
            "Compartilhar tela"
        },
        in_call.then_some(if app.remote.screen.is_some() {
            Msg::ShareStop
        } else {
            Msg::ShareOpen
        }),
        if app.remote.screen.is_some() {
            Tone::Active
        } else {
            Tone::Secondary
        },
        44.0,
    );
    let devices = ui::icon_button(
        m,
        Icon::SlidersHorizontal,
        "Dispositivos de áudio",
        Some(Msg::DevicePopover(!app.device_popover)),
        if app.device_popover {
            Tone::Active
        } else {
            Tone::Secondary
        },
        44.0,
    );
    let settings = ui::icon_button(
        m,
        Icon::Settings,
        "Configurações de áudio",
        Some(Msg::AudioSettings),
        Tone::Secondary,
        44.0,
    );
    let leave = ui::icon_button(
        m,
        Icon::PhoneOff,
        "Sair da chamada",
        Some(Msg::LeaveVoice),
        Tone::Danger,
        44.0,
    );
    container(
        row![
            mute,
            deafen,
            container(text(""))
                .width(1)
                .height(26)
                .style(move |_| m.surface(m.border)),
            camera,
            share,
            container(text(""))
                .width(1)
                .height(26)
                .style(move |_| m.surface(m.border)),
            devices,
            settings,
            Space::new().width(8),
            leave
        ]
        .spacing(8)
        .align_y(iced::Center),
    )
    .id("call-dock")
    .padding([8, 12])
    .style(move |_| {
        let mut s = m.floating();
        s.border.radius = radius::XL.into();
        s
    })
    .into()
}

fn device_popover(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let default = "Padrão do Windows".to_string();
    let names = |input: bool| -> Vec<String> {
        std::iter::once(default.clone())
            .chain(
                app.devices
                    .iter()
                    .filter(|d| d.input == input)
                    .map(|d| d.name.clone()),
            )
            .collect()
    };
    let current = |id: &str| {
        app.devices
            .iter()
            .find(|d| d.id == id)
            .map(|d| d.name.clone())
            .unwrap_or_else(|| default.clone())
    };
    let (ins, outs) = (app.devices.clone(), app.devices.clone());
    container(
        column![
            row![
                text("Dispositivos")
                    .size(size::STRONG)
                    .font(bold())
                    .width(Fill),
                ui::icon_button(
                    m,
                    Icon::RefreshCw,
                    "Atualizar dispositivos",
                    Some(Msg::Refresh),
                    Tone::Ghost,
                    28.0
                )
            ]
            .align_y(iced::Center),
            ui::label(m, "Microfone"),
            pick_list(
                names(true),
                Some(current(&app.profile.input)),
                move |name| {
                    Msg::QuickDevice(
                        true,
                        ins.iter()
                            .find(|d| d.input && d.name == name)
                            .map(|d| d.id.clone())
                            .unwrap_or_default(),
                    )
                }
            )
            .width(Fill)
            .padding(8)
            .style(m.select())
            .menu_style(m.menu()),
            ui::label(m, "Saída"),
            pick_list(
                names(false),
                Some(current(&app.profile.output)),
                move |name| {
                    Msg::QuickDevice(
                        false,
                        outs.iter()
                            .find(|d| !d.input && d.name == name)
                            .map(|d| d.id.clone())
                            .unwrap_or_default(),
                    )
                }
            )
            .width(Fill)
            .padding(8)
            .style(m.select())
            .menu_style(m.menu()),
            text("A troca reabre o áudio da chamada; o mudo atual é mantido.")
                .size(size::MICRO)
                .color(m.faint)
        ]
        .spacing(8),
    )
    .width(320)
    .padding(14)
    .style(move |_| m.floating())
    .into()
}

pub(super) fn view(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let Some(channel) = app.call_channel.or(app.remote.voice) else {
        return ui::empty(
            m,
            Icon::Volume2,
            "Nenhum canal de voz selecionado",
            "Escolha um canal de voz na lateral para entrar na chamada.",
            vec![],
        );
    };
    let snapshot = app.remote.snapshot.as_ref();
    let name = snapshot
        .and_then(|s| s.channels.iter().find(|c| c.id == channel))
        .or_else(|| app.channels.iter().find(|c| c.id == channel))
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "Canal de voz".into());
    let count = snapshot
        .map(|s| {
            s.members
                .iter()
                .filter(|p| p.voice == Some(channel))
                .count()
        })
        .unwrap_or(0);
    let joined = app.remote.voice == Some(channel);
    let mut header = row![
        ui::icon(Icon::Volume2, 20.0, m.muted),
        text(name.clone()).size(size::HEADING).font(bold()),
        text(match count {
            0 => "vazio".to_owned(),
            1 => "1 participante".to_owned(),
            n => format!("{n} participantes"),
        })
        .size(size::SMALL)
        .color(m.muted),
        Space::new().width(Fill),
    ]
    .spacing(10)
    .align_y(iced::Center);
    if joined {
        let (color, label) = match app.call_quality() {
            CallQuality::Good(Some(rtt)) => (m.speaking, format!("Conectado · {rtt} ms")),
            CallQuality::Good(None) | CallQuality::Alone => (m.speaking, "Conectado".into()),
            CallQuality::Opening => (m.warning, "Abrindo áudio".into()),
            CallQuality::Negotiating => (m.warning, "Conectando mídia".into()),
            CallQuality::Reconnecting => (m.warning, "Reconectando".into()),
            CallQuality::Degraded => (m.danger, "Mídia interrompida".into()),
        };
        header = header.push(
            container(
                row![
                    ui::icon(Icon::Signal, 14.0, color),
                    text(label).size(size::CAPTION).color(color)
                ]
                .spacing(6)
                .align_y(iced::Center),
            )
            .padding([4, 10])
            .style(move |_| container::Style {
                background: Some(alpha(color, 0.12).into()),
                border: Border {
                    radius: radius::PILL.into(),
                    ..Default::default()
                },
                ..Default::default()
            }),
        );
    }
    header = header.push(ui::icon_button(
        m,
        Icon::MessageCircle,
        "Abrir chat do servidor",
        Some(Msg::OpenChat),
        Tone::Ghost,
        34.0,
    ));
    let body: Element<'_, Msg> = if joined {
        stage(app, channel)
    } else {
        let mut people = row![].spacing(-8.0);
        if let Some(s) = snapshot {
            for p in s
                .members
                .iter()
                .filter(|p| p.voice == Some(channel))
                .take(6)
            {
                people = people.push(ui::avatar(m, &p.name, 40.0, Ring::default()));
            }
        }
        let busy = app.remote.voice.is_some();
        container(
            column![
                ui::empty(
                    m,
                    Icon::Headphones,
                    &name,
                    if count == 0 {
                        "Ninguém aqui ainda. Entre e espere seu grupo chegar."
                    } else if busy {
                        "Entrar aqui encerra sua chamada atual."
                    } else {
                        "Sua câmera e tela nunca ligam sozinhas ao entrar."
                    },
                    vec![
                        ui::action(
                            m,
                            Some(Icon::Phone),
                            "Entrar na chamada",
                            app.is_remote().then_some(Msg::JoinCall(channel)),
                            Tone::Primary
                        )
                        .into()
                    ]
                ),
                people
            ]
            .align_x(iced::Center)
            .spacing(16),
        )
        .center(Fill)
        .into()
    };
    let mut layers = column![
        container(header).padding([14, 20]),
        container(body).padding([0, 20]).height(Fill)
    ];
    if joined {
        layers = layers.push(container(dock(app)).center_x(Fill).padding([14, 0]));
    }
    let base: Element<'_, Msg> = container(layers).width(Fill).height(Fill).into();
    if app.device_popover && joined {
        stack![
            base,
            container(device_popover(app))
                .width(Fill)
                .height(Fill)
                .align_x(iced::Center)
                .align_y(iced::alignment::Vertical::Bottom)
                .padding(iced::Padding::new(0.0).bottom(86.0))
        ]
        .into()
    } else {
        base
    }
}

#[cfg(test)]
mod tests {
    use super::layout;
    #[test]
    fn grid_uses_space_without_giant_tiles() {
        // Three voice tiles on a 1280×720 canvas: the largest tile wins, capped.
        let (cols, w, h) = layout(3, 1100.0, 560.0, 10.0, 440.0);
        assert_eq!((cols, w), (2, 440.0));
        assert!(w <= 440.0 && (h - w * 9.0 / 16.0).abs() < 0.5);
        // Nine tiles fill a 3×3 grid within the bounds.
        let (cols, w, h) = layout(9, 1100.0, 560.0, 10.0, 1600.0);
        assert_eq!(cols, 3);
        assert!(w * 3.0 + 20.0 <= 1100.5 && h * 3.0 + 20.0 <= 560.5);
        // One stream fills the width or height.
        let (_, w, h) = layout(1, 1600.0, 600.0, 10.0, 1600.0);
        assert!((h - 600.0).abs() < 0.5 && w > 1000.0);
    }
}
