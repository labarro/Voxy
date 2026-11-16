#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod art;
mod design;
mod platform;
use design::{Materials, alpha};
use iced::{
    Border, Color, Element, Font,
    Length::{Fill, Fixed},
    Subscription, Task, Theme,
    widget::{
        self, button, checkbox, column, container, mouse_area, pick_list, row, scrollable, slider,
        space, stack, text, text_input,
    },
};
use std::sync::{Arc, atomic::Ordering};
use voxy_core::{
    model::{
        Channel, ChannelKind, Community, Message as ChatMessage, Profile, Theme as ProfileTheme,
    },
    store::Store,
};
use voxy_voice::{
    control::VoiceControl,
    devices::{AudioDevice, MicrophoneTest},
};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    Home,
    Chat,
    Settings,
    News,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Section {
    Profile,
    Audio,
    Appearance,
    Privacy,
}
#[derive(Debug, Clone)]
enum Msg {
    Navigate(Page),
    AudioSettings,
    Section(Section),
    Name(String),
    Save,
    Theme(ProfileTheme),
    Low(bool),
    Gain(f32),
    Ptt(bool),
    PttKey(String),
    Input(String),
    Output(String),
    Refresh,
    Test,
    Tick,
    NewServer,
    ServerName(String),
    CreateServer,
    Cancel,
    Server(uuid::Uuid),
    Channel(uuid::Uuid),
    Draft(String),
    Send,
    Delete(uuid::Uuid),
    Mute,
    Deafen,
    Drag,
    Minimize,
    Maximize,
    Close,
    MarkNotes,
    Noop,
    SmokeStep(u8),
    Captured(u8, iced::window::Screenshot),
    Ready(iced::window::Id),
    Backdrop(bool),
    BenchmarkReady(iced::window::Screenshot),
}
struct App {
    store: Store,
    profile: Profile,
    editing: Profile,
    page: Page,
    section: Section,
    communities: Vec<Community>,
    channels: Vec<Channel>,
    messages: Vec<ChatMessage>,
    server: Option<uuid::Uuid>,
    channel: Option<uuid::Uuid>,
    draft: String,
    modal: bool,
    server_name: String,
    status: String,
    devices: Vec<AudioDevice>,
    control: Arc<VoiceControl>,
    mic_test: Option<MicrophoneTest>,
    atmosphere: art::Atmosphere,
    notes_pending: bool,
    smoke_dir: Option<std::path::PathBuf>,
    backdrop: bool,
    ready_file: Option<std::path::PathBuf>,
}
impl App {
    fn new() -> (Self, Task<Msg>) {
        let args: Vec<String> = std::env::args().collect();
        let smoke_dir = args
            .windows(2)
            .find(|w| w[0] == "--smoke-dir")
            .map(|w| std::path::PathBuf::from(&w[1]));
        let task = if smoke_dir.is_some() {
            Task::perform(
                async {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    0
                },
                Msg::SmokeStep,
            )
        } else {
            Task::none()
        };
        let path = voxy_core::data_directory().expect("Pasta experimental indisponível");
        let store =
            Store::open(&path.join("voxy.sqlite")).expect("Banco experimental indisponível");
        let profile = store.profile().expect("Perfil experimental inválido");
        let communities = store.communities().unwrap_or_default();
        let devices = voxy_voice::devices::enumerate().unwrap_or_default();
        let notes_pending = !store.release_seen(voxy_core::VERSION).unwrap_or(false);
        (
            Self {
                store,
                profile: profile.clone(),
                editing: profile,
                page: Page::Home,
                section: Section::Profile,
                communities,
                channels: vec![],
                messages: vec![],
                server: None,
                channel: None,
                draft: String::new(),
                modal: false,
                server_name: String::new(),
                status: String::new(),
                devices,
                control: Arc::new(VoiceControl::default()),
                mic_test: None,
                atmosphere: Default::default(),
                notes_pending,
                smoke_dir,
                backdrop: false,
                ready_file: args
                    .windows(2)
                    .find(|w| w[0] == "--ready-file")
                    .map(|w| std::path::PathBuf::from(&w[1])),
            },
            task,
        )
    }
    fn smoke_captured(&mut self, step: u8, shot: iced::window::Screenshot) -> Task<Msg> {
        let Some(directory) = self.smoke_dir.clone() else {
            return Task::none();
        };
        let labels = [
            "home",
            "create-space",
            "chat",
            "profile",
            "audio",
            "appearance",
            "kuromi",
            "news",
            "home-900",
        ];
        let result = (|| -> anyhow::Result<()> {
            std::fs::create_dir_all(&directory)?;
            let file =
                std::fs::File::create(directory.join(format!("{}.png", labels[step as usize])))?;
            let mut encoder = png::Encoder::new(
                std::io::BufWriter::new(file),
                shot.size.width,
                shot.size.height,
            );
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.write_header()?.write_image_data(&shot.rgba)?;
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("QA: {error}");
            return iced::exit();
        }
        match step {
            0 => {
                let _ = self.update(Msg::NewServer);
            }
            1 => {
                let _ = self.update(Msg::ServerName("Núcleo de amigos".into()));
                let _ = self.update(Msg::CreateServer);
                let _ = self.update(Msg::Draft(
                    "Outra frequência. A primeira conversa no Voxy nativo.".into(),
                ));
                let _ = self.update(Msg::Send);
            }
            2 => {
                let _ = self.update(Msg::Navigate(Page::Settings));
            }
            3 => {
                let _ = self.update(Msg::Section(Section::Audio));
            }
            4 => {
                let _ = self.update(Msg::Section(Section::Appearance));
            }
            5 => {
                let _ = self.update(Msg::Theme(ProfileTheme::Kuromi));
            }
            6 => {
                let _ = self.update(Msg::Navigate(Page::News));
            }
            7 => {
                let _ = self.update(Msg::MarkNotes);
                let _ = self.update(Msg::Navigate(Page::Home));
                return Task::batch([
                    iced::window::latest()
                        .and_then(|id| iced::window::resize(id, iced::Size::new(900.0, 640.0))),
                    Task::perform(
                        async {
                            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                            8
                        },
                        Msg::SmokeStep,
                    ),
                ]);
            }
            _ => {
                let report = serde_json::json!({"version":voxy_core::VERSION,"nativeRenderer":"Iced/tiny-skia","windowsBackdropAccepted":self.backdrop,"screenshots":labels,"spaces":self.communities.len(),"messages":self.messages.len(),"releaseAcknowledged":self.store.release_seen(voxy_core::VERSION).unwrap_or(false),"microphoneOpened":false,"publicNetwork":false,"actions":"internal application messages, no Windows input automation"});
                let _ = std::fs::write(
                    directory.join("ui-smoke.json"),
                    serde_json::to_vec_pretty(&report).unwrap(),
                );
                return iced::exit();
            }
        }
        Task::perform(
            async move {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                step + 1
            },
            Msg::SmokeStep,
        )
    }
    fn palette(&self) -> Materials {
        let profile = if self.page == Page::Settings {
            &self.editing
        } else {
            &self.profile
        };
        let mut m = Materials::new(profile.theme);
        m.reduced = profile.low_resource_mode;
        m
    }
    fn subscription(&self) -> Subscription<Msg> {
        Subscription::batch([
            iced::window::open_events().map(Msg::Ready),
            if self.mic_test.is_some() {
                iced::time::every(std::time::Duration::from_millis(100)).map(|_| Msg::Tick)
            } else {
                Subscription::none()
            },
        ])
    }
    fn update(&mut self, msg: Msg) -> Task<Msg> {
        match msg {
            Msg::Navigate(page) => {
                self.mic_test = None;
                if page == Page::Settings {
                    self.editing = self.profile.clone();
                }
                self.page = page;
                self.atmosphere.cache.clear();
                self.status.clear();
                self.control.set_gain(self.profile.input_volume);
                let reduced = self.profile.low_resource_mode;
                return iced::window::latest()
                    .and_then(move |id| {
                        iced::window::run(id, move |window| platform::set_backdrop(window, reduced))
                    })
                    .map(Msg::Backdrop);
            }
            Msg::AudioSettings => {
                self.section = Section::Audio;
                return self.update(Msg::Navigate(Page::Settings));
            }
            Msg::Section(section) => {
                self.mic_test = None;
                self.section = section;
            }
            Msg::Name(name) => self.editing.name = name,
            Msg::Save => match self.store.save_profile(&self.editing) {
                Ok(()) => {
                    self.profile = self.editing.clone();
                    self.status = "Preferências salvas neste computador.".into();
                }
                Err(error) => self.status = error.to_string(),
            },
            Msg::Theme(theme) => {
                self.editing.theme = theme;
                self.atmosphere.cache.clear();
            }
            Msg::Low(value) => {
                self.editing.low_resource_mode = value;
                self.atmosphere.cache.clear();
                return iced::window::latest()
                    .and_then(move |id| {
                        iced::window::run(id, move |window| platform::set_backdrop(window, value))
                    })
                    .map(Msg::Backdrop);
            }
            Msg::Gain(gain) => {
                self.editing.input_volume = gain;
                self.control.set_gain(gain);
            }
            Msg::Ptt(value) => self.editing.ptt_enabled = value,
            Msg::PttKey(key) => self.editing.ptt_key = key,
            Msg::Input(id) => {
                self.mic_test = None;
                self.editing.input = id;
            }
            Msg::Output(id) => {
                self.mic_test = None;
                self.editing.output = id;
            }
            Msg::Refresh => match voxy_voice::devices::enumerate() {
                Ok(devices) => self.devices = devices,
                Err(error) => self.status = error.to_string(),
            },
            Msg::Test => {
                if self.mic_test.is_some() {
                    self.mic_test = None;
                    self.status = "Teste encerrado. Microfone liberado.".into();
                } else {
                    self.control.device_failed.store(false, Ordering::Release);
                    self.control.set_gain(self.editing.input_volume);
                    match MicrophoneTest::start(
                        self.editing.input.clone(),
                        self.editing.output.clone(),
                        self.control.clone(),
                    ) {
                        Ok(test) => {
                            self.mic_test = Some(test);
                            self.status =
                                "Teste privado ativo. Use fones para evitar retorno.".into();
                        }
                        Err(error) => self.status = error.to_string(),
                    }
                }
            }
            Msg::Tick => {
                if self.control.device_failed.load(Ordering::Acquire) {
                    self.mic_test = None;
                    self.status =
                        "Dispositivo desconectado. Escolha a entrada e tente novamente.".into();
                }
            }
            Msg::NewServer => {
                self.modal = true;
                self.server_name.clear();
            }
            Msg::ServerName(name) => self.server_name = name,
            Msg::Cancel => self.modal = false,
            Msg::CreateServer => match self
                .store
                .create_community(self.profile.id, &self.server_name)
            {
                Ok(server) => {
                    self.modal = false;
                    self.communities = self.store.communities().unwrap_or_default();
                    self.open_server(server.id);
                }
                Err(error) => self.status = error.to_string(),
            },
            Msg::Server(id) => self.open_server(id),
            Msg::Channel(id) => {
                if self
                    .channels
                    .iter()
                    .any(|c| c.id == id && c.kind == ChannelKind::Text)
                {
                    self.channel = Some(id);
                    self.messages = self.store.messages(id, None).unwrap_or_default();
                } else {
                    self.status =
                        "A chamada pública está em implementação. O microfone não foi aberto."
                            .into();
                }
            }
            Msg::Draft(value) => self.draft = value,
            Msg::Send => {
                if let Some(channel) = self.channel {
                    match self
                        .store
                        .post(channel, self.profile.id, &self.profile.name, &self.draft)
                    {
                        Ok(_) => {
                            self.draft.clear();
                            self.messages = self.store.messages(channel, None).unwrap_or_default();
                        }
                        Err(error) => self.status = error.to_string(),
                    }
                }
            }
            Msg::Delete(id) => match self.store.delete_message(id, self.profile.id) {
                Ok(()) => {
                    if let Some(channel) = self.channel {
                        self.messages = self.store.messages(channel, None).unwrap_or_default();
                    }
                }
                Err(error) => self.status = error.to_string(),
            },
            Msg::Mute => {
                self.control.muted.fetch_xor(true, Ordering::Relaxed);
            }
            Msg::Deafen => {
                self.control.deafened.fetch_xor(true, Ordering::Relaxed);
            }
            Msg::Drag => return iced::window::latest().and_then(iced::window::drag),
            Msg::Minimize => {
                return iced::window::latest().and_then(|id| iced::window::minimize(id, true));
            }
            Msg::Maximize => return iced::window::latest().and_then(iced::window::toggle_maximize),
            Msg::Close => {
                self.mic_test = None;
                return iced::exit();
            }
            Msg::MarkNotes => {
                if let Err(error) = self.store.mark_release(voxy_core::VERSION) {
                    self.status = error.to_string();
                } else {
                    self.notes_pending = false;
                }
            }
            Msg::Ready(id) => {
                let reduced = self.profile.low_resource_mode;
                return iced::window::run(id, move |window| {
                    platform::set_backdrop(window, reduced)
                })
                .map(Msg::Backdrop);
            }
            Msg::Backdrop(active) => {
                self.backdrop = active;
                if self.ready_file.is_some() {
                    return iced::window::latest()
                        .and_then(|id| iced::window::screenshot(id).map(Msg::BenchmarkReady));
                }
            }
            Msg::BenchmarkReady(shot) => {
                if let Some(path) = self.ready_file.take() {
                    let _=std::fs::write(path,serde_json::to_vec(&serde_json::json!({"rendered":true,"width":shot.size.width,"height":shot.size.height,"backdropAccepted":self.backdrop})).unwrap());
                    if std::env::args().any(|arg| arg == "--start-minimized") {
                        return self.update(Msg::Minimize);
                    }
                }
            }
            Msg::Noop => {}
            Msg::SmokeStep(step) => {
                return iced::window::latest().and_then(move |id| {
                    iced::window::screenshot(id).map(move |shot| Msg::Captured(step, shot))
                });
            }
            Msg::Captured(step, shot) => return self.smoke_captured(step, shot),
        }
        Task::none()
    }
    fn open_server(&mut self, id: uuid::Uuid) {
        self.server = Some(id);
        self.channels = self.store.channels(id).unwrap_or_default();
        self.channel = self
            .channels
            .iter()
            .find(|c| c.kind == ChannelKind::Text)
            .map(|c| c.id);
        self.messages = self
            .channel
            .and_then(|id| self.store.messages(id, None).ok())
            .unwrap_or_default();
        self.page = Page::Chat;
    }
    fn heading<'a>(&self, title: &'a str, subtitle: &'a str) -> Element<'a, Msg> {
        let m = self.palette();
        column![
            text(title).size(30).font(bold()),
            text(subtitle).size(14).color(m.muted)
        ]
        .spacing(8)
        .into()
    }
    fn action<'a>(&self, label: &'a str, msg: Msg, primary: bool) -> widget::Button<'a, Msg> {
        button(text(label).size(14))
            .padding([12, 19])
            .style(self.palette().button(primary))
            .on_press(msg)
    }
    fn sidebar(&self) -> Element<'_, Msg> {
        let m = self.palette();
        let mut nav = column![
            container(text("v").font(bold()).size(38).color(m.accent))
                .center_x(Fill)
                .padding([8, 0])
        ]
        .spacing(9);
        for (icon, label, page) in [
            (art::NavIcon::Home, "Início", Page::Home),
            (art::NavIcon::Conversation, "Conversas", Page::Chat),
            (art::NavIcon::News, "Novidades", Page::News),
            (art::NavIcon::Settings, "Ajustes", Page::Settings),
        ] {
            let selected = self.page == page;
            nav = nav.push(
                button(
                    column![
                        widget::canvas(art::Icon(icon, if selected { m.accent } else { m.muted }))
                            .width(24)
                            .height(24),
                        text(label).size(10)
                    ]
                    .spacing(4)
                    .align_x(iced::Center),
                )
                .width(Fill)
                .padding([11, 3])
                .style(move |_, status| widget::button::Style {
                    background: Some(
                        alpha(
                            m.accent,
                            if selected {
                                0.16
                            } else if matches!(status, widget::button::Status::Hovered) {
                                0.08
                            } else {
                                0.0
                            },
                        )
                        .into(),
                    ),
                    text_color: if selected { m.accent } else { m.muted },
                    border: Border {
                        radius: 14.0.into(),
                        width: if selected { 1.0 } else { 0.0 },
                        color: alpha(m.accent, 0.22),
                    },
                    ..Default::default()
                })
                .on_press(Msg::Navigate(page)),
            );
        }
        nav = nav.push(space::vertical().height(18));
        for server in &self.communities {
            nav = nav.push(
                button(text(server.name.chars().next().unwrap_or('V').to_string()).size(18))
                    .width(Fill)
                    .padding(12)
                    .style(m.button(false))
                    .on_press(Msg::Server(server.id)),
            );
        }
        nav = nav
            .push(self.action("+", Msg::NewServer, false).width(Fill))
            .push(space::vertical())
            .push(
                container(
                    text(self.profile.name.chars().next().unwrap_or('V'))
                        .size(19)
                        .font(bold()),
                )
                .width(Fill)
                .height(42)
                .align_x(iced::Center)
                .align_y(iced::Center)
                .style(move |_| container::Style {
                    background: Some(alpha(m.secondary, 0.18).into()),
                    border: Border {
                        radius: 21.0.into(),
                        color: alpha(m.secondary, 0.4),
                        width: 1.0,
                    },
                    ..Default::default()
                }),
            );
        container(nav)
            .width(88)
            .padding([16, 12])
            .height(Fill)
            .style(move |_| container::Style {
                background: Some(alpha(m.base, 0.67).into()),
                border: Border {
                    color: m.border,
                    width: 1.0,
                    radius: 0.0.into(),
                },
                ..Default::default()
            })
            .into()
    }
    fn home(&self) -> Element<'_, Msg> {
        let m = self.palette();
        let hero_text = column![
            text("Seu grupo.\nOutra frequência.")
                .font(bold())
                .size(48)
                .line_height(1.1),
            text("O lugar para conversar, jogar e ficar por perto.")
                .size(16)
                .color(m.muted),
            space::vertical().height(12),
            row![
                self.action("Criar meu espaço", Msg::NewServer, true),
                self.action("Configurar minha voz", Msg::AudioSettings, false)
            ]
            .spacing(10)
        ]
        .spacing(17)
        .width(Fill);
        let hero = container(
            row![
                hero_text,
                widget::canvas(art::Frequency(m))
                    .width(Fixed(300.0))
                    .height(300)
            ]
            .align_y(iced::Center),
        )
        .padding([36, 38])
        .style(move |_| m.glass(true));
        let mut spaces = column![
            row![
                text("Seus espaços").size(22).font(bold()),
                space::horizontal(),
                self.action("Criar espaço", Msg::NewServer, false)
            ]
            .align_y(iced::Center)
        ]
        .spacing(16);
        if self.communities.is_empty() {
            spaces=spaces.push(container(column![text("A próxima conversa começa aqui.").size(20),text("Crie um espaço para organizar seus canais. A conexão pública está em desenvolvimento.").size(14).color(m.muted),self.action("Criar primeiro espaço",Msg::NewServer,false)].spacing(14)).padding(24).width(Fill).style(move|_|m.glass(false)));
        } else {
            for server in &self.communities {
                spaces = spaces.push(
                    button(
                        row![
                            container(
                                text(server.name.chars().next().unwrap_or('V'))
                                    .size(25)
                                    .color(m.accent)
                            )
                            .padding(12),
                            column![
                                text(&server.name).font(bold()).size(18),
                                text("Espaço salvo neste computador")
                                    .size(12)
                                    .color(m.muted)
                            ]
                            .spacing(5),
                            space::horizontal(),
                            text("Abrir").color(m.accent)
                        ]
                        .align_y(iced::Center),
                    )
                    .padding(20)
                    .width(Fill)
                    .style(m.button(false))
                    .on_press(Msg::Server(server.id)),
                );
            }
        }
        let note=container(row![text("✧").size(30).color(m.secondary),column![text("Uma nova fase do Voxy").size(18).font(bold()),text("Aplicativo nativo em desenvolvimento. Seus dados da 1.4.1 permanecem separados.").size(13).color(m.muted)].spacing(6),space::horizontal(),self.action("Ver novidades",Msg::Navigate(Page::News),false)].spacing(18).align_y(iced::Center)).padding(22).style(move|_|m.glass(false));
        scrollable(
            column![
                row![
                    text(format!("Boa conversa, {}.", self.profile.name))
                        .size(15)
                        .color(m.muted),
                    space::horizontal(),
                    text("Voxy 2.0 · Experimental").size(12).color(m.secondary)
                ],
                hero,
                spaces,
                note
            ]
            .spacing(26)
            .padding([24, 32]),
        )
        .height(Fill)
        .into()
    }
    fn chat(&self) -> Element<'_, Msg> {
        let m = self.palette();
        if self.server.is_none() {
            return container(
                column![
                    self.heading(
                        "Suas conversas",
                        "Escolha um espaço na lateral ou crie o primeiro."
                    ),
                    self.action("Criar espaço", Msg::NewServer, true)
                ]
                .spacing(24),
            )
            .padding(36)
            .into();
        }
        let server = self
            .communities
            .iter()
            .find(|s| Some(s.id) == self.server)
            .map(|s| s.name.as_str())
            .unwrap_or("Seu espaço");
        let mut channels = column![
            text(server).size(20).font(bold()),
            text("Canais").size(12).color(m.muted),
            space::vertical().height(10)
        ]
        .spacing(8);
        for channel in &self.channels {
            channels = channels.push(
                self.action(
                    &channel.name,
                    Msg::Channel(channel.id),
                    Some(channel.id) == self.channel,
                )
                .width(Fill),
            );
        }
        channels = channels.push(space::vertical()).push(
            text("Histórico local\nConexão pública em implementação")
                .size(12)
                .color(m.muted),
        );
        let mut history = column![].spacing(20);
        for message in &self.messages {
            history = history.push(
                row![
                    container(text(message.name.chars().next().unwrap_or('V')).color(m.secondary))
                        .padding(10)
                        .style(move |_| m.glass(false)),
                    column![
                        row![
                            text(&message.name).font(bold()).size(14),
                            text(if message.edited_at.is_some() {
                                "editada"
                            } else {
                                "agora"
                            })
                            .size(11)
                            .color(m.muted)
                        ]
                        .spacing(12),
                        text(&message.text).size(15)
                    ]
                    .spacing(6)
                    .width(Fill),
                    button(text("×").size(16))
                        .on_press(Msg::Delete(message.id))
                        .style(m.button(false))
                ]
                .spacing(12),
            );
        }
        if self.messages.is_empty() {
            history = history.push(
                column![
                    text("Abra a conversa.").size(30).font(bold()),
                    text("As mensagens deste espaço ficam salvas neste computador.").color(m.muted)
                ]
                .spacing(12)
                .padding(24),
            );
        }
        let channel_name = self
            .channels
            .iter()
            .find(|c| Some(c.id) == self.channel)
            .map(|c| c.name.as_str())
            .unwrap_or("conversa");
        let body = column![
            container(row![
                text(format!("# {channel_name}")).size(20).font(bold()),
                space::horizontal(),
                text("Só neste computador").color(m.muted).size(12)
            ])
            .padding([22, 26]),
            scrollable(history.padding(26)).height(Fill),
            container(
                row![
                    text_input("Escreva uma mensagem…", &self.draft)
                        .on_input(Msg::Draft)
                        .on_submit(Msg::Send)
                        .padding(15)
                        .style(m.input()),
                    self.action("Enviar", Msg::Send, true)
                ]
                .spacing(10)
            )
            .padding(20)
        ]
        .width(Fill);
        row![
            container(channels)
                .width(230)
                .padding(20)
                .height(Fill)
                .style(move |_| m.glass(false)),
            body
        ]
        .spacing(12)
        .padding(20)
        .into()
    }
    fn settings(&self) -> Element<'_, Msg> {
        let m = self.palette();
        let mut nav = column![
            text("Do seu jeito.").size(26).font(bold()),
            text("Sua experiência no Voxy").size(13).color(m.muted),
            space::vertical().height(15)
        ]
        .spacing(10);
        for (label, section) in [
            ("Seu perfil", Section::Profile),
            ("Áudio e voz", Section::Audio),
            ("Aparência", Section::Appearance),
            ("Privacidade", Section::Privacy),
        ] {
            nav = nav.push(
                self.action(label, Msg::Section(section), self.section == section)
                    .width(Fill),
            );
        }
        let content:Element<'_,Msg>=match self.section{
        Section::Profile=>column![self.heading("Seu perfil","Como você aparece para o seu grupo."),text("Nome").size(13).color(m.muted),text_input("Seu nome",&self.editing.name).on_input(Msg::Name).padding(14).style(m.input()),text("Sua identidade é persistente neste computador. A importação da 1.x é uma ação separada.").color(m.muted).size(13)].spacing(20).into(),
        Section::Appearance=>{let mut themes=row![].spacing(10);for(label,theme)in[("Voxy",ProfileTheme::Voxy),("Oceano",ProfileTheme::Ocean),("Bosque",ProfileTheme::Forest),("Kuromi",ProfileTheme::Kuromi)]{themes=themes.push(self.action(label,Msg::Theme(theme),self.editing.theme==theme));}column![self.heading("Luz, cor e camadas.","Vidro escuro, contraste confortável e uma frequência sua."),themes,container(column![text("Conversa que fica por perto.").size(24).font(bold()),text("Uma prévia das superfícies, reflexos e cores do tema.").color(m.muted),row![self.action("Ação principal",Msg::Noop,true),self.action("Ação secundária",Msg::Noop,false)].spacing(12)].spacing(18)).padding(26).style(move|_|m.glass(true)),checkbox(self.editing.low_resource_mode).label("Reduzir efeitos visuais").on_toggle(Msg::Low),text("A interface redesenha quando algo muda. Não há animação permanente na Home.").size(13).color(m.muted)].spacing(24).into()},
        Section::Audio=>{let inputs:Vec<String>=std::iter::once("Padrão do Windows".into()).chain(self.devices.iter().filter(|d|d.input).map(|d|d.name.clone())).collect();let outputs:Vec<String>=std::iter::once("Padrão do Windows".into()).chain(self.devices.iter().filter(|d|!d.input).map(|d|d.name.clone())).collect();let input=self.devices.iter().find(|d|d.id==self.editing.input).map(|d|d.name.clone()).unwrap_or_else(||"Padrão do Windows".into());let output=self.devices.iter().find(|d|d.id==self.editing.output).map(|d|d.name.clone()).unwrap_or_else(||"Padrão do Windows".into());let in_devices=self.devices.clone();let out_devices=self.devices.clone();column![self.heading("Sua voz, em primeiro plano.","Escolha os dispositivos e faça um teste só para você."),row![column![text("Microfone").size(13).color(m.muted),pick_list(inputs,Some(input),move|name|Msg::Input(in_devices.iter().find(|d|d.input&&d.name==name).map(|d|d.id.clone()).unwrap_or_default())).padding(12).width(Fill)].spacing(9).width(Fill),column![text("Saída de áudio").size(13).color(m.muted),pick_list(outputs,Some(output),move|name|Msg::Output(out_devices.iter().find(|d|!d.input&&d.name==name).map(|d|d.id.clone()).unwrap_or_default())).padding(12).width(Fill)].spacing(9).width(Fill)].spacing(18),row![text(format!("Volume do microfone  {}%",(self.editing.input_volume*100.0)as i32)).size(14),space::horizontal(),self.action("Atualizar dispositivos",Msg::Refresh,false)],slider(0.0..=2.0,self.editing.input_volume,Msg::Gain).step(0.01_f32),row![self.action(if self.mic_test.is_some(){"Parar teste privado"}else{"Testar meu microfone"},Msg::Test,true),widget::progress_bar(0.0..=0.4,self.control.level()).length(Fill)].spacing(20).align_y(iced::Center),text("Use fones durante o teste. Este caminho ainda não tem cancelamento de eco e não transmite áudio pela rede.").size(13).color(m.muted),checkbox(self.editing.ptt_enabled).label("Push-to-Talk nas chamadas").on_toggle(Msg::Ptt),pick_list(vec!["Mouse4".to_string(),"Mouse5".to_string(),"Space".to_string(),"F8".to_string(),"F9".to_string()],Some(self.editing.ptt_key.clone()),Msg::PttKey).padding(10),text("PTT e sensibilidade são preferências em preparação; o teste privado continua isolado da chamada.").size(12).color(m.muted)].spacing(19).into()},
        Section::Privacy=>column![self.heading("Seu espaço, seus dados.","Clareza sobre o que está ativo nesta versão experimental."),text("Dados nativos ficam em uma pasta própria. Os dados da 1.4.1 não são convertidos automaticamente.").size(15),text("O microfone só abre ao iniciar o teste privado. Não há envio de mídia na Home.").size(15),text("Rede pública e convites estão em implementação. TURN permanece bloqueado até validar proteção contra cobranças. Nenhum serviço pago é ativado pelo aplicativo.").size(15),text("P2P pode revelar o IP aos participantes. Essa condição será apresentada antes da primeira conexão pública.").size(14).color(m.muted)].spacing(24).into()};
        row![
            container(nav)
                .width(230)
                .padding(24)
                .height(Fill)
                .style(move |_| m.glass(false)),
            container(
                column![
                    scrollable(content).height(Fill),
                    row![
                        text("Alterações são aplicadas ao salvar.")
                            .size(12)
                            .color(m.muted),
                        space::horizontal(),
                        self.action("Desfazer", Msg::Navigate(Page::Settings), false),
                        self.action("Salvar alterações", Msg::Save, true)
                    ]
                    .spacing(12)
                    .align_y(iced::Center)
                ]
                .spacing(24)
            )
            .padding(30)
            .width(Fill)
            .height(Fill)
            .style(move |_| m.glass(false))
        ]
        .spacing(16)
        .padding(24)
        .into()
    }
    fn news(&self) -> Element<'_, Msg> {
        let m = self.palette();
        scrollable(column![self.heading("Uma nova frequência.","Voxy 2.0 em desenvolvimento · 16 de novembro de 2026"),container(column![text("O começo da aplicação nativa.").size(28).font(bold()),text("Identidade persistente, banco local, espaços, canais e mensagens. Uma interface nova, com vidro escuro e profundidade."),text("O teste privado do microfone usa áudio nativo. Chamadas públicas, transmissão, salas 3D e jogos continuam em implementação.").color(m.muted),text("A 1.4.1 segue sendo a distribuição estável. Nenhuma atualização é publicada automaticamente.").color(m.muted)].spacing(22)).padding(32).style(move|_|m.glass(true)),if self.notes_pending{self.action("Entendi, vamos lá",Msg::MarkNotes,true)}else{self.action("Voltar ao início",Msg::Navigate(Page::Home),false)}].spacing(28).padding(36)).into()
    }
    fn view(&self) -> Element<'_, Msg> {
        let m = self.palette();
        let titlebar = row![
            mouse_area(
                container(row![
                    text("voxy").font(bold()).size(15),
                    text("2.0").color(m.secondary).size(11),
                    space::horizontal()
                ])
                .padding([12, 22])
                .width(Fill)
            )
            .on_press(Msg::Drag),
            self.action("−", Msg::Minimize, false),
            self.action("□", Msg::Maximize, false),
            self.action("×", Msg::Close, false)
        ]
        .spacing(4)
        .align_y(iced::Center)
        .height(44);
        let page = match self.page {
            Page::Home => self.home(),
            Page::Chat => self.chat(),
            Page::Settings => self.settings(),
            Page::News => self.news(),
        };
        let status = if self.status.is_empty() {
            "Experiência nativa em desenvolvimento"
        } else {
            &self.status
        };
        let footer = container(
            row![
                text("●").color(design::rgb(0x95dbb6)).size(9),
                text(status).size(12).color(m.muted),
                space::horizontal(),
                self.action(
                    if self.control.muted.load(Ordering::Relaxed) {
                        "Mic mudo"
                    } else {
                        "Microfone"
                    },
                    Msg::Mute,
                    false
                ),
                self.action(
                    if self.control.deafened.load(Ordering::Relaxed) {
                        "Áudio mudo"
                    } else {
                        "Áudio"
                    },
                    Msg::Deafen,
                    false
                )
            ]
            .spacing(10)
            .align_y(iced::Center),
        )
        .padding([8, 22]);
        let shell = column![
            titlebar,
            row![
                self.sidebar(),
                column![page, footer].height(Fill).width(Fill)
            ]
            .height(Fill)
        ]
        .height(Fill);
        let content: Element<'_, Msg> = stack![self.atmosphere.view(m), shell].into();
        if self.modal {
            stack![content,container(container(column![row![text("Crie seu espaço.").font(bold()).size(28),space::horizontal(),self.action("×",Msg::Cancel,false)],text("Um lugar para o seu grupo, com canais de texto e voz.").size(14).color(m.muted),text_input("Nome do espaço",&self.server_name).on_input(Msg::ServerName).on_submit(Msg::CreateServer).padding(15).style(m.input()),text("Este incremento cria o espaço local. Convites públicos ainda não estão disponíveis.").color(m.muted).size(12),row![space::horizontal(),self.action("Cancelar",Msg::Cancel,false),self.action("Criar espaço",Msg::CreateServer,true)].spacing(10)].spacing(22)).padding(32).width(530).style(move|_|m.glass(true))).center(Fill).width(Fill).height(Fill).style(|_|container::Style{background:Some(alpha(Color::BLACK,0.65).into()),..Default::default()})].into()
        } else {
            content
        }
    }
}
fn bold() -> Font {
    Font {
        weight: iced::font::Weight::Semibold,
        ..Font::with_name("Segoe UI")
    }
}
fn main() -> iced::Result {
    iced::application(App::new, App::update, App::view)
        .title("Voxy 2.0 - Nativo")
        .transparent(true)
        .theme(Theme::Dark)
        .style(|app, _| iced::theme::Style {
            background_color: alpha(
                app.palette().base,
                if app.profile.low_resource_mode {
                    1.0
                } else {
                    0.76
                },
            ),
            text_color: app.palette().ink,
        })
        .subscription(App::subscription)
        .default_font(Font::with_name("Segoe UI"))
        .window(iced::window::Settings {
            size: iced::Size::new(1240.0, 820.0),
            min_size: Some(iced::Size::new(900.0, 640.0)),
            decorations: false,
            ..Default::default()
        })
        .centered()
        .run()
}
