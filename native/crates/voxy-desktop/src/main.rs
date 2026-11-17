#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod art;
mod bridge;
mod chrome;
mod design;
mod fixtures;
mod platform;
mod qa;
mod screens;
use design::{Materials, alpha};
use iced::{
    Border, Color, Element, Font,
    Length::Fill,
    Subscription, Task, Theme,
    widget::{
        self, button, column, container, mouse_area, pick_list, row, scrollable, slider, space,
        stack, text, text_input,
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
    ServerSettings,
    Direct,
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
    ServiceConnected(tokio::sync::mpsc::Sender<voxy_core::ipc::Request>),
    ServiceState(Box<voxy_core::ipc::State>),
    ServiceError(String),
    JoinDialog,
    InviteText(String),
    EndpointText(String),
    StunText(String),
    JoinRemote,
    HostRemote,
    Disconnect,
    LeaveVoice,
    CopyInvite,
    Search(String),
    MessageMenu(uuid::Uuid),
    MessageHover(Option<uuid::Uuid>),
    EditMessage(uuid::Uuid),
    CancelEdit,
    ManageServer,
    AdminRename,
    AdminCreate(ChannelKind),
    AdminRemove(uuid::Uuid),
    AdminDelete,
    FriendId(String),
    FriendRequest,
    FriendRespond(uuid::Uuid, bool),
    FriendRemove(uuid::Uuid),
    Direct(uuid::Uuid),
    DirectSend,
    Reconnect(uuid::Uuid),
    PeerVolume(u64, f32),
    Navigate(Page),
    AudioSettings,
    ProfileSettings,
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
    WindowResized(iced::window::Id),
    Maximized(bool),
    Geometry(u8, Vec<qa::Bounds>),
    Close,
    MarkNotes,
    SmokeStep(u8),
    Captured(u8, iced::window::Screenshot),
    Ready(iced::window::Id),
    Backdrop(bool),
    BenchmarkReady(iced::window::Screenshot),
}
struct App {
    service: Option<tokio::sync::mpsc::Sender<voxy_core::ipc::Request>>,
    remote: voxy_core::ipc::State,
    join_dialog: bool,
    invite_text: String,
    endpoint: String,
    stun_text: String,
    search: String,
    message_menu: Option<uuid::Uuid>,
    message_hover: Option<uuid::Uuid>,
    editing_message: Option<uuid::Uuid>,
    pending_message: Option<voxy_core::room::Command>,
    friend_id: String,
    direct_peer: Option<uuid::Uuid>,
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
    maximized: bool,
    geometry_failures: usize,
    geometry_nodes: usize,
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
        if smoke_dir.is_some() {
            assert!(
                std::env::var_os("VOXY_NATIVE_DATA_DIR").is_some()
                    && !path.join("voxy.sqlite").exists(),
                "QA exige pasta experimental explícita e vazia"
            );
        }
        let store =
            Store::open(&path.join("voxy.sqlite")).expect("Banco experimental indisponível");
        let fixture = if smoke_dir.is_some() {
            Some(fixtures::seed(&path).expect("Fixture visual inválida"))
        } else {
            None
        };
        let profile = store.profile().expect("Perfil experimental inválido");
        let mut communities = store.communities().unwrap_or_default();
        for server in store.recent_servers().unwrap_or_default() {
            if !communities.iter().any(|s| s.id == server.id) {
                communities.push(server);
            }
        }
        let endpoint = std::env::var("VOXY_SIGNAL_URL").unwrap_or_else(|_| {
            profile
                .retained
                .get("signalUrl")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .into()
        });
        let stun_text = std::env::var("VOXY_STUN_URLS").unwrap_or_else(|_| {
            profile
                .retained
                .get("stunUrls")
                .and_then(|v| v.as_str())
                .unwrap_or("stun:stun.cloudflare.com:3478")
                .into()
        });
        let devices = voxy_voice::devices::enumerate().unwrap_or_default();
        let notes_pending = !store.release_seen(voxy_core::VERSION).unwrap_or(false);
        (
            Self {
                service: None,
                remote: voxy_core::ipc::State {
                    phase: if fixture.is_some() {
                        "Fixture visual · sem áudio ou rede".into()
                    } else {
                        String::new()
                    },
                    snapshot: fixture.clone(),
                    ..Default::default()
                },
                join_dialog: false,
                invite_text: String::new(),
                endpoint,
                stun_text,
                search: String::new(),
                message_menu: None,
                message_hover: None,
                editing_message: None,
                pending_message: None,
                friend_id: String::new(),
                direct_peer: None,
                store,
                profile: profile.clone(),
                editing: profile,
                page: Page::Home,
                section: Section::Profile,
                communities,
                channels: fixture
                    .as_ref()
                    .map(|f| f.channels.clone())
                    .unwrap_or_default(),
                messages: fixture
                    .as_ref()
                    .map(|f| f.messages.clone())
                    .unwrap_or_default(),
                server: fixture.as_ref().map(|f| f.server.id),
                channel: fixture.as_ref().and_then(|f| {
                    f.channels
                        .iter()
                        .find(|c| c.kind == ChannelKind::Text)
                        .map(|c| c.id)
                }),
                draft: String::new(),
                modal: false,
                server_name: String::new(),
                status: if fixture.is_some() {
                    "Fixture visual · sem áudio ou rede".into()
                } else {
                    String::new()
                },
                devices,
                control: Arc::new(VoiceControl::default()),
                mic_test: None,
                atmosphere: Default::default(),
                notes_pending,
                smoke_dir,
                backdrop: false,
                maximized: false,
                geometry_failures: 0,
                geometry_nodes: 0,
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
            "chat-menu",
            "server-settings",
            "direct",
            "ocean",
            "forest",
            "join-invite",
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
                if let Some(snapshot) = &self.remote.snapshot {
                    self.open_server(snapshot.server.id);
                }
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
            8 => {
                if let Some(snapshot) = &self.remote.snapshot {
                    self.open_server(snapshot.server.id);
                }
                if let Some(message) = self.messages.iter().find(|m| m.author == self.profile.id) {
                    self.message_menu = Some(message.id);
                }
            }
            9 => {
                let _ = self.update(Msg::ManageServer);
            }
            10 => {
                if let Some(friend) = self
                    .remote
                    .snapshot
                    .as_ref()
                    .and_then(|s| s.friends.iter().find(|f| f.accepted))
                {
                    let peer = if friend.requester == self.profile.id {
                        friend.recipient
                    } else {
                        friend.requester
                    };
                    let _ = self.update(Msg::Direct(peer));
                }
            }
            11 => {
                let _ = self.update(Msg::Navigate(Page::Settings));
                let _ = self.update(Msg::Section(Section::Appearance));
                let _ = self.update(Msg::Theme(ProfileTheme::Ocean));
            }
            12 => {
                let _ = self.update(Msg::Theme(ProfileTheme::Forest));
            }
            13 => {
                let _ = self.update(Msg::JoinDialog);
            }
            _ => {
                let report = serde_json::json!({"version":voxy_core::VERSION,"nativeRenderer":"Iced/tiny-skia","windowsBackdropAccepted":self.backdrop,"screenshots":labels,"spaces":self.communities.len(),"messages":self.messages.len(),"releaseAcknowledged":self.store.release_seen(voxy_core::VERSION).unwrap_or(false),"microphoneOpened":false,"publicNetwork":false,"syntheticFixtures":true,"geometryFailures":self.geometry_failures,"geometryNodesChecked":self.geometry_nodes,"fixtureMembers":self.remote.snapshot.as_ref().map(|s|s.members.len()),"actions":"internal application messages, seeded production domain commands, no Windows input automation"});
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
            iced::event::listen_with(|event, _, _| {
                matches!(
                    event,
                    iced::Event::Keyboard(iced::keyboard::Event::KeyPressed {
                        key: iced::keyboard::Key::Named(iced::keyboard::key::Named::Escape),
                        ..
                    })
                )
                .then_some(Msg::Cancel)
            }),
            iced::window::resize_events().map(|(id, _)| Msg::WindowResized(id)),
            if self.smoke_dir.is_none() {
                Subscription::run(bridge::stream)
            } else {
                Subscription::none()
            },
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
            Msg::ServiceConnected(sender) => self.service = Some(sender),
            Msg::PeerVolume(peer, volume) => {
                self.send_service(voxy_core::ipc::Request::Volume {
                    peer,
                    volume,
                    muted: false,
                });
            }
            Msg::ServiceState(state) => {
                let state = *state;
                if let Some(snapshot) = &state.snapshot {
                    if let Some(server) = self
                        .communities
                        .iter_mut()
                        .find(|s| s.id == snapshot.server.id)
                    {
                        *server = snapshot.server.clone();
                    } else {
                        self.communities.push(snapshot.server.clone());
                    }
                    if self.remote.snapshot.is_none() {
                        self.server = Some(snapshot.server.id);
                        self.page = Page::Chat;
                    }
                    if self.server == Some(snapshot.server.id) {
                        self.channels = snapshot.channels.clone();
                        if !self.channels.iter().any(|c| Some(c.id) == self.channel) {
                            self.channel = self
                                .channels
                                .iter()
                                .find(|c| c.kind == ChannelKind::Text)
                                .map(|c| c.id);
                        }
                        self.messages = snapshot
                            .messages
                            .iter()
                            .filter(|m| Some(m.channel_id) == self.channel)
                            .cloned()
                            .collect();
                    }
                }
                if let Some(pending) = &self.pending_message
                    && (state.acknowledged == Some(pending.id)
                        || state.acknowledgements.contains(&pending.id))
                {
                    self.draft.clear();
                    self.pending_message = None;
                    self.editing_message = None;
                }
                self.control.muted.store(state.muted, Ordering::Release);
                self.control
                    .deafened
                    .store(state.deafened, Ordering::Release);
                self.status = state.error.clone().unwrap_or_else(|| state.phase.clone());
                self.remote = state;
            }
            Msg::ServiceError(error) => {
                self.service = None;
                self.status = error;
            }
            Msg::JoinDialog => {
                self.join_dialog = true;
                self.invite_text.clear();
            }
            Msg::InviteText(value) => self.invite_text = value,
            Msg::EndpointText(value) => self.endpoint = value,
            Msg::StunText(value) => self.stun_text = value,
            Msg::JoinRemote => {
                if self.send_service(voxy_core::ipc::Request::Join {
                    invite: self.invite_text.trim().into(),
                    stun: self.stun_urls(),
                }) {
                    self.join_dialog = false;
                    self.invite_text.clear();
                }
            }
            Msg::HostRemote => {
                if self.endpoint.trim().is_empty() {
                    self.page = Page::Settings;
                    self.section = Section::Privacy;
                    self.editing = self.profile.clone();
                    self.status =
                        "Configure o endereço WSS da sinalização antes de hospedar.".into();
                    return Task::none();
                }
                if let Some(server) = self.server {
                    self.send_service(voxy_core::ipc::Request::Host {
                        server,
                        endpoint: self.endpoint.trim().into(),
                        stun: self.stun_urls(),
                    });
                }
            }
            Msg::Disconnect => {
                self.send_service(voxy_core::ipc::Request::Disconnect);
            }
            Msg::LeaveVoice => {
                self.send_service(voxy_core::ipc::Request::VoiceLeave);
            }
            Msg::CopyInvite => {
                if let Some(invite) = &self.remote.invite {
                    return iced::clipboard::write(invite.clone());
                }
            }
            Msg::Search(value) => self.search = value,
            Msg::MessageMenu(id) => {
                self.message_menu = if self.message_menu == Some(id) {
                    None
                } else {
                    Some(id)
                }
            }
            Msg::EditMessage(id) => {
                self.message_hover = None;
                if let Some(message) = self
                    .messages
                    .iter()
                    .find(|m| m.id == id && m.author == self.profile.id)
                {
                    self.draft = message.text.clone();
                    self.editing_message = Some(id);
                    self.pending_message = None;
                }
                self.message_menu = None;
            }
            Msg::CancelEdit => {
                self.editing_message = None;
                self.pending_message = None;
                self.draft.clear();
            }
            Msg::MessageHover(id) => self.message_hover = id,
            Msg::ManageServer => {
                self.page = Page::ServerSettings;
                self.server_name = self
                    .communities
                    .iter()
                    .find(|s| Some(s.id) == self.server)
                    .map(|s| s.name.clone())
                    .unwrap_or_default();
            }
            Msg::AdminRename => {
                if let Some(server) = self.server {
                    if self.is_remote() {
                        self.send_action(voxy_core::room::Action::ServerRename {
                            name: self.server_name.clone(),
                        });
                    } else {
                        match self.store.rename_community(
                            self.profile.id,
                            server,
                            &self.server_name,
                        ) {
                            Ok(()) => {
                                self.communities = self.store.communities().unwrap_or_default()
                            }
                            Err(e) => self.status = e.to_string(),
                        }
                    }
                }
            }
            Msg::AdminCreate(kind) => {
                if let Some(server) = self.server {
                    let name = if kind == ChannelKind::Text {
                        "novo-canal"
                    } else {
                        "Nova chamada"
                    };
                    if self.is_remote() {
                        self.send_action(voxy_core::room::Action::ChannelCreate {
                            name: name.into(),
                            kind,
                        });
                    } else {
                        match self.store.add_channel(self.profile.id, server, name, kind) {
                            Ok(_) => {
                                self.channels = self.store.channels(server).unwrap_or_default()
                            }
                            Err(e) => self.status = e.to_string(),
                        }
                    }
                }
            }
            Msg::AdminRemove(id) => {
                if let Some(server) = self.server {
                    if self.is_remote() {
                        self.send_action(voxy_core::room::Action::ChannelDelete { id });
                    } else {
                        match self.store.delete_channel(self.profile.id, server, id) {
                            Ok(()) => {
                                self.channels = self.store.channels(server).unwrap_or_default()
                            }
                            Err(e) => self.status = e.to_string(),
                        }
                    }
                }
            }
            Msg::AdminDelete => {
                if self.is_remote() {
                    self.status =
                        "Desconecte o servidor antes de excluir seus dados locais.".into();
                } else if let Some(server) = self.server {
                    match self.store.delete_community(self.profile.id, server) {
                        Ok(()) => {
                            self.communities = self.store.communities().unwrap_or_default();
                            self.server = None;
                            self.channels.clear();
                            self.messages.clear();
                            self.page = Page::Home;
                        }
                        Err(e) => self.status = e.to_string(),
                    }
                }
            }
            Msg::FriendId(value) => self.friend_id = value,
            Msg::FriendRequest => match uuid::Uuid::parse_str(self.friend_id.trim()) {
                Ok(to) => self.send_action(voxy_core::room::Action::FriendRequest { to }),
                Err(_) => {
                    self.status =
                        "Informe um ID de perfil válido, conhecido pelo servidor conectado.".into()
                }
            },
            Msg::FriendRespond(requester, accept) => {
                self.send_action(voxy_core::room::Action::FriendRespond { requester, accept })
            }
            Msg::FriendRemove(peer) => {
                self.send_action(voxy_core::room::Action::FriendRemove { peer })
            }
            Msg::Direct(peer) => {
                self.direct_peer = Some(peer);
                self.draft.clear();
                self.pending_message = None;
                self.page = Page::Direct;
            }
            Msg::DirectSend => {
                if let Some(to) = self.direct_peer {
                    let command =
                        self.pending_message
                            .clone()
                            .unwrap_or_else(|| voxy_core::room::Command {
                                id: uuid::Uuid::new_v4(),
                                action: voxy_core::room::Action::Direct {
                                    to,
                                    text: self.draft.clone(),
                                },
                            });
                    if self.send_service(voxy_core::ipc::Request::Command {
                        command: command.clone(),
                    }) {
                        self.pending_message = Some(command);
                    }
                }
            }
            Msg::Reconnect(id) => match self.store.recent_invite(id) {
                Ok(invite) => {
                    self.send_service(voxy_core::ipc::Request::Join {
                        invite,
                        stun: self.stun_urls(),
                    });
                }
                Err(_) => {
                    self.status =
                        "Nenhum convite salvo para este servidor. Peça um novo convite ao dono."
                            .into()
                }
            },
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
            Msg::ProfileSettings => {
                self.section = Section::Profile;
                return self.update(Msg::Navigate(Page::Settings));
            }
            Msg::Section(section) => {
                self.mic_test = None;
                if self.page != Page::Settings {
                    self.page = Page::Settings;
                    self.editing = self.profile.clone();
                }
                self.section = section;
            }
            Msg::Name(name) => self.editing.name = name,
            Msg::Save => {
                if let Ok(latest) = self.store.profile()
                    && let Some(volumes) = latest.retained.get("volumes")
                {
                    self.editing
                        .retained
                        .insert("volumes".into(), volumes.clone());
                }
                self.editing
                    .retained
                    .insert("signalUrl".into(), serde_json::json!(self.endpoint));
                self.editing
                    .retained
                    .insert("stunUrls".into(), serde_json::json!(self.stun_text));
                match self.store.save_profile(&self.editing) {
                    Ok(()) => {
                        self.profile = self.editing.clone();
                        self.status = "Preferências salvas neste computador.".into();
                    }
                    Err(error) => self.status = error.to_string(),
                }
            }
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
                if self.remote.voice.is_some() {
                    self.status =
                        "Saia da chamada antes do teste privado para manter o áudio isolado."
                            .into();
                    return Task::none();
                }
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
            Msg::Cancel => {
                self.modal = false;
                self.join_dialog = false;
                self.message_menu = None;
            }
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
                    self.messages = if self.is_remote() {
                        self.remote
                            .snapshot
                            .as_ref()
                            .map(|s| {
                                s.messages
                                    .iter()
                                    .filter(|m| m.channel_id == id)
                                    .cloned()
                                    .collect()
                            })
                            .unwrap_or_default()
                    } else {
                        self.store.messages(id, None).unwrap_or_default()
                    };
                } else {
                    self.mic_test = None;
                    self.send_service(voxy_core::ipc::Request::VoiceEnter {
                        channel: id,
                        profile: self.profile.clone(),
                    });
                }
            }
            Msg::Draft(value) => {
                self.draft = value;
                self.pending_message = None;
            }
            Msg::Send => {
                if let Some(channel) = self.channel {
                    if self.is_remote() {
                        let command = self.pending_message.clone().unwrap_or_else(|| {
                            voxy_core::room::Command {
                                id: uuid::Uuid::new_v4(),
                                action: if let Some(id) = self.editing_message {
                                    voxy_core::room::Action::Edit {
                                        id,
                                        text: self.draft.clone(),
                                    }
                                } else {
                                    voxy_core::room::Action::Message {
                                        channel,
                                        text: self.draft.clone(),
                                    }
                                },
                            }
                        });
                        if self.send_service(voxy_core::ipc::Request::Command {
                            command: command.clone(),
                        }) {
                            self.pending_message = Some(command);
                        }
                        return Task::none();
                    }
                    if let Some(id) = self.editing_message {
                        match self.store.edit(id, self.profile.id, &self.draft) {
                            Ok(()) => {
                                self.draft.clear();
                                self.editing_message = None;
                                self.messages =
                                    self.store.messages(channel, None).unwrap_or_default();
                            }
                            Err(error) => self.status = error.to_string(),
                        };
                        return Task::none();
                    }
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
            Msg::Delete(id) => {
                self.message_menu = None;
                if self.is_remote() {
                    self.send_action(voxy_core::room::Action::Delete { id });
                    return Task::none();
                }
                match self.store.delete_message(id, self.profile.id) {
                    Ok(()) => {
                        if let Some(channel) = self.channel {
                            self.messages = self.store.messages(channel, None).unwrap_or_default();
                        }
                    }
                    Err(error) => self.status = error.to_string(),
                }
            }
            Msg::Mute => {
                self.control.muted.fetch_xor(true, Ordering::Relaxed);
                self.send_controls();
            }
            Msg::Deafen => {
                self.control.deafened.fetch_xor(true, Ordering::Relaxed);
                self.send_controls();
            }
            Msg::Drag => return iced::window::latest().and_then(iced::window::drag),
            Msg::Minimize => {
                return iced::window::latest().and_then(|id| iced::window::minimize(id, true));
            }
            Msg::Maximize => return iced::window::latest().and_then(iced::window::toggle_maximize),
            Msg::WindowResized(id) => return iced::window::is_maximized(id).map(Msg::Maximized),
            Msg::Maximized(value) => self.maximized = value,
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
            Msg::SmokeStep(step) => {
                return Task::batch([
                    iced::advanced::widget::operate(qa::Collect::default())
                        .map(move |nodes| Msg::Geometry(step, nodes)),
                    iced::window::latest().and_then(move |id| {
                        iced::window::screenshot(id).map(move |shot| Msg::Captured(step, shot))
                    }),
                ]);
            }
            Msg::Geometry(step, nodes) => {
                self.geometry_failures += qa::failures(&nodes);
                self.geometry_nodes += nodes.len();
                if let Some(path) = &self.smoke_dir {
                    let _ = std::fs::create_dir_all(path);
                    let _ = std::fs::write(
                        path.join(format!("geometry-{step}.json")),
                        serde_json::to_vec_pretty(&nodes).unwrap(),
                    );
                }
            }
            Msg::Captured(step, shot) => return self.smoke_captured(step, shot),
        }
        Task::none()
    }
    fn open_server(&mut self, id: uuid::Uuid) {
        if let Some(index) = self.communities.iter().position(|server| server.id == id) {
            let server = self.communities.remove(index);
            self.communities.insert(0, server);
        }
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
        if self.is_remote()
            && let Some(snapshot) = &self.remote.snapshot
        {
            self.channels = snapshot.channels.clone();
            self.channel = self
                .channels
                .iter()
                .find(|c| c.kind == ChannelKind::Text)
                .map(|c| c.id);
            self.messages = snapshot
                .messages
                .iter()
                .filter(|m| Some(m.channel_id) == self.channel)
                .cloned()
                .collect();
        }
    }
    fn is_remote(&self) -> bool {
        self.remote
            .snapshot
            .as_ref()
            .is_some_and(|s| Some(s.server.id) == self.server)
    }
    fn stun_urls(&self) -> Vec<String> {
        self.stun_text
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect()
    }
    fn send_service(&mut self, request: voxy_core::ipc::Request) -> bool {
        if self
            .service
            .as_ref()
            .is_some_and(|s| s.try_send(request).is_ok())
        {
            true
        } else {
            self.status = "Núcleo indisponível ou fila cheia. Aguarde e tente novamente.".into();
            false
        }
    }
    fn send_action(&mut self, action: voxy_core::room::Action) {
        self.send_service(voxy_core::ipc::Request::Command {
            command: voxy_core::room::Command {
                id: uuid::Uuid::new_v4(),
                action,
            },
        });
    }
    fn send_controls(&mut self) {
        self.send_service(voxy_core::ipc::Request::Controls {
            muted: self.control.muted.load(Ordering::Relaxed),
            deafened: self.control.deafened.load(Ordering::Relaxed),
        });
    }
    fn action<'a>(&self, label: &str, msg: Msg, primary: bool) -> widget::Button<'a, Msg> {
        button(text(label.to_owned()).size(13))
            .padding([8, 12])
            .style(self.palette().button(primary))
            .on_press(msg)
    }
    fn view(&self) -> Element<'_, Msg> {
        let m = self.palette();
        let titlebar = chrome::titlebar(self);
        let page = match self.page {
            Page::Home => screens::home(self),
            Page::Chat => screens::chat(self),
            Page::Settings => screens::settings(self),
            Page::News => screens::news(self),
            Page::ServerSettings => screens::admin(self),
            Page::Direct => screens::direct(self),
        };
        let footer = chrome::footer(self);
        let shell = column![
            titlebar,
            row![
                chrome::sidebar(self),
                column![page, footer].height(Fill).width(Fill)
            ]
            .height(Fill)
        ]
        .height(Fill);
        let content: Element<'_, Msg> = stack![self.atmosphere.view(m), shell].into();
        if self.join_dialog {
            stack![content,container(container(column![row![text("Entrar em servidor").font(bold()).size(20),space::horizontal(),self.action("×",Msg::Cancel,false)],text("Cole o convite enviado pelo dono do servidor.").size(13).color(m.muted),text_input("voxy://join/…",&self.invite_text).on_input(Msg::InviteText).on_submit(Msg::JoinRemote).padding(12).style(m.input()),text("Conexões diretas compartilham seu IP com os participantes. O host armazena as mensagens. TURN está desativado.").size(12).color(m.muted),row![space::horizontal(),self.action("Cancelar",Msg::Cancel,false),self.action("Entrar",Msg::JoinRemote,true)].spacing(8)].spacing(16)).padding(24).width(470).style(move |_|m.dialog())).center(Fill).style(|_|container::Style{background:Some(alpha(Color::BLACK,0.65).into()),..Default::default()})].into()
        } else if self.modal {
            stack![content,container(container(column![row![text("Criar servidor").font(bold()).size(20),space::horizontal(),self.action("×",Msg::Cancel,false)],text("Um lugar para o seu grupo, com canais de texto e voz.").size(14).color(m.muted),text_input("Nome do servidor",&self.server_name).on_input(Msg::ServerName).on_submit(Msg::CreateServer).padding(15).style(m.input()),text("Depois de criar, hospede o servidor e copie o convite para seu grupo.").color(m.muted).size(12),row![space::horizontal(),self.action("Cancelar",Msg::Cancel,false),self.action("Criar servidor",Msg::CreateServer,true)].spacing(10)].spacing(22)).padding(32).width(530).style(move|_|m.dialog())).center(Fill).width(Fill).height(Fill).style(|_|container::Style{background:Some(alpha(Color::BLACK,0.65).into()),..Default::default()})].into()
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
                if app.palette().reduced || !app.backdrop {
                    1.0
                } else {
                    0.58
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
