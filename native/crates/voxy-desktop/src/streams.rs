//! Screen share picker, stream stage (grid / focused / fullscreen with HUD).
//! Everything shown is driven by host-confirmed snapshot state plus frames that
//! were actually decoded; there are no placeholder streams.
use super::{App, Msg, bold};
use crate::design::alpha;
use iced::{
    Color, Element,
    Length::Fill,
    widget::{column, container, mouse_area, pick_list, row, scrollable, space, stack, text},
};
use voxy_core::ipc::{SCREEN_PRESETS, ScreenSource};

/// Windows and monitors the user can pick. Voxy's own windows are excluded.
pub fn sources() -> Vec<ScreenSource> {
    #[cfg(windows)]
    {
        let own = std::process::id();
        voxy_media::enumerate_sources()
            .unwrap_or_default()
            .into_iter()
            .enumerate()
            .filter_map(|(index, source)| match source {
                voxy_media::CaptureSource::Window {
                    handle,
                    process_id,
                    title,
                } => (process_id != own && !title.trim().is_empty()).then(|| ScreenSource {
                    kind: "window".into(),
                    handle: handle as u64,
                    process_id,
                    label: title.chars().take(80).collect(),
                }),
                voxy_media::CaptureSource::Monitor {
                    handle,
                    width,
                    height,
                } => Some(ScreenSource {
                    kind: "monitor".into(),
                    handle: handle as u64,
                    process_id: 0,
                    label: format!("Monitor {} · {width}×{height}", index + 1),
                }),
            })
            // Automated tests must never list or capture the tester's own windows.
            .filter(|source| match std::env::var("VOXY_TEST_SOURCE_FILTER") {
                Ok(filter) if crate::automation::directory().is_some() => {
                    source.label.contains(&filter)
                }
                _ => true,
            })
            .take(40)
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![]
    }
}

/// One-frame private preview of the chosen source, captured and released locally.
pub fn preview(source: &ScreenSource) -> anyhow::Result<iced::widget::image::Handle> {
    #[cfg(windows)]
    {
        use voxy_media::{CaptureOptions, CaptureSource, MediaRuntime, ScreenCapture, fit_bgra};
        let runtime = MediaRuntime::new()?;
        let selected = voxy_media::enumerate_sources()?
            .into_iter()
            .find(|c| match c {
                CaptureSource::Window { handle, .. } => *handle as u64 == source.handle,
                CaptureSource::Monitor { handle, .. } => *handle as u64 == source.handle,
            })
            .ok_or_else(|| anyhow::anyhow!("Fonte indisponível"))?;
        let mut capture = ScreenCapture::start(
            &runtime,
            &selected,
            CaptureOptions {
                frames_per_second: 5,
                include_audio: false,
            },
        )?;
        let frame = capture
            .next_frame(std::time::Duration::from_secs(2))?
            .ok_or_else(|| anyhow::anyhow!("Sem prévia"))?;
        drop(capture);
        let small = fit_bgra(&frame, 384, 216)?;
        let mut rgba = small.pixels.to_vec();
        for pixel in rgba.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        Ok(iced::widget::image::Handle::from_rgba(384, 216, rgba))
    }
    #[cfg(not(windows))]
    {
        let _ = source;
        anyhow::bail!("Indisponível")
    }
}

pub(super) fn share_dialog(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut list = column![].spacing(4);
    for (index, source) in app.share_sources.iter().enumerate() {
        let selected = app.share_selected == Some(index);
        let label = format!(
            "{} {}",
            if source.kind == "monitor" {
                "▣"
            } else {
                "▢"
            },
            source.label
        );
        list = list.push(
            app.action(&label, Msg::ShareSelect(index), selected)
                .width(Fill)
                .style(m.navigation(selected)),
        );
    }
    let preview: Element<'_, Msg> = match &app.share_preview {
        Some(handle) => iced::widget::image(handle.clone())
            .width(384)
            .height(216)
            .into(),
        None => container(
            text(if app.share_selected.is_some() {
                "Carregando prévia…"
            } else {
                "Escolha uma janela ou monitor"
            })
            .size(12)
            .color(m.muted),
        )
        .width(384)
        .height(216)
        .center(Fill)
        .style(move |_| container::Style {
            background: Some(alpha(m.ink, 0.05).into()),
            ..Default::default()
        })
        .into(),
    };
    let presets: Vec<String> = SCREEN_PRESETS.iter().map(|p| p.0.to_string()).collect();
    container(
        container(
            column![
                row![
                    text("Compartilhar tela").font(bold()).size(20),
                    space::horizontal(),
                    app.action("×", Msg::Cancel, false)
                ],
                row![
                    scrollable(list).height(300).width(Fill),
                    column![
                        preview,
                        text("Qualidade").size(12).color(m.muted),
                        pick_list(presets, Some(app.share_preset.clone()), Msg::SharePreset)
                            .padding(8)
                            .style(m.select())
                            .menu_style(m.menu()),
                        iced::widget::checkbox(app.share_audio)
                            .label(
                                match app.share_selected.and_then(|i| app.share_sources.get(i)) {
                                    Some(source) if source.kind == "monitor" => {
                                        "Incluir áudio do sistema (sem a chamada do Voxy)"
                                    }
                                    _ => "Incluir áudio deste aplicativo",
                                }
                            )
                            .on_toggle(Msg::ShareAudio)
                            .size(16),
                    ]
                    .spacing(8)
                    .width(384)
                ]
                .spacing(16),
                row![
                    space::horizontal(),
                    app.action("Cancelar", Msg::Cancel, false),
                    if app.share_selected.is_some() {
                        app.action("Iniciar compartilhamento", Msg::ShareStart, true)
                    } else {
                        app.action("Iniciar compartilhamento", Msg::Cancel, true)
                            .on_press_maybe(None)
                    }
                ]
                .spacing(8)
            ]
            .spacing(16),
        )
        .padding(24)
        .width(860)
        .style(move |_| m.dialog()),
    )
    .center(Fill)
    .style(|_| container::Style {
        background: Some(alpha(Color::BLACK, 0.65).into()),
        ..Default::default()
    })
    .into()
}

