//! Explicit renderer QA fixture only. Never loaded by a normal desktop launch.
use voxy_core::{
    model::ChannelKind,
    room::{Action, Command, RoomHost, Snapshot},
    store::Store,
};
pub fn seed(path: &std::path::Path) -> anyhow::Result<Snapshot> {
    let mut store = Store::open(&path.join("voxy.sqlite"))?;
    let mut profile = store.profile()?;
    profile.name = "Marina".into();
    store.save_profile(&profile)?;
    let server = store.create_community(profile.id, "After Hours")?;
    store.create_community(profile.id, "Café da noite")?;
    store.create_community(profile.id, "Projeto co-op")?;
    let channels = store.channels(server.id)?;
    let text = channels
        .iter()
        .find(|c| c.kind == ChannelKind::Text)
        .unwrap()
        .id;
    let voice = channels
        .iter()
        .find(|c| c.kind == ChannelKind::Voice)
        .unwrap()
        .id;
    store.add_channel(profile.id, server.id, "clipes-e-links", ChannelKind::Text)?;
    store.add_channel(profile.id, server.id, "Cinema", ChannelKind::Voice)?;
    let host = "h".repeat(43);
    let mut room = RoomHost::new(store, server, host.clone())?;
    room.admit(host.clone(), profile.id, profile.name.clone())?;
    let mut people = vec![(host.clone(), profile.id, profile.name.clone())];
    let command = |action| Command {
        id: uuid::Uuid::new_v4(),
        action,
    };
    for (index, name) in [
        "Lia", "Caio", "Rafa", "Nina", "Davi", "Bia", "Theo", "Luana", "Mirela",
    ]
    .iter()
    .enumerate()
    {
        let key = format!("fixture-{index}-{}", uuid::Uuid::new_v4());
        let id = uuid::Uuid::new_v4();
        room.admit(key.clone(), id, (*name).into())?;
        if index < 2 {
            room.handle(&key, command(Action::FriendRequest { to: profile.id }))?;
            room.handle(
                &host,
                command(Action::FriendRespond {
                    requester: id,
                    accept: true,
                }),
            )?;
            room.handle(&key, command(Action::VoiceJoin { channel: voice }))?;
            room.handle(
                &key,
                command(Action::Direct {
                    to: profile.id,
                    text: if index == 0 {
                        "Te mando o convite da próxima partida por aqui."
                    } else {
                        "Cheguei! Vamos de co-op hoje?"
                    }
                    .into(),
                }),
            )?;
        }
        if index == 2 {
            room.handle(&key, command(Action::FriendRequest { to: profile.id }))?;
        }
        people.push((key, id, (*name).into()));
    }
    let lines = [
        "Alguém já está por aqui?",
        "Cheguei! Só terminando de configurar o microfone.",
        "Podemos começar pelo co-op e depois mudar de jogo.",
        "Fechado. Deixei uma sala de voz aberta para o grupo.",
        "O volume ficou bom por aí?",
        "Sim, tudo certo. Vou chamar a Nina.",
        "Separei uns clipes da última partida para ver depois.",
        "Mais uma e a gente faz uma pausa ☕",
        "Entrando agora. Me esperem no lobby!",
        "Boa! O grupo está completo.",
    ];
    for i in 0..30 {
        room.handle(
            &people[i % people.len()].0,
            command(Action::Message {
                channel: text,
                text: lines[i % lines.len()].into(),
            }),
        )?;
    }
    let mut snapshot = room.snapshot()?;
    let count = snapshot.messages.len();
    for (i, message) in snapshot.messages.iter_mut().enumerate() {
        message.time -= ((count - i) * 60000) as i64;
    }
    Ok(snapshot)
}
