use anyhow::{Context, Result, ensure};
use glam::{Mat4, Vec3};
use std::{io::Cursor, sync::Arc};
use voxy_world::catalog::{Scene, Vertex};
use wgpu::util::DeviceExt;
use winit::{dpi::PhysicalSize, window::Window};
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
#[repr(C)]
struct Point {
    position: [f32; 4],
    color: [f32; 4],
}
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
#[repr(C)]
struct CameraUniform {
    view_proj: [[f32; 4]; 4],
    eye: [f32; 4],
    ambient: [f32; 4],
    sun_dir: [f32; 4],
    sun_color: [f32; 4],
    fog_color: [f32; 4],
    fog_distance: [f32; 4],
    points: [Point; 8],
}
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
#[repr(C)]
struct MaterialUniform {
    color: [f32; 4],
    emissive: [f32; 4],
    uv: [f32; 4],
    flags: [f32; 4],
}
pub struct Renderer {
    pub window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    opaque: wgpu::RenderPipeline,
    transparent: wgpu::RenderPipeline,
    vertices: wgpu::Buffer,
    camera_buffer: wgpu::Buffer,
    camera_group: wgpu::BindGroup,
    material_groups: Vec<wgpu::BindGroup>,
    depth: wgpu::TextureView,
    scene: Scene,
    pub eye: Vec3,
    pub target: Vec3,
    pub frames: u64,
    pub adapter: String,
    pub capture: Option<std::path::PathBuf>,
}
impl Renderer {
    pub fn write_readiness(&self, path: &std::path::Path) -> Result<()> {
        ensure!(self.frames > 0, "Nenhum frame concluído");
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(std::time::Duration::from_secs(10)),
            })
            .map_err(|error| anyhow::anyhow!("GPU não confirmou primeiro frame: {error:?}"))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let pending = path.with_extension("pending");
        std::fs::write(
            &pending,
            serde_json::to_vec(
                &serde_json::json!({"preset":self.scene.catalog.name,"rendered":true,"pid":std::process::id(),"adapter":self.adapter}),
            )?,
        )?;
        std::fs::rename(pending, path)?;
        Ok(())
    }
    pub async fn new(window: Arc<Window>, scene: Scene) -> Result<Self> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let surface = instance.create_surface(window.clone())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
            })
            .await
            .context("Adaptador gráfico DX12 indisponível")?;
        let adapter_name = adapter.get_info().name;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Voxy world device"),
                ..Default::default()
            })
            .await?;
        let size = window.inner_size();
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .context("Superfície gráfica incompatível")?;
        config.present_mode = wgpu::PresentMode::AutoVsync;
        config.desired_maximum_frame_latency = 2;
        if surface
            .get_capabilities(&adapter)
            .usages
            .contains(wgpu::TextureUsages::COPY_SRC)
        {
            config.usage |= wgpu::TextureUsages::COPY_SRC;
        }
        surface.configure(&device, &config);
        let camera_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("world camera"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let material_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("world material"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let camera_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("world camera uniforms"),
            size: std::mem::size_of::<CameraUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let camera_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &camera_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_buffer.as_entire_binding(),
            }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Voxy world initial native shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("world.wgsl").into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&camera_layout, &material_layout],
            push_constant_ranges: &[],
        });
        let create_pipeline = |transparent: bool| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {label:Some("world geometry"),layout:Some(&layout),vertex:wgpu::VertexState {module:&shader,entry_point:Some("vs_main"),compilation_options:Default::default(),buffers:&[wgpu::VertexBufferLayout {array_stride:44,step_mode:wgpu::VertexStepMode::Vertex,attributes:&wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x3,2=>Float32x2,3=>Float32x3]}]},fragment:Some(wgpu::FragmentState {module:&shader,entry_point:Some("fs_main"),compilation_options:Default::default(),targets:&[Some(wgpu::ColorTargetState {format:config.format,blend:transparent.then_some(wgpu::BlendState::ALPHA_BLENDING),write_mask:wgpu::ColorWrites::ALL})]}),primitive:wgpu::PrimitiveState {cull_mode:None,..Default::default()},depth_stencil:Some(wgpu::DepthStencilState {format:wgpu::TextureFormat::Depth32Float,depth_write_enabled:!transparent,depth_compare:wgpu::CompareFunction::LessEqual,stencil:Default::default(),bias:Default::default()}),multisample:Default::default(),multiview:None,cache:None})
        };
        let opaque = create_pipeline(false);
        let transparent = create_pipeline(true);
        let vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("preserved procedural vertices"),
            contents: bytemuck::cast_slice::<Vertex, u8>(&scene.vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: None,
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let upload = |width: u32, height: u32, rgba: &[u8]| {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("authored scene texture"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(width * 4),
                    rows_per_image: Some(height),
                },
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
            );
            texture.create_view(&Default::default())
        };
        let white = upload(1, 1, &[255, 255, 255, 255]);
        let mut texture_views = vec![];
        for (texture, bytes) in scene.catalog.textures.iter().zip(&scene.textures) {
            let mut decoder = png::Decoder::new(Cursor::new(bytes));
            decoder.set_transformations(
                png::Transformations::EXPAND
                    | png::Transformations::ALPHA
                    | png::Transformations::STRIP_16,
            );
            let mut reader = decoder.read_info()?;
            ensure!(
                reader.info().width == texture.width && reader.info().height == texture.height,
                "Dimensão PNG diverge do catálogo"
            );
            let mut rgba = vec![0; reader.output_buffer_size().context("PNG invalido")?];
            let info = reader.next_frame(&mut rgba)?;
            ensure!(
                info.width == texture.width
                    && info.height == texture.height
                    && info.color_type == png::ColorType::Rgba,
                "Layout PNG inválido"
            );
            texture_views.push(upload(
                texture.width,
                texture.height,
                &rgba[..info.buffer_size()],
            ));
        }
        let mut material_groups = vec![];
        for mat in &scene.catalog.materials {
            let texture = mat.map.map(|index| &scene.catalog.textures[index]);
            let uniform = MaterialUniform {
                color: [mat.color[0], mat.color[1], mat.color[2], mat.opacity],
                emissive: [
                    mat.emissive[0] * mat.emissive_intensity,
                    mat.emissive[1] * mat.emissive_intensity,
                    mat.emissive[2] * mat.emissive_intensity,
                    0.0,
                ],
                uv: texture
                    .map(|t| [t.repeat[0], t.repeat[1], t.offset[0], t.offset[1]])
                    .unwrap_or([1.0, 1.0, 0.0, 0.0]),
                flags: [
                    f32::from(mat.unlit),
                    f32::from(texture.is_some_and(|t| t.flip_y)),
                    mat.roughness,
                    mat.metalness,
                ],
            };
            let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::bytes_of(&uniform),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            material_groups.push(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &material_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(
                            mat.map.map(|i| &texture_views[i]).unwrap_or(&white),
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(&sampler),
                    },
                ],
            }));
        }
        let depth = Self::create_depth(&device, &config);
        let avatar = scene.catalog.name.starts_with("avatar");
        Ok(Self {
            window,
            surface,
            device,
            queue,
            config,
            opaque,
            transparent,
            vertices,
            camera_buffer,
            camera_group,
            material_groups,
            depth,
            scene,
            eye: if avatar {
                Vec3::new(0.0, 1.4, 3.2)
            } else {
                Vec3::new(9.0, 4.6, 10.0)
            },
            target: if avatar {
                Vec3::new(0.0, 1.0, 0.0)
            } else {
                Vec3::new(0.0, 2.0, -5.0)
            },
            frames: 0,
            adapter: adapter_name,
            capture: None,
        })
    }
    fn create_depth(
        device: &wgpu::Device,
        config: &wgpu::SurfaceConfiguration,
    ) -> wgpu::TextureView {
        device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("world depth"),
                size: wgpu::Extent3d {
                    width: config.width,
                    height: config.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Depth32Float,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
            .create_view(&Default::default())
    }
    pub fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        self.depth = Self::create_depth(&self.device, &self.config);
    }
    pub fn render(&mut self) -> Result<()> {
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let mut camera = CameraUniform {
            view_proj: (Mat4::perspective_rh(
                55.0_f32.to_radians(),
                self.config.width as f32 / self.config.height as f32,
                0.05,
                150.0,
            ) * Mat4::look_at_rh(self.eye, self.target, Vec3::Y))
            .to_cols_array_2d(),
            eye: [self.eye.x, self.eye.y, self.eye.z, 1.0],
            ambient: [0.25, 0.25, 0.25, 1.0],
            sun_dir: [0.3, 0.8, 0.5, 0.0],
            sun_color: [0.4, 0.4, 0.4, 1.0],
            fog_color: [0.0; 4],
            fog_distance: [0.0; 4],
            points: [Point {
                position: [0.0; 4],
                color: [0.0; 4],
            }; 8],
        };
        let mut point = 0;
        for light in &self.scene.catalog.lights {
            if light.kind == "HemisphereLight" {
                camera.ambient = [
                    light.color[0] * light.intensity * 0.55,
                    light.color[1] * light.intensity * 0.55,
                    light.color[2] * light.intensity * 0.55,
                    1.0,
                ];
            } else if light.kind == "DirectionalLight" {
                let dir = Vec3::from_array(light.position)
                    - Vec3::from_array(light.target.unwrap_or([0.0; 3]));
                camera.sun_dir = [dir.x, dir.y, dir.z, 0.0];
                camera.sun_color = [
                    light.color[0] * light.intensity,
                    light.color[1] * light.intensity,
                    light.color[2] * light.intensity,
                    1.0,
                ];
            } else if matches!(light.kind.as_str(), "PointLight" | "SpotLight") && point < 8 {
                camera.points[point] = Point {
                    position: [
                        light.position[0],
                        light.position[1],
                        light.position[2],
                        light.distance.max(1.0),
                    ],
                    color: [
                        light.color[0] * light.intensity,
                        light.color[1] * light.intensity,
                        light.color[2] * light.intensity,
                        1.0,
                    ],
                };
                point += 1;
            }
        }
        if let Some(fog) = &self.scene.catalog.fog {
            camera.fog_color = [fog.color[0], fog.color[1], fog.color[2], 1.0];
            camera.fog_distance = [fog.near, fog.far, 1.0, 0.0];
        }
        self.queue
            .write_buffer(&self.camera_buffer, 0, bytemuck::bytes_of(&camera));
        let view = frame.texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let background = self.scene.catalog.background;
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("world scene"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: background[0] as f64,
                            g: background[1] as f64,
                            b: background[2] as f64,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_bind_group(0, &self.camera_group, &[]);
            pass.set_vertex_buffer(0, self.vertices.slice(..));
            for transparent in [false, true] {
                pass.set_pipeline(if transparent {
                    &self.transparent
                } else {
                    &self.opaque
                });
                for draw in &self.scene.catalog.draws {
                    let mat = &self.scene.catalog.materials[draw.material];
                    if !draw.visible || mat.transparent != transparent {
                        continue;
                    }
                    pass.set_bind_group(1, &self.material_groups[draw.material], &[]);
                    pass.draw(draw.start..draw.start + draw.count, 0..1);
                }
            }
        }
        let capture = if let Some(path) = self.capture.take() {
            ensure!(
                self.config.usage.contains(wgpu::TextureUsages::COPY_SRC),
                "Adaptador não permite captura de diagnóstico"
            );
            let row = (self.config.width * 4).div_ceil(256) * 256;
            let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("world diagnostic readback"),
                size: row as u64 * self.config.height as u64,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            encoder.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: &frame.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(row),
                        rows_per_image: Some(self.config.height),
                    },
                },
                wgpu::Extent3d {
                    width: self.config.width,
                    height: self.config.height,
                    depth_or_array_layers: 1,
                },
            );
            Some((path, buffer, row))
        } else {
            None
        };
        self.queue.submit([encoder.finish()]);
        if let Some((path, buffer, row)) = capture {
            let (tx, rx) = std::sync::mpsc::channel();
            buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |result| {
                    let _ = tx.send(result);
                });
            self.device
                .poll(wgpu::PollType::Wait {
                    submission_index: None,
                    timeout: Some(std::time::Duration::from_secs(10)),
                })
                .map_err(|error| anyhow::anyhow!("GPU readback failed: {error:?}"))?;
            rx.recv_timeout(std::time::Duration::from_secs(1))??;
            let mapped = buffer.slice(..).get_mapped_range();
            let mut rgba =
                Vec::with_capacity((self.config.width * self.config.height * 4) as usize);
            for scanline in mapped.chunks_exact(row as usize) {
                rgba.extend_from_slice(&scanline[..self.config.width as usize * 4]);
            }
            if matches!(
                self.config.format,
                wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb
            ) {
                for pixel in rgba.as_chunks_mut::<4>().0 {
                    pixel.swap(0, 2);
                }
            }
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut encoder = png::Encoder::new(
                std::fs::File::create(path)?,
                self.config.width,
                self.config.height,
            );
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.write_header()?.write_image_data(&rgba)?;
            drop(mapped);
            buffer.unmap();
        }
        frame.present();
        self.frames += 1;
        Ok(())
    }
}