type StreamKey = (uuid::Uuid, bool);

fn tile<'a>(app: &'a App, key: StreamKey, focused: bool) -> Element<'a, Msg> {
    let m = app.palette();
    let (member, camera) = key;
    let name = app
        .remote
        .snapshot
        .as_ref()
        .and_then(|s| s.members.iter().find(|x| x.id == member))
        .map(|x| x.name.clone())
        .unwrap_or_default();
    let picture: Element<'a, Msg> = match app.streams.get(&key) {
        Some(frame) => iced::widget::image(frame.handle.clone())
            .width(Fill)
            .height(Fill)
            .content_fit(iced::ContentFit::Contain)
            .into(),
        None => container(text("Aguardando vídeo…").size(12).color(m.muted))
            .center(Fill)
            .into(),
    };
    let stats = app
        .streams
        .get(&key)
        .map(|f| format!("{}×{} · {} quadros", f.width, f.height, f.decoded))
        .unwrap_or_default();
    let bar = row![
        text(format!(
            "{name} · {}",
            if camera { "câmera" } else { "tela" }
        ))
        .size(12),
        text(stats).size(11).color(m.muted),
        space::horizontal(),
        if focused {
            app.action("Voltar à grade", Msg::StreamFocus(None), false)
        } else {
            app.action("Ampliar", Msg::StreamFocus(Some(key)), false)
        },
        app.action("Parar de assistir", Msg::Watch(member, false), false)
    ]
    .spacing(8)
    .align_y(iced::Center);
    container(column![picture, bar].spacing(6))
        .padding(8)
        .width(Fill)
        .height(Fill)
        .style(move |_| container::Style {
            background: Some(Color::BLACK.into()),
            border: iced::Border {
                radius: 8.0.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}

/// Watched streams (screen and/or camera) the host confirms, in a stable order.
pub(super) fn watched(app: &App) -> Vec<StreamKey> {
    let mut keys: Vec<StreamKey> = app
        .remote
        .snapshot
        .as_ref()
        .and_then(|s| s.members.iter().find(|m| m.id == app.profile.id))
        .map(|me| me.watching.clone())
        .unwrap_or_default()
        .into_iter()
        .flat_map(|member| [(member, false), (member, true)])
        .filter(|(member, camera)| app.watching(*member, *camera))
        .collect();
    keys.sort();
    keys
}

pub(super) fn stage(app: &App) -> Option<Element<'_, Msg>> {
    let keys = watched(app);
    if keys.is_empty() {
        return None;
    }
    let focused = app.stream_focus.filter(|f| keys.contains(f));
    let content: Element<'_, Msg> = if let Some(key) = focused {
        tile(app, key, true)
    } else {
        let columns = if keys.len() == 1 { 1 } else { 2 };
        let mut grid = column![].spacing(8).height(Fill);
        for chunk in keys.chunks(columns) {
            let mut line = row![].spacing(8).height(Fill);
            for key in chunk {
                line = line.push(tile(app, *key, false));
            }
            grid = grid.push(line);
        }
        grid.into()
    };
    let header = row![
        text("Transmissões").font(bold()).size(16),
        space::horizontal(),
        app.action(
            if app.stream_fullscreen {
                "Sair da tela cheia"
            } else {
                "Tela cheia"
            },
            Msg::StreamFullscreen,
            false
        )
    ]
    .align_y(iced::Center);
    if app.stream_fullscreen {
        let hud_visible = std::time::Instant::now() < app.hud_until;
        let layer: Element<'_, Msg> = if hud_visible {
            column![container(header).padding(12), space::vertical()].into()
        } else {
            space::horizontal().into()
        };
        return Some(
            mouse_area(stack![container(content).padding(4), layer])
                .on_move(|_| Msg::StreamHud)
                .into(),
        );
    }
    Some(
        container(column![header, content].spacing(10))
            .padding(16)
            .height(Fill)
            .width(Fill)
            .into(),
    )
}

