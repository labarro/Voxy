#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod art;
mod bridge;
mod chrome;
mod design;
mod fixtures;
mod image_transfer;
mod platform;
mod preferences;
mod qa;
mod screens;
mod windows_integration;
mod world;
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
    Windows,
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
    RotateInvite,
    RoleName(String),
    RoleColor(String),
    RoleEdit(uuid::Uuid),
    RoleSave,
    RoleDelete(uuid::Uuid),
    RoleAssign(uuid::Uuid, uuid::Uuid, bool),
    Presence(String),
    NicknameColor(String),
    WindowsSetting(&'static str, bool),
    Shortcut(&'static str, String),
    AudioBoolean(&'static str, bool),
    VoiceThreshold(f32),
    NotificationPreference(&'static str, bool),
    DndHour(bool),
    Search(String),
    OpenLink(String),
    Mention(uuid::Uuid),
    SearchRemote,
    OlderMessages,
    ReplyMessage(uuid::Uuid),
    ReactMessage(uuid::Uuid, String),
    NotificationOpen(uuid::Uuid),
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
    DirectEdit(uuid::Uuid),
    DirectDelete(uuid::Uuid),
    DirectReadAll,
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
    CloseTimeout,
    Fullscreen,
    World(&'static str),
    WorldReady(
        u64,
        Result<Arc<std::sync::Mutex<world::WorldProcess>>, String>,
    ),
    CloseWorld,
    PickImage,
    ImagePicked(Result<Option<image_transfer::Picked>, String>),
    OpenImage(voxy_core::images::ImageMetadata),
    CancelImage,
    CloseImage,
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
    replying_message: Option<uuid::Uuid>,
    history_request: Option<uuid::Uuid>,
    history_messages: Vec<ChatMessage>,
    pending_message: Option<voxy_core::room::Command>,
    friend_id: String,
    direct_peer: Option<uuid::Uuid>,
    store: Store,
    profile: Profile,
    editing: Profile,
    windows_settings: windows_integration::WindowsSettings,
    mute_shortcut: String,
    deafen_shortcut: String,
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
    role_name: String,
    role_color: String,
    editing_role: Option<uuid::Uuid>,
    status: String,
    devices: Vec<AudioDevice>,
    control: Arc<VoiceControl>,
    mic_control: Arc<VoiceControl>,
    mic_test: Option<MicrophoneTest>,
    atmosphere: art::Atmosphere,
    notes_pending: bool,
    smoke_dir: Option<std::path::PathBuf>,
    backdrop: bool,
    maximized: bool,
    fullscreen: bool,
    closing_session: bool,
    world: Option<Arc<std::sync::Mutex<world::WorldProcess>>>,
    world_generation: u64,
    image_transfer: Option<image_transfer::Transfer>,
    image_preview: Option<image_transfer::Preview>,
    pending_image_target: Option<(uuid::Uuid, voxy_core::images::ImageTarget, String)>,
    shutdown_sent: bool,
    geometry_failures: usize,
    geometry_nodes: usize,
    ready_file: Option<std::path::PathBuf>,
}
impl App {
    fn new() -> (Self, Task<Msg>) {
        let args: Vec<String> = std::env::args().collect();
        let protocol_invite =
            windows_integration::protocol_invite_from_args(&args[1..]).unwrap_or(None);
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
                join_dialog: protocol_invite.is_some(),
                invite_text: protocol_invite.unwrap_or_default(),
                endpoint,
                stun_text,
                search: String::new(),
                message_menu: None,
                message_hover: None,
                editing_message: None,
                replying_message: None,
                history_request: None,
                history_messages: vec![],
                pending_message: None,
                friend_id: String::new(),
                direct_peer: None,
                store,
                profile: profile.clone(),
                windows_settings: windows_integration::WindowsSettings::from_profile(&profile),
                mute_shortcut: preferences::shortcut_text(&profile, "muteShortcut"),
                deafen_shortcut: preferences::shortcut_text(&profile, "deafenShortcut"),
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
                role_name: String::new(),
                role_color: "#a0a0a0".into(),
                editing_role: None,
                status: if fixture.is_some() {
                    "Fixture visual · sem áudio ou rede".into()
                } else {
                    String::new()
                },
                devices,
                control: Arc::new(VoiceControl::default()),
                mic_control: Arc::new(VoiceControl::default()),
                mic_test: None,
                atmosphere: Default::default(),
                notes_pending,
                smoke_dir,
                backdrop: false,
                maximized: false,
                fullscreen: false,
                closing_session: false,
                world: None,
                world_generation: 0,
                image_transfer: None,
                image_preview: None,
                pending_image_target: None,
                shutdown_sent: false,
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
            iced::window::close_requests().map(|_| Msg::Close),
            if self.smoke_dir.is_none() {
                Subscription::run(bridge::stream)
            } else {
                Subscription::none()
            },
            iced::window::open_events().map(Msg::Ready),
            if self.mic_test.is_some() || self.image_transfer.is_some() {
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
                let notification = state
                    .notification_open
                    .filter(|id| Some(*id) != self.remote.notification_open);
                if state.snapshot.as_ref().map(|s| s.history_revision)
                    != self.remote.snapshot.as_ref().map(|s| s.history_revision)
                {
                    self.history_messages.clear();
                }
                let focus = state.focus_requested != self.remote.focus_requested;
                if let Some(id) = self.history_request
                    && let Some((_, value)) =
                        state.command_results.iter().find(|(key, _)| *key == id)
                {
                    match serde_json::from_value::<Vec<ChatMessage>>(value.clone()) {
                        Ok(messages) => {
                            for message in messages {
                                if Some(message.channel_id) == self.channel
                                    && !self.history_messages.iter().any(|m| m.id == message.id)
                                {
                                    self.history_messages.push(message);
                                }
                            }
                            self.history_messages.sort_by_key(|m| (m.time, m.id));
                            if self.history_messages.len() > 500 {
                                self.history_messages
                                    .drain(..self.history_messages.len() - 500);
                            }
                        }
                        Err(error) => self.status = error.to_string(),
                    }
                    self.history_request = None;
                }
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
                        self.history_messages
                            .retain(|m| !snapshot.deleted_messages.contains(&m.id));
                        for message in &mut self.history_messages {
                            if let Some(updated) =
                                snapshot.messages.iter().find(|m| m.id == message.id)
                            {
                                *message = updated.clone();
                            }
                        }
                        for message in &self.history_messages {
                            if Some(message.channel_id) == self.channel
                                && !self.messages.iter().any(|m| m.id == message.id)
                            {
                                self.messages.push(message.clone());
                            }
                        }
                        self.messages.sort_by_key(|m| (m.time, m.id));
                    }
                }
                if let Some(pending) = &self.pending_message
                    && (state.acknowledged == Some(pending.id)
                        || state.acknowledgements.contains(&pending.id))
                {
                    self.draft.clear();
                    self.pending_message = None;
                    self.editing_message = None;
                    self.replying_message = None;
                }
                self.control.muted.store(state.muted, Ordering::Release);
                self.control
                    .deafened
                    .store(state.deafened, Ordering::Release);
                self.status = state.error.clone().unwrap_or_else(|| state.phase.clone());
                self.remote = state;
                if let Some(transfer) = &self.image_transfer
                    && let Some((_, value)) = self
                        .remote
                        .command_results
                        .iter()
                        .find(|(id, _)| *id == transfer.command.id)
                        .cloned()
                {
                    match self.image_transfer.as_mut().unwrap().reply(&value) {
                        Ok(image_transfer::Step::Next(action)) => self.send_image_action(action),
                        Ok(image_transfer::Step::Uploaded(text)) => {
                            if self.draft == text {
                                self.draft.clear();
                            }
                            self.image_transfer = None;
                            self.status = "Imagem confirmada pelo host.".into();
                        }
                        Ok(image_transfer::Step::Downloaded(preview)) => {
                            self.image_preview = Some(preview);
                            self.image_transfer = None;
                        }
                        Err(error) => {
                            self.image_transfer = None;
                            self.status = error.to_string();
                        }
                    }
                }
                if let Some(id) = notification {
                    let _ = self.update(Msg::NotificationOpen(id));
                }
                if self.closing_session
                    && self.remote.voice.is_none()
                    && self.remote.snapshot.is_none()
                {
                    return iced::exit();
                }
                if self.closing_session && self.remote.muted && !self.shutdown_sent {
                    self.shutdown_sent = self.send_service(voxy_core::ipc::Request::Shutdown);
                }
                if focus {
                    return iced::window::latest().and_then(|id| {
                        Task::batch([
                            iced::window::minimize(id, false),
                            iced::window::gain_focus(id),
                        ])
                    });
                }
            }
            Msg::ServiceError(error) => {
                if self.closing_session && self.shutdown_sent {
                    return iced::exit();
                }
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
            Msg::RotateInvite => {
                self.send_service(voxy_core::ipc::Request::RotateInvite {
                    valid_for_seconds: 86400,
                });
            }
            Msg::RoleName(value) => self.role_name = value,
            Msg::RoleColor(value) => self.role_color = value,
            Msg::RoleEdit(id) => {
                if let Some(role) = self
                    .remote
                    .snapshot
                    .as_ref()
                    .and_then(|s| s.roles.iter().find(|r| r.id == id))
                {
                    self.role_name = role.name.clone();
                    self.role_color = role.color.clone();
                    self.editing_role = Some(id);
                }
            }
            Msg::RoleSave => {
                self.send_action(voxy_core::room::Action::RoleSave {
                    id: self.editing_role,
                    name: self.role_name.clone(),
                    color: self.role_color.clone(),
                });
            }
            Msg::RoleDelete(id) => {
                self.send_action(voxy_core::room::Action::RoleDelete { id });
                if self.editing_role == Some(id) {
                    self.editing_role = None;
                    self.role_name.clear();
                }
            }
            Msg::RoleAssign(role, member, assigned) => {
                self.send_action(voxy_core::room::Action::RoleAssign {
                    role,
                    member,
                    assigned,
                });
            }
            Msg::Presence(value) => {
                self.editing
                    .retained
                    .insert("presence".into(), serde_json::json!(value));
            }
            Msg::NicknameColor(value) => {
                self.editing
                    .retained
                    .insert("nicknameColor".into(), serde_json::json!(value));
            }
            Msg::Search(value) => self.search = value,
            Msg::PickImage => {
                if self.pending_image_target.is_some() {
                    return Task::none();
                }
                let target = if self.page == Page::Direct {
                    self.direct_peer
                        .map(|to| voxy_core::images::ImageTarget::Direct { to })
                } else {
                    self.channel
                        .map(|channel| voxy_core::images::ImageTarget::Channel { channel })
                };
                let Some(target) = target else {
                    return Task::none();
                };
                let Some(server) = self.remote.snapshot.as_ref().map(|s| s.server.id) else {
                    return Task::none();
                };
                if self.image_transfer.is_some() {
                    self.status = "Conclua ou cancele a transferência atual.".into();
                    return Task::none();
                }
                if !self.is_remote() {
                    self.status = "Conecte o servidor antes de enviar uma imagem.".into();
                    return Task::none();
                }
                self.pending_image_target = Some((server, target, self.draft.clone()));
                return Task::perform(
                    async {
                        tokio::task::spawn_blocking(image_transfer::pick)
                            .await
                            .map_err(|error| error.to_string())
                            .and_then(|value| value.map_err(|error| error.to_string()))
                    },
                    Msg::ImagePicked,
                );
            }
            Msg::ImagePicked(result) => {
                let selected = self.pending_image_target.take();
                match result {
                    Ok(Some(picked)) => {
                        if let Some((server, target, text)) = selected {
                            let same_target = match &target {
                                voxy_core::images::ImageTarget::Channel { channel } => {
                                    self.page == Page::Chat && self.channel == Some(*channel)
                                }
                                voxy_core::images::ImageTarget::Direct { to } => {
                                    self.page == Page::Direct && self.direct_peer == Some(*to)
                                }
                            };
                            if !same_target
                                || self
                                    .remote
                                    .snapshot
                                    .as_ref()
                                    .is_none_or(|s| s.server.id != server)
                            {
                                self.status="Destino alterado; imagem não enviada. Selecione novamente no destino correto.".into();
                                return Task::none();
                            }
                            let (transfer, action) =
                                image_transfer::Transfer::upload(picked, target, text);
                            self.image_transfer = Some(transfer);
                            self.send_image_action(action);
                        }
                    }
                    Ok(None) => {}
                    Err(error) => self.status = error,
                }
            }
            Msg::OpenImage(metadata) => {
                if self.image_transfer.is_some() {
                    return Task::none();
                }
                let transfer = image_transfer::Transfer::read(metadata);
                let action = transfer.command.action.clone();
                self.image_transfer = Some(transfer);
                self.send_image_action(action);
            }
            Msg::CancelImage => {
                if let Some(transfer) = self.image_transfer.take()
                    && let Some(action) = transfer.cancel()
                {
                    self.send_action(action);
                }
                self.status = "Transferência de imagem cancelada.".into();
            }
            Msg::CloseImage => self.image_preview = None,
            Msg::World(preset) => {
                self.world = None;
                self.world_generation += 1;
                let generation = self.world_generation;
                self.status = "Abrindo o renderer nativo; aguardando o primeiro frame.".into();
                return Task::perform(
                    async move {
                        tokio::task::spawn_blocking(move || {
                            world::WorldProcess::start(preset)
                                .map(|world| Arc::new(std::sync::Mutex::new(world)))
                                .map_err(|error| error.to_string())
                        })
                        .await
                        .unwrap_or_else(|error| Err(error.to_string()))
                    },
                    move |result| Msg::WorldReady(generation, result),
                );
            }
            Msg::WorldReady(generation, result) => {
                if generation == self.world_generation {
                    match result {
                        Ok(world) => {
                            self.world = Some(world);
                            self.status="Prévia nativa em outra janela. Multiplayer, avatar dinâmico e jogos 3D ainda em migração.".into();
                        }
                        Err(error) => self.status = error,
                    }
                }
            }
            Msg::CloseWorld => {
                self.world_generation += 1;
                self.world = None;
                self.status = "Mundo encerrado; processo gráfico liberado.".into();
            }
            Msg::Shortcut(field, value) => match field {
                "mute" => self.mute_shortcut = value,
                "deafen" => self.deafen_shortcut = value,
                _ => {}
            },
            Msg::AudioBoolean(field, value) => {
                if field == "voiceDetection" {
                    self.editing.voice_detection = value;
                } else {
                    self.editing
                        .retained
                        .insert(field.into(), serde_json::json!(value));
                }
            }
            Msg::VoiceThreshold(value) => self.editing.voice_threshold = value,
            Msg::NotificationPreference(field, value) => {
                let prefs = self
                    .editing
                    .retained
                    .entry("notifications".into())
                    .or_insert_with(|| serde_json::json!({}));
                if !prefs.is_object() {
                    *prefs = serde_json::json!({});
                }
                prefs[field] = serde_json::json!(value);
            }
            Msg::DndHour(value) => {
                let prefs = self
                    .editing
                    .retained
                    .entry("notifications".into())
                    .or_insert_with(|| serde_json::json!({}));
                if !prefs.is_object() {
                    *prefs = serde_json::json!({});
                }
                prefs["dndUntil"] = serde_json::json!(if value {
                    voxy_core::store::now_ms() + 3_600_000
                } else {
                    0
                });
            }
            Msg::WindowsSetting(field, value) => match field {
                "launch" => self.windows_settings.launch_at_login = value,
                "minimized" => self.windows_settings.start_minimized = value,
                "protocol" => self.windows_settings.register_experimental_protocol = value,
                "close" => {
                    self.editing
                        .retained
                        .insert("closeToTray".into(), serde_json::json!(value));
                }
                _ => {}
            },
            Msg::OpenLink(url) => {
                if let Err(error) = platform::open_link(&url) {
                    self.status = error.to_string();
                }
            }
            Msg::Mention(id) => {
                self.draft.push_str(&format!(" @{{{id}}} "));
            }
            Msg::SearchRemote | Msg::OlderMessages => {
                if let Some(channel) = self.channel {
                    let action = if matches!(msg, Msg::SearchRemote) {
                        self.history_messages.clear();
                        voxy_core::room::Action::Search {
                            channel,
                            text: self.search.clone(),
                            before: None,
                        }
                    } else {
                        voxy_core::room::Action::History {
                            channel,
                            before: self.messages.first().map(|m| (m.time, m.id)),
                        }
                    };
                    let command = voxy_core::room::Command {
                        id: uuid::Uuid::new_v4(),
                        action,
                    };
                    if self.is_remote() {
                        if self.send_service(voxy_core::ipc::Request::Command {
                            command: command.clone(),
                        }) {
                            self.history_request = Some(command.id);
                        }
                    } else {
                        let result = match command.action {
                            voxy_core::room::Action::Search { text, .. } => {
                                self.store.search_messages(channel, &text, None)
                            }
                            voxy_core::room::Action::History { before, .. } => {
                                self.store.messages(channel, before)
                            }
                            _ => unreachable!(),
                        };
                        match result {
                            Ok(messages) => {
                                for item in messages {
                                    if !self.messages.iter().any(|m| m.id == item.id) {
                                        self.messages.push(item);
                                    }
                                }
                                self.messages.sort_by_key(|m| (m.time, m.id));
                            }
                            Err(error) => self.status = error.to_string(),
                        }
                    }
                }
            }
            Msg::ReplyMessage(id) => {
                self.replying_message = Some(id);
                self.editing_message = None;
                self.message_menu = None;
            }
            Msg::ReactMessage(id, emoji) => {
                if self.is_remote() {
                    self.send_action(voxy_core::room::Action::React { id, emoji });
                } else if let Err(error) = self.store.react(id, self.profile.id, &emoji) {
                    self.status = error.to_string();
                } else if let Some(channel) = self.channel {
                    self.messages = self.store.messages(channel, None).unwrap_or_default();
                }
                self.message_menu = None;
            }
            Msg::NotificationOpen(id) => {
                if let Some(note) = self
                    .remote
                    .snapshot
                    .as_ref()
                    .and_then(|s| s.notifications.iter().find(|n| n.id == id))
                    .cloned()
                {
                    if let Some(channel) = note.channel {
                        self.channel = Some(channel);
                        self.page = Page::Chat;
                    } else if note.kind == "direct" {
                        self.direct_peer = Some(note.sender);
                        self.page = Page::Direct;
                    } else {
                        self.page = Page::Home;
                    }
                    self.send_action(voxy_core::room::Action::NotificationRead { id });
                    if let Some(channel) = note.channel {
                        self.history_messages.clear();
                        let command = voxy_core::room::Command {
                            id: uuid::Uuid::new_v4(),
                            action: voxy_core::room::Action::History {
                                channel,
                                before: Some((note.time.saturating_add(1), uuid::Uuid::max())),
                            },
                        };
                        if self.send_service(voxy_core::ipc::Request::Command {
                            command: command.clone(),
                        }) {
                            self.history_request = Some(command.id);
                        }
                    }
                }
            }
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
                    self.replying_message = None;
                    self.pending_message = None;
                }
                self.message_menu = None;
            }
            Msg::CancelEdit => {
                self.editing_message = None;
                self.replying_message = None;
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
                self.editing_message = None;
                self.replying_message = None;
                self.page = Page::Direct;
                let unread: Vec<_> = self
                    .remote
                    .snapshot
                    .as_ref()
                    .map(|s| {
                        s.direct
                            .iter()
                            .filter(|d| {
                                d.from == peer && d.to == self.profile.id && d.read_at.is_none()
                            })
                            .map(|d| d.id)
                            .collect()
                    })
                    .unwrap_or_default();
                for id in unread {
                    self.send_action(voxy_core::room::Action::DirectRead { id });
                }
            }
            Msg::DirectSend => {
                if let Some(to) = self.direct_peer {
                    let command =
                        self.pending_message
                            .clone()
                            .unwrap_or_else(|| voxy_core::room::Command {
                                id: uuid::Uuid::new_v4(),
                                action: if let Some(id) = self.editing_message {
                                    voxy_core::room::Action::DirectEdit {
                                        id,
                                        text: self.draft.clone(),
                                    }
                                } else {
                                    voxy_core::room::Action::Direct {
                                        to,
                                        text: self.draft.clone(),
                                    }
                                },
                            });
                    if self.send_service(voxy_core::ipc::Request::Command {
                        command: command.clone(),
                    }) {
                        self.pending_message = Some(command);
                    }
                }
            }
            Msg::DirectEdit(id) => {
                if let Some(message) = self.remote.snapshot.as_ref().and_then(|s| {
                    s.direct
                        .iter()
                        .find(|d| d.id == id && d.from == self.profile.id)
                }) {
                    self.draft = message.text.clone();
                    self.editing_message = Some(id);
                    self.pending_message = None;
                }
            }
            Msg::DirectDelete(id) => {
                self.send_action(voxy_core::room::Action::DirectDelete { id });
            }
            Msg::DirectReadAll => {
                let unread: Vec<_> = self
                    .remote
                    .snapshot
                    .as_ref()
                    .map(|s| {
                        s.direct
                            .iter()
                            .filter(|d| {
                                Some(d.from) == self.direct_peer
                                    && d.to == self.profile.id
                                    && d.read_at.is_none()
                            })
                            .map(|d| d.id)
                            .collect()
                    })
                    .unwrap_or_default();
                for id in unread {
                    self.send_action(voxy_core::room::Action::DirectRead { id });
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
                    self.windows_settings =
                        windows_integration::WindowsSettings::from_profile(&self.profile);
                    self.mute_shortcut = preferences::shortcut_text(&self.profile, "muteShortcut");
                    self.deafen_shortcut =
                        preferences::shortcut_text(&self.profile, "deafenShortcut");
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
                if let Err(error) = preferences::write_shortcuts(
                    &mut self.editing,
                    &self.mute_shortcut,
                    &self.deafen_shortcut,
                ) {
                    self.status = error.to_string();
                    return Task::none();
                }
                let previous_windows =
                    windows_integration::WindowsSettings::from_profile(&self.profile);
                let apply_windows =
                    self.windows_settings != previous_windows || self.section == Section::Windows;
                if apply_windows
                    && let Err(error) = windows_integration::apply_settings(self.windows_settings)
                {
                    self.status = error.to_string();
                    return Task::none();
                }
                self.windows_settings.store_in_profile(&mut self.editing);
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
                        if self.is_remote() {
                            self.send_action(voxy_core::room::Action::ProfileUpdate {
                                name: self.profile.name.clone(),
                                presence: serde_json::from_value(
                                    self.profile
                                        .retained
                                        .get("presence")
                                        .cloned()
                                        .unwrap_or(serde_json::json!("online")),
                                )
                                .unwrap_or_default(),
                                nickname_color: self
                                    .profile
                                    .retained
                                    .get("nicknameColor")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or_default()
                                    .into(),
                            });
                        }
                    }
                    Err(error) => {
                        self.status = error.to_string();
                        if apply_windows
                            && let Err(rollback) =
                                windows_integration::apply_settings(previous_windows)
                        {
                            self.status
                                .push_str(&format!("; rollback Windows: {rollback}"));
                        }
                    }
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
                self.mic_control.set_gain(gain);
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
                    self.mic_control = Arc::new(VoiceControl::default());
                    self.mic_control.set_gain(self.editing.input_volume);
                    match MicrophoneTest::start_config(
                        voxy_voice::call::CallConfig {
                            input: self.editing.input.clone(),
                            output: self.editing.output.clone(),
                            noise_suppression: self
                                .editing
                                .retained
                                .get("noiseSuppression")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(true),
                            automatic_gain: self
                                .editing
                                .retained
                                .get("autoGainControl")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(true),
                            echo_cancellation: false,
                            voice_detection: self.editing.voice_detection,
                            threshold: self.editing.voice_threshold,
                            ptt_key: None,
                        },
                        self.mic_control.clone(),
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
                if self.mic_test.is_some()
                    && (self.mic_control.device_failed.load(Ordering::Acquire)
                        || self
                            .mic_test
                            .as_ref()
                            .is_some_and(MicrophoneTest::is_finished))
                {
                    self.mic_test = None;
                    self.status =
                        "Dispositivo desconectado. Escolha a entrada e tente novamente.".into();
                }
                if self.image_transfer.as_ref().is_some_and(|transfer| {
                    transfer.sent.elapsed() > std::time::Duration::from_secs(15)
                }) {
                    let _ = self.update(Msg::CancelImage);
                    self.status =
                        "Imagem sem confirmação em 15 s. Transferência cancelada; tente novamente."
                            .into();
                }
            }
            Msg::NewServer => {
                self.modal = true;
                self.server_name.clear();
            }
            Msg::ServerName(name) => self.server_name = name,
            Msg::Cancel => {
                if self.image_preview.take().is_some() {
                    return Task::none();
                }
                if self.fullscreen && !self.modal && !self.join_dialog {
                    return self.update(Msg::Fullscreen);
                }
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
                self.history_messages.clear();
                self.history_request = None;
                self.replying_message = None;
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
                                } else if let Some(target) = self.replying_message {
                                    voxy_core::room::Action::Reply {
                                        channel,
                                        text: self.draft.clone(),
                                        target,
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
                    let result = if let Some(target) = self.replying_message {
                        self.store.reply(
                            channel,
                            self.profile.id,
                            &self.profile.name,
                            &self.draft,
                            target,
                        )
                    } else {
                        self.store
                            .post(channel, self.profile.id, &self.profile.name, &self.draft)
                    };
                    match result {
                        Ok(_) => {
                            self.draft.clear();
                            self.replying_message = None;
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
                if self
                    .profile
                    .retained
                    .get("closeToTray")
                    .and_then(|v| v.as_bool())
                    == Some(false)
                    && self.service.is_some()
                {
                    if self.send_service(voxy_core::ipc::Request::Controls {
                        muted: true,
                        deafened: self.remote.deafened,
                    }) {
                        self.closing_session = true;
                        self.shutdown_sent = false;
                        return Task::perform(
                            async {
                                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                            },
                            |_| Msg::CloseTimeout,
                        );
                    }
                    return Task::none();
                }
                return iced::exit();
            }
            Msg::CloseTimeout => {
                if self.closing_session {
                    self.closing_session = false;
                    self.status="O núcleo não confirmou o encerramento. Confira a bandeja e tente novamente.".into();
                }
            }
            Msg::Fullscreen => {
                self.fullscreen = !self.fullscreen;
                let mode = if self.fullscreen {
                    iced::window::Mode::Fullscreen
                } else {
                    iced::window::Mode::Windowed
                };
                return iced::window::latest().and_then(move |id| iced::window::set_mode(id, mode));
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
                if self.smoke_dir.is_none()
                    && std::env::args().any(|arg| arg == "--start-minimized")
                {
                    return iced::window::latest().and_then(|id| iced::window::minimize(id, true));
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
    fn send_image_action(&mut self, action: voxy_core::room::Action) {
        let command = voxy_core::room::Command {
            id: uuid::Uuid::new_v4(),
            action,
        };
        if self.send_service(voxy_core::ipc::Request::Command {
            command: command.clone(),
        }) {
            if let Some(transfer) = &mut self.image_transfer {
                transfer.command = command;
                transfer.sent = std::time::Instant::now();
            }
        } else {
            self.image_transfer = None;
        }
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
        if let Some(preview) = &self.image_preview {
            stack![
                content,
                container(
                    container(
                        column![
                            row![
                                text(&preview.name).size(16),
                                space::horizontal(),
                                self.action("Fechar", Msg::CloseImage, false)
                            ]
                            .align_y(iced::Center),
                            widget::image(preview.handle.clone())
                                .width(Fill)
                                .height(Fill)
                                .content_fit(iced::ContentFit::Contain)
                        ]
                        .spacing(12)
                    )
                    .padding(22)
                    .width(Fill)
                    .height(Fill)
                    .style(move |_| m.dialog())
                )
                .padding(30)
                .center(Fill)
                .style(|_| container::Style {
                    background: Some(alpha(Color::BLACK, 0.85).into()),
                    ..Default::default()
                })
            ]
            .into()
        } else if self.join_dialog {
            stack![content,container(container(column![row![text("Entrar em servidor").font(bold()).size(20),space::horizontal(),self.action("×",Msg::Cancel,false)],text("Cole o convite enviado pelo dono do servidor.").size(13).color(m.muted),text_input("voxy://join/…",&self.invite_text).on_input(Msg::InviteText).on_submit(Msg::JoinRemote).padding(12).style(m.input()),text("Conexões diretas compartilham seu IP com os participantes. O host armazena as mensagens. TURN está desativado.").size(12).color(m.muted),row![space::horizontal(),self.action("Cancelar",Msg::Cancel,false),self.action("Entrar",Msg::JoinRemote,true)].spacing(8)].spacing(16)).padding(24).width(470).style(move |_|m.dialog())).center(Fill).style(|_|container::Style{background:Some(alpha(Color::BLACK,0.65).into()),..Default::default()})].into()
        } else if self.modal {
            stack![content,container(container(column![row![text("Criar servidor").font(bold()).size(20),space::horizontal(),self.action("×",Msg::Cancel,false)],text("Um lugar para o seu grupo, com canais de texto e voz.").size(14).color(m.muted),text_input("Nome do servidor",&self.server_name).on_input(Msg::ServerName).on_submit(Msg::CreateServer).padding(15).style(m.input()),text("Depois de criar, hospede o servidor e copie o convite para seu grupo.").color(m.muted).size(12),row![space::horizontal(),self.action("Cancelar",Msg::Cancel,false),self.action("Criar servidor",Msg::CreateServer,true)].spacing(10)].spacing(22)).padding(32).width(530).style(move|_|m.dialog())).center(Fill).width(Fill).height(Fill).style(|_|container::Style{background:Some(alpha(Color::BLACK,0.65).into()),..Default::default()})].into()
        } else if self.notes_pending && self.page != Page::News && self.smoke_dir.is_none() {
            stack![content,container(container(column![text("Novidades do Voxy 2.0.0 em preparação").size(21).font(bold()),text("Esta versão experimental continua separada da 1.4.1 publicada. Consulte as funcionalidades e limitações antes de testar.").size(14),text("Comunicação nativa, comandos sociais, convites revogáveis e importação em cópia. Rede pública, mídia, 3D e homologação ainda pendentes.").size(13).color(m.muted),row![self.action("Ver novidades",Msg::Navigate(Page::News),false),self.action("Entendi",Msg::MarkNotes,true)].spacing(10)].spacing(18)).padding(26).width(540).style(move |_|m.dialog())).center(Fill).style(|_|container::Style{background:Some(alpha(Color::BLACK,0.65).into()),..Default::default()})].into()
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
    if windows_integration::protocol_invite_from_args(&std::env::args().skip(1).collect::<Vec<_>>())
        .is_err()
    {
        eprintln!("Argumentos de protocolo recusados");
        return Ok(());
    }
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
            exit_on_close_request: false,
            ..Default::default()
        })
        .centered()
        .run()
}
