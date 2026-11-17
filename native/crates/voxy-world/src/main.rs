mod renderer;
use anyhow::{Context, Result, ensure};
use renderer::Renderer;
use std::{path::PathBuf, sync::Arc};
use voxy_world::catalog::{Preset, Scene};
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Fullscreen, Window, WindowId},
};
struct App {
    scene: Option<Scene>,
    renderer: Option<Renderer>,
    error: Option<String>,
    limit: u64,
    drag: bool,
    cursor: Option<(f64, f64)>,
    capture: Option<PathBuf>,
    ready_file: Option<PathBuf>,
}
impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.renderer.is_some() {
            return;
        }
        let result = (|| -> Result<Renderer> {
            let scene = self.scene.take().context("Scene unavailable")?;
            let window = Arc::new(
                event_loop.create_window(
                    Window::default_attributes()
                        .with_title(format!(
                            "Voxy 2.0 · {} · renderer nativo em desenvolvimento",
                            scene.catalog.name
                        ))
                        .with_inner_size(LogicalSize::new(1240.0, 820.0)),
                )?,
            );
            pollster::block_on(Renderer::new(window, scene))
        })();
        match result {
            Ok(mut renderer) => {
                renderer.capture = self.capture.take();
                renderer.window.request_redraw();
                self.renderer = Some(renderer);
            }
            Err(error) => {
                self.error = Some(format!("{error:#}"));
                event_loop.exit();
            }
        }
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let Some(renderer) = &mut self.renderer else {
            return;
        };
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                renderer.resize(size);
                renderer.window.request_redraw();
            }
            WindowEvent::RedrawRequested => {
                if let Err(error) = renderer.render() {
                    self.error = Some(format!("{error:#}"));
                    event_loop.exit();
                } else {
                    if renderer.frames > 0
                        && let Some(path) = self.ready_file.take()
                        && let Err(error) = renderer.write_readiness(&path)
                    {
                        self.error = Some(format!("{error:#}"));
                        event_loop.exit();
                        return;
                    }
                    if self.limit > 0 {
                        if renderer.frames >= self.limit {
                            event_loop.exit();
                        } else {
                            renderer.window.request_redraw();
                        }
                    }
                }
            }
            WindowEvent::MouseInput {
                state,
                button: MouseButton::Right,
                ..
            } => self.drag = state == ElementState::Pressed,
            WindowEvent::CursorMoved { position, .. } => {
                if self.drag
                    && let Some((x, y)) = self.cursor
                {
                    let delta = renderer.eye - renderer.target;
                    let radius = delta.length();
                    let yaw = delta.x.atan2(delta.z) + (position.x - x) as f32 * 0.006;
                    let pitch = ((delta.y / radius).asin() + (position.y - y) as f32 * 0.006)
                        .clamp(-1.3, 1.3);
                    renderer.eye = renderer.target
                        + glam::Vec3::new(
                            yaw.sin() * pitch.cos(),
                            pitch.sin(),
                            yaw.cos() * pitch.cos(),
                        ) * radius;
                    renderer.window.request_redraw();
                }
                self.cursor = Some((position.x, position.y));
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let amount = match delta {
                    MouseScrollDelta::LineDelta(_, amount) => amount,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 50.0,
                };
                let direction = renderer.eye - renderer.target;
                renderer.eye = renderer.target
                    + direction.normalize() * (direction.length() - amount * 0.5).clamp(0.7, 60.0);
                renderer.window.request_redraw();
            }
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                let PhysicalKey::Code(key) = event.physical_key else {
                    return;
                };
                if key == KeyCode::Escape {
                    event_loop.exit();
                    return;
                }
                if key == KeyCode::F11 {
                    renderer
                        .window
                        .set_fullscreen(if renderer.window.fullscreen().is_some() {
                            None
                        } else {
                            Some(Fullscreen::Borderless(None))
                        });
                    return;
                }
                let forward = (renderer.target - renderer.eye) * glam::Vec3::new(1.0, 0.0, 1.0);
                let forward = forward.normalize_or_zero() * 0.3;
                let right = forward.cross(glam::Vec3::Y);
                let step = match key {
                    KeyCode::KeyW => forward,
                    KeyCode::KeyS => -forward,
                    KeyCode::KeyD => right,
                    KeyCode::KeyA => -right,
                    KeyCode::KeyR => glam::Vec3::Y * 0.2,
                    KeyCode::KeyF => -glam::Vec3::Y * 0.2,
                    _ => return,
                };
                renderer.eye += step;
                renderer.target += step;
                renderer.window.request_redraw();
            }
            WindowEvent::Focused(true) => renderer.window.request_redraw(),
            _ => {}
        }
    }
}
fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let (mut preset, mut limit, mut validate) = (Preset::Lounge, 0, false);
    let mut assets: Option<PathBuf> = None;
    let mut capture: Option<PathBuf> = None;
    let mut ready_file: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--preset" => preset = Preset::parse(&args.next().context("Missing preset")?)?,
            "--assets" => assets = Some(args.next().context("Missing assets directory")?.into()),
            "--frames" => limit = args.next().context("Missing frame limit")?.parse()?,
            "--validate" => validate = true,
            "--capture" => capture = Some(args.next().context("Missing capture path")?.into()),
            "--ready-file" => {
                ready_file = Some(args.next().context("Missing readiness path")?.into())
            }
            _ => anyhow::bail!("Argumento desconhecido: {arg}"),
        }
    }
    let assets = assets
        .unwrap_or_else(|| {
            let installed = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.join("world-assets")));
            if let Some(path) = installed
                && path.exists()
            {
                return path;
            }
            #[cfg(debug_assertions)]
            {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../world-assets")
            }
            #[cfg(not(debug_assertions))]
            {
                PathBuf::from("world-assets")
            }
        })
        .canonicalize()
        .context("Assets do mundo não encontrados")?;
    let scene = Scene::load(&assets, preset)?;
    if validate {
        println!(
            "{}",
            serde_json::json!({"preset":scene.catalog.name,"vertices":scene.vertices.len(),"draws":scene.catalog.draws.len(),"materials":scene.catalog.materials.len(),"textures":scene.catalog.textures.len(),"colliders":scene.catalog.colliders.len(),"seats":scene.catalog.seats.len(),"validation":"hashes, bounds and hierarchy checked; no physical gameplay claim"})
        );
        return Ok(());
    }
    ensure!(limit <= 10_000, "Frame limit too large");
    if capture.is_some() && limit == 0 {
        limit = 1;
    }
    let event_loop = EventLoop::new()?;
    event_loop.set_control_flow(ControlFlow::Wait);
    let mut app = App {
        scene: Some(scene),
        renderer: None,
        error: None,
        limit,
        drag: false,
        cursor: None,
        capture,
        ready_file,
    };
    event_loop.run_app(&mut app)?;
    if let Some(error) = app.error {
        anyhow::bail!("{error}");
    }
    if let Some(renderer) = app.renderer {
        println!(
            "{}",
            serde_json::json!({"adapter":renderer.adapter,"frames":renderer.frames,"exit":"closed","idle_redraw":"event-driven"})
        );
    }
    Ok(())
}