/// Footer button: start or stop sharing, only while in a confirmed call.
pub(super) fn share_button(app: &App) -> Option<iced::widget::Button<'_, Msg>> {
    if app.remote.voice.is_none() || !app.remote.microphone_ready {
        return None;
    }
    Some(if app.remote.screen.is_some() {
        app.action("Parar compartilhamento", Msg::ShareStop, true)
    } else {
        app.action("Compartilhar tela", Msg::ShareOpen, false)
    })
}

/// Footer button: the camera turns on only from this explicit action.
pub(super) fn camera_button(app: &App) -> Option<iced::widget::Button<'_, Msg>> {
    if app.remote.voice.is_none() || !app.remote.microphone_ready {
        return None;
    }
    Some(if app.remote.camera.is_some() {
        app.action("Desligar câmera", Msg::CameraStop, true)
    } else {
        app.action("Câmera", Msg::CameraOpen, false)
    })
}

/// Cameras by (device id, name). The synthetic camera appears only in tests.
pub fn cameras() -> Vec<(String, String)> {
    let mut cameras = Vec::new();
    if std::env::var("VOXY_TEST_SYNTHETIC_CAMERA").as_deref() == Ok("1") {
        cameras.push((
            "synthetic:camera".to_owned(),
            "Câmera de teste sintética".to_owned(),
        ));
    }
    #[cfg(windows)]
    if let Ok(runtime) = voxy_media::MediaRuntime::new() {
        for camera in voxy_media::enumerate_cameras(&runtime).unwrap_or_default() {
            cameras.push((camera.symbolic_link, camera.name));
        }
    }
    cameras.truncate(16);
    cameras
}

/// Private still preview: the device is opened for one frame and released.
pub fn camera_preview(device: &str) -> anyhow::Result<iced::widget::image::Handle> {
    let frame = if device == "synthetic:camera" {
        voxy_media::synthetic_camera_frame(640, 360, 1)
    } else {
        #[cfg(windows)]
        {
            let runtime = voxy_media::MediaRuntime::new()?;
            let mut capture =
                voxy_media::camera::CameraCapture::start(&runtime, device, 640, 360, 30)?;
            let mut frame = None;
            for _ in 0..30 {
                if let Some(next) = capture.next_frame()? {
                    frame = Some(next);
                    break;
                }
            }
            frame.ok_or_else(|| anyhow::anyhow!("Sem imagem da câmera"))?
        }
        #[cfg(not(windows))]
        anyhow::bail!("Indisponível")
    };
    let small = voxy_media::fit_bgra(&frame, 384, 216)?;
    let mut rgba = small.pixels.to_vec();
    for pixel in rgba.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    Ok(iced::widget::image::Handle::from_rgba(384, 216, rgba))
}

pub(super) fn camera_dialog(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let mut list = column![].spacing(4);
    for (index, (_, name)) in app.cameras.iter().enumerate() {
        let selected = app.camera_selected == Some(index);
        list = list.push(
            app.action(name, Msg::CameraSelect(index), selected)
                .width(Fill)
                .style(m.navigation(selected)),
        );
    }
    if app.cameras.is_empty() {
        list = list.push(text("Nenhuma câmera encontrada.").size(12).color(m.muted));
    }
    let preview: Element<'_, Msg> = match &app.camera_preview {
        Some(handle) => iced::widget::image(handle.clone())
            .width(384)
            .height(216)
            .into(),
        None => container(
            text(if app.camera_selected.is_some() {
                "Carregando prévia…"
            } else {
                "Escolha uma câmera"
            })
            .size(12)
            .color(m.muted),
        )
        .width(384)
        .height(216)
        .center(Fill)
        .into(),
    };
    let presets: Vec<String> = voxy_core::ipc::CAMERA_PRESETS
        .iter()
        .map(|p| p.0.to_string())
        .collect();
    container(
        container(
            column![
                row![
                    text("Câmera").font(bold()).size(20),
                    space::horizontal(),
                    app.action("×", Msg::Cancel, false)
                ],
                row![
                    scrollable(list).height(240).width(Fill),
                    column![
                        preview,
                        text("Qualidade").size(12).color(m.muted),
                        pick_list(presets, Some(app.camera_preset.clone()), Msg::CameraPreset)
                            .padding(8)
                            .style(m.select())
                            .menu_style(m.menu()),
                        text("A prévia é privada. A câmera só é enviada depois de Ativar.")
                            .size(11)
                            .color(m.muted),
                    ]
                    .spacing(8)
                    .width(384)
                ]
                .spacing(16),
                row![
                    space::horizontal(),
                    app.action("Cancelar", Msg::Cancel, false),
                    if app.camera_selected.is_some() {
                        app.action("Ativar câmera", Msg::CameraStart, true)
                    } else {
                        app.action("Ativar câmera", Msg::Cancel, true)
                            .on_press_maybe(None)
                    }
                ]
                .spacing(8)
            ]
            .spacing(16),
        )
        .padding(24)
        .width(780)
        .style(move |_| m.dialog()),
    )
    .center(Fill)
    .style(|_| container::Style {
        background: Some(alpha(Color::BLACK, 0.65).into()),
        ..Default::default()
    })
    .into()
}
