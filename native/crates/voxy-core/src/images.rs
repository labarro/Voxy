//! Bounded authenticated image uploads. Transfers are ephemeral; only a fully
//! decoded PNG/JPEG is committed. No supplied filename is used as a disk path.
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Cursor};
use uuid::Uuid;
pub const MAX_IMAGE_BYTES: usize = 3 * 1024 * 1024;
pub const IMAGE_CHUNK_BYTES: usize = 32 * 1024;
pub const UPLOAD_TTL_MS: i64 = 60_000;
pub const MAX_DECODED_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_SERVER_IMAGE_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_TOTAL_IMAGE_BYTES: u64 = 256 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ImageTarget {
    Channel {
        channel: Uuid,
    },
    Direct {
        to: Uuid,
    },
    /// The uploader's own profile photo or banner on this server.
    Profile {
        media: ProfileImage,
    },
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProfileImage {
    Avatar,
    Banner,
}
impl ProfileImage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Avatar => "avatar",
            Self::Banner => "banner",
        }
    }
}
/// Profile media must also fit a sane display size (the decoder limit still applies).
pub const MAX_PROFILE_DIMENSION: u32 = 4096;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageMetadata {
    pub id: Uuid,
    pub name: String,
    pub mime: String,
    pub size: u32,
    pub width: u32,
    pub height: u32,
    pub sha256: String,
}
pub struct ValidatedImage {
    pub metadata: ImageMetadata,
    pub bytes: Vec<u8>,
}
pub(crate) fn initialize(store: &crate::store::Store) -> Result<()> {
    store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_image_data(id TEXT PRIMARY KEY,server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,uploader TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,sha256 TEXT NOT NULL,bytes BLOB NOT NULL,created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS native_message_images(message TEXT PRIMARY KEY REFERENCES native_messages(id) ON DELETE CASCADE,image TEXT UNIQUE NOT NULL REFERENCES native_image_data(id) ON DELETE CASCADE);
        CREATE TRIGGER IF NOT EXISTS native_message_image_cleanup AFTER DELETE ON native_message_images BEGIN DELETE FROM native_image_data WHERE id=OLD.image; END;
        CREATE TABLE IF NOT EXISTS native_profile_media(server TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,member TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('avatar','banner')),image TEXT UNIQUE NOT NULL REFERENCES native_image_data(id) ON DELETE CASCADE,PRIMARY KEY(server,member,kind));
        CREATE TRIGGER IF NOT EXISTS native_profile_media_cleanup AFTER DELETE ON native_profile_media BEGIN DELETE FROM native_image_data WHERE id=OLD.image; END;")?;
    Ok(())
}
/// Replaces (or with None clears) a member's profile photo/banner on this server.
pub(crate) fn set_profile_media(
    store: &crate::store::Store,
    server: Uuid,
    member: Uuid,
    kind: ProfileImage,
    image: Option<&ValidatedImage>,
) -> Result<()> {
    store.db.execute(
        "DELETE FROM native_profile_media WHERE server=?1 AND member=?2 AND kind=?3",
        rusqlite::params![server.to_string(), member.to_string(), kind.as_str()],
    )?;
    let Some(image) = image else {
        return Ok(());
    };
    ensure!(
        image.metadata.width <= MAX_PROFILE_DIMENSION
            && image.metadata.height <= MAX_PROFILE_DIMENSION,
        "Imagem de perfil excede 4096 px"
    );
    insert_data(store, server, member, image)?;
    store.db.execute(
        "INSERT INTO native_profile_media VALUES(?1,?2,?3,?4)",
        rusqlite::params![
            server.to_string(),
            member.to_string(),
            kind.as_str(),
            image.metadata.id.to_string()
        ],
    )?;
    Ok(())
}
pub(crate) fn profile_media(
    store: &crate::store::Store,
    server: Uuid,
) -> Result<std::collections::HashMap<(Uuid, String), ImageMetadata>> {
    let mut query = store.db.prepare("SELECT p.member,p.kind,i.id,i.name,i.mime,i.size,i.width,i.height,i.sha256 FROM native_profile_media p JOIN native_image_data i ON i.id=p.image WHERE p.server=?1")?;
    let rows = query.query_map([server.to_string()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, u32>(5)?,
            row.get::<_, u32>(6)?,
            row.get::<_, u32>(7)?,
            row.get::<_, String>(8)?,
        ))
    })?;
    let mut media = std::collections::HashMap::new();
    for row in rows {
        let (member, kind, id, name, mime, size, width, height, sha256) = row?;
        media.insert(
            (Uuid::parse_str(&member)?, kind),
            ImageMetadata {
                id: Uuid::parse_str(&id)?,
                name,
                mime,
                size,
                width,
                height,
                sha256,
            },
        );
    }
    Ok(media)
}
pub(crate) fn initialize_direct(store: &crate::store::Store) -> Result<()> {
    store.db.execute_batch("CREATE TABLE IF NOT EXISTS native_direct_images(message TEXT PRIMARY KEY REFERENCES native_direct(id) ON DELETE CASCADE,image TEXT UNIQUE NOT NULL REFERENCES native_image_data(id) ON DELETE CASCADE);
        CREATE TRIGGER IF NOT EXISTS native_direct_image_cleanup AFTER DELETE ON native_direct_images BEGIN DELETE FROM native_image_data WHERE id=OLD.image; END;")?;
    Ok(())
}
pub(crate) fn persist(
    store: &crate::store::Store,
    server: Uuid,
    actor: Uuid,
    message: Uuid,
    direct: bool,
    image: &ValidatedImage,
) -> Result<()> {
    let server_bytes: u64 = store.db.query_row(
        "SELECT COALESCE(SUM(size),0) FROM native_image_data WHERE server=?1",
        [server.to_string()],
        |row| row.get(0),
    )?;
    let total_bytes: u64 = store.db.query_row(
        "SELECT COALESCE(SUM(size),0) FROM native_image_data",
        [],
        |row| row.get(0),
    )?;
    ensure!(
        server_bytes + u64::from(image.metadata.size) <= MAX_SERVER_IMAGE_BYTES
            && total_bytes + u64::from(image.metadata.size) <= MAX_TOTAL_IMAGE_BYTES,
        "Armazenamento de imagens atingiu a cota; exclua anexos antigos antes de enviar"
    );
    insert_data(store, server, actor, image)?;
    let m = &image.metadata;
    let table = if direct {
        "native_direct_images"
    } else {
        "native_message_images"
    };
    store.db.execute(
        &format!("INSERT INTO {table}(message,image) VALUES(?1,?2)"),
        rusqlite::params![message.to_string(), m.id.to_string()],
    )?;
    Ok(())
}
fn insert_data(
    store: &crate::store::Store,
    server: Uuid,
    actor: Uuid,
    image: &ValidatedImage,
) -> Result<()> {
    let total_bytes: u64 = store.db.query_row(
        "SELECT COALESCE(SUM(size),0) FROM native_image_data WHERE server=?1",
        [server.to_string()],
        |row| row.get(0),
    )?;
    ensure!(
        total_bytes + u64::from(image.metadata.size) <= MAX_SERVER_IMAGE_BYTES,
        "Armazenamento de imagens atingiu a cota; exclua anexos antigos antes de enviar"
    );
    let m = &image.metadata;
    store.db.execute(
        "INSERT INTO native_image_data VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        rusqlite::params![
            m.id.to_string(),
            server.to_string(),
            actor.to_string(),
            m.name,
            m.mime,
            m.size,
            m.width,
            m.height,
            m.sha256,
            image.bytes,
            crate::store::now_ms()
        ],
    )?;
    Ok(())
}
pub(crate) fn attachments(
    store: &crate::store::Store,
    message: Uuid,
    direct: bool,
) -> Result<Vec<ImageMetadata>> {
    let table = if direct {
        "native_direct_images"
    } else {
        "native_message_images"
    };
    let mut query=store.db.prepare(&format!("SELECT i.id,i.name,i.mime,i.size,i.width,i.height,i.sha256 FROM native_image_data i JOIN {table} l ON l.image=i.id WHERE l.message=?1"))?;
    query
        .query_map([message.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u32>(3)?,
                row.get::<_, u32>(4)?,
                row.get::<_, u32>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .map(|row| {
            let (id, name, mime, size, width, height, sha256) = row?;
            Ok(ImageMetadata {
                id: Uuid::parse_str(&id)?,
                name,
                mime,
                size,
                width,
                height,
                sha256,
            })
        })
        .collect()
}
pub(crate) fn read_chunk(
    store: &crate::store::Store,
    server: Uuid,
    actor: Uuid,
    id: Uuid,
    offset: u32,
) -> Result<serde_json::Value> {
    let allowed:bool=store.db.query_row("SELECT EXISTS(SELECT 1 FROM native_image_data i WHERE i.id=?1 AND i.server=?2 AND (EXISTS(SELECT 1 FROM native_message_images l JOIN native_messages m ON m.id=l.message JOIN native_channels c ON c.id=m.channel_id WHERE l.image=i.id AND c.server_id=?2) OR EXISTS(SELECT 1 FROM native_direct_images l JOIN native_direct d ON d.id=l.message WHERE l.image=i.id AND d.server=?2 AND (d.sender=?3 OR d.recipient=?3)) OR EXISTS(SELECT 1 FROM native_profile_media p WHERE p.image=i.id AND p.server=?2)))",rusqlite::params![id.to_string(),server.to_string(),actor.to_string()],|row|row.get(0))?;
    ensure!(allowed, "Imagem inexistente ou acesso não autorizado");
    let (name, mime, size, width, height, hash): (String, String, u32, u32, u32, String) =
        store.db.query_row(
            "SELECT name,mime,size,width,height,sha256 FROM native_image_data WHERE id=?1",
            [id.to_string()],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )?;
    ensure!(offset <= size, "Offset de leitura inválido");
    let bytes: Vec<u8> = store.db.query_row(
        "SELECT SUBSTR(bytes,?2,?3) FROM native_image_data WHERE id=?1",
        rusqlite::params![
            id.to_string(),
            u64::from(offset) + 1,
            IMAGE_CHUNK_BYTES as u32
        ],
        |row| row.get(0),
    )?;
    let next = offset + bytes.len() as u32;
    Ok(
        serde_json::json!({"image":ImageMetadata{id,name,mime,size,width,height,sha256:hash},"offset":offset,"data":STANDARD.encode(bytes),"next":next,"done":next==size}),
    )
}
/// Decodes PNG/JPEG under the same limits as validation and returns an RGBA
/// thumbnail whose longer side is at most `max_side`. Used once per image so
/// rendering never decodes full-size originals again.
pub fn thumbnail(bytes: &[u8], max_side: u32) -> Result<(u32, u32, Vec<u8>)> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_IMAGE_BYTES && (16..=4096).contains(&max_side),
        "Imagem inválida"
    );
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    ensure!(
        matches!(
            reader.format(),
            Some(image::ImageFormat::Png | image::ImageFormat::Jpeg)
        ),
        "Somente PNG e JPEG são aceitos"
    );
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    reader.limits(limits);
    let decoded = reader.decode()?;
    ensure!(
        u64::from(decoded.width()) * u64::from(decoded.height()) <= 8_388_608,
        "Imagem excede os limites de pixels"
    );
    let scaled = if decoded.width() > max_side || decoded.height() > max_side {
        decoded.thumbnail(max_side, max_side)
    } else {
        decoded
    };
    let rgba = scaled.to_rgba8();
    Ok((rgba.width(), rgba.height(), rgba.into_raw()))
}
pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn validate_image(name: &str, bytes: Vec<u8>, expected_sha256: &str) -> Result<ValidatedImage> {
    validate_name(name)?;
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_IMAGE_BYTES,
        "Imagem excede o limite de 3 MiB"
    );
    validate_hash(expected_sha256)?;
    let digest = sha256(&bytes);
    ensure!(digest == expected_sha256, "Hash da imagem divergente");
    let mut reader = image::ImageReader::new(Cursor::new(&bytes)).with_guessed_format()?;
    let format = reader
        .format()
        .context("Formato de imagem não reconhecido")?;
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        _ => anyhow::bail!("Somente PNG e JPEG são aceitos"),
    };
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    ensure!(
        (mime == "image/png" && extension == "png")
            || (mime == "image/jpeg" && ["jpg", "jpeg"].contains(&extension.as_str())),
        "Extensão e conteúdo da imagem não correspondem"
    );
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    reader.limits(limits);
    use image::ImageDecoder;
    let decoder = reader.into_decoder()?;
    let (width, height) = decoder.dimensions();
    ensure!(
        width > 0
            && height > 0
            && u64::from(width) * u64::from(height) <= 8_388_608
            && decoder.total_bytes() <= MAX_DECODED_BYTES,
        "Imagem excede os limites de dimensão ou pixels decodificados"
    );
    // Full decoding validates compressed contents, not just magic/header bytes.
    let decoded = image::DynamicImage::from_decoder(decoder)?;
    ensure!(
        decoded.width() == width && decoded.height() == height,
        "Dimensões inconsistentes"
    );
    drop(decoded);
    Ok(ValidatedImage {
        metadata: ImageMetadata {
            id: Uuid::new_v4(),
            name: name.into(),
            mime: mime.into(),
            size: bytes.len() as u32,
            width,
            height,
            sha256: digest,
        },
        bytes,
    })
}
fn validate_hash(value: &str) -> Result<()> {
    ensure!(
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "SHA-256 inválido"
    );
    Ok(())
}
fn validate_name(name: &str) -> Result<()> {
    ensure!(
        !name.is_empty()
            && name.len() <= 180
            && !name.starts_with('.')
            && !name.ends_with(['.', ' '])
            && !name.contains(['/', '\\', ':', '"', '<', '>', '|', '?', '*'])
            && !name.chars().any(char::is_control),
        "Nome de arquivo inválido"
    );
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    ensure!(
        !["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
            && !(stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.as_bytes()[3].is_ascii_digit()),
        "Nome de arquivo reservado pelo Windows"
    );
    Ok(())
}
struct Upload {
    owner: Uuid,
    target: ImageTarget,
    name: String,
    total: usize,
    hash: String,
    created: i64,
    bytes: Vec<u8>,
}
#[derive(Default)]
pub struct Uploads {
    pending: BTreeMap<Uuid, Upload>,
}
impl Uploads {
    fn prune(&mut self, now: i64) {
        self.pending
            .retain(|_, upload| now >= upload.created && now - upload.created < UPLOAD_TTL_MS);
    }
    pub fn remove_owner(&mut self, owner: Uuid) {
        self.pending.retain(|_, upload| upload.owner != owner);
    }
    // Keep the authenticated owner and clock explicit alongside the wire fields.
    #[allow(clippy::too_many_arguments)]
    pub fn begin(
        &mut self,
        owner: Uuid,
        id: Uuid,
        target: ImageTarget,
        name: String,
        total: u32,
        hash: String,
        now: i64,
    ) -> Result<usize> {
        self.prune(now);
        ensure!(!id.is_nil(), "Identificador de upload inválido");
        validate_name(&name)?;
        validate_hash(&hash)?;
        ensure!(
            (1..=MAX_IMAGE_BYTES).contains(&(total as usize)),
            "Imagem excede o limite de 3 MiB"
        );
        if let Some(upload) = self.pending.get(&id) {
            ensure!(
                upload.owner == owner
                    && upload.target == target
                    && upload.name == name
                    && upload.total == total as usize
                    && upload.hash == hash,
                "Upload já pertence a outra operação"
            );
            return Ok(upload.bytes.len());
        }
        ensure!(
            self.pending.len() < 8
                && self
                    .pending
                    .values()
                    .filter(|upload| upload.owner == owner)
                    .count()
                    < 2,
            "Limite de uploads simultâneos atingido"
        );
        self.pending.insert(
            id,
            Upload {
                owner,
                target,
                name,
                total: total as usize,
                hash,
                created: now,
                bytes: Vec::with_capacity(total as usize),
            },
        );
        Ok(0)
    }
    pub fn chunk(
        &mut self,
        owner: Uuid,
        id: Uuid,
        offset: u32,
        encoded: &str,
        now: i64,
    ) -> Result<usize> {
        self.prune(now);
        ensure!(
            encoded.len() <= IMAGE_CHUNK_BYTES.div_ceil(3) * 4,
            "Bloco de imagem excede o limite"
        );
        let data = STANDARD.decode(encoded)?;
        ensure!(
            !data.is_empty()
                && data.len() <= IMAGE_CHUNK_BYTES
                && STANDARD.encode(&data) == encoded,
            "Bloco de imagem inválido"
        );
        let upload = self
            .pending
            .get_mut(&id)
            .context("Upload expirado ou inexistente")?;
        ensure!(
            upload.owner == owner,
            "Upload pertence a outro participante"
        );
        let offset = offset as usize;
        ensure!(
            offset <= upload.bytes.len() && offset + data.len() <= upload.total,
            "Offset de imagem inválido"
        );
        if offset < upload.bytes.len() {
            ensure!(
                offset + data.len() <= upload.bytes.len()
                    && upload.bytes[offset..offset + data.len()] == data,
                "Repetição de bloco divergente"
            );
            return Ok(upload.bytes.len());
        }
        upload.bytes.extend_from_slice(&data);
        Ok(upload.bytes.len())
    }
    pub fn cancel(&mut self, owner: Uuid, id: Uuid) -> Result<()> {
        if let Some(upload) = self.pending.get(&id) {
            ensure!(
                upload.owner == owner,
                "Upload pertence a outro participante"
            );
        }
        self.pending.remove(&id);
        Ok(())
    }
    pub fn finish(
        &mut self,
        owner: Uuid,
        id: Uuid,
        now: i64,
    ) -> Result<(ImageTarget, ValidatedImage)> {
        self.prune(now);
        let upload = self
            .pending
            .get(&id)
            .context("Upload expirado ou inexistente")?;
        ensure!(
            upload.owner == owner && upload.bytes.len() == upload.total,
            "Upload incompleto ou não autorizado"
        );
        // Keep the transfer until the surrounding database transaction commits.
        // A quota/ACL/database failure must allow a retry without re-uploading.
        Ok((
            upload.target.clone(),
            validate_image(&upload.name, upload.bytes.clone(), &upload.hash)?,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn send_image(
        room: &mut crate::room::RoomHost,
        key: &str,
        target: ImageTarget,
    ) -> (serde_json::Value, crate::room::Command) {
        use crate::room::{Action, Command};
        let bytes = png();
        let upload = Uuid::new_v4();
        let command = |action| Command {
            id: Uuid::new_v4(),
            action,
        };
        room.handle(
            key,
            command(Action::ImageBegin {
                upload,
                target,
                name: "fixture.png".into(),
                total_bytes: bytes.len() as u32,
                sha256: sha256(&bytes),
            }),
        )
        .unwrap();
        let part = command(Action::ImageChunk {
            upload,
            offset: 0,
            data: STANDARD.encode(&bytes),
        });
        room.handle(key, part.clone()).unwrap();
        room.handle(key, part).unwrap();
        let commit = command(Action::ImageCommit {
            upload,
            text: String::new(),
        });
        (room.handle(key, commit.clone()).unwrap(), commit)
    }
    #[test]
    fn image_messages_persist_replay_once_and_private_bytes_require_recipient_authorization() {
        use crate::{
            model::ChannelKind,
            room::{Action, Command, RoomHost},
            store::Store,
        };
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("images.sqlite");
        let mut store = Store::open(&database).unwrap();
        let owner = store.profile().unwrap().id;
        let server = store.create_community(owner, "Images").unwrap();
        let server_copy = server.clone();
        let channel = store
            .channels(server.id)
            .unwrap()
            .into_iter()
            .find(|channel| channel.kind == ChannelKind::Text)
            .unwrap()
            .id;
        let other = store.create_community(owner, "Other").unwrap();
        let foreign_channel = store.channels(other.id).unwrap()[0].id;
        let keys = ["h".repeat(43), "g".repeat(43), "r".repeat(43)];
        let actors = [owner, Uuid::new_v4(), Uuid::new_v4()];
        let mut room = RoomHost::new(store, server, keys[0].clone()).unwrap();
        for index in 0..3 {
            room.admit(keys[index].clone(), actors[index], format!("Person{index}"))
                .unwrap();
        }
        let command = |action| Command {
            id: Uuid::new_v4(),
            action,
        };
        let begin = |target| {
            command(Action::ImageBegin {
                upload: Uuid::new_v4(),
                target,
                name: "fixture.png".into(),
                total_bytes: png().len() as u32,
                sha256: sha256(&png()),
            })
        };
        assert!(
            room.handle(
                &keys[1],
                begin(ImageTarget::Channel {
                    channel: foreign_channel
                })
            )
            .is_err()
        );
        assert!(
            room.handle(&keys[1], begin(ImageTarget::Direct { to: actors[2] }))
                .is_err()
        );
        let (public, replay) = send_image(&mut room, &keys[1], ImageTarget::Channel { channel });
        assert_eq!(room.handle(&keys[1], replay).unwrap(), public);
        let image = Uuid::parse_str(public["image"]["id"].as_str().unwrap()).unwrap();
        let message = Uuid::parse_str(public["id"].as_str().unwrap()).unwrap();
        let snapshot = room.snapshot_for(&keys[0]).unwrap();
        assert_eq!(snapshot.messages.len(), 1);
        assert_eq!(snapshot.messages[0].attachments[0].id, image);
        assert!(snapshot.messages[0].text.is_empty());
        assert!(
            serde_json::to_value(&snapshot).unwrap()["messages"][0]["attachments"][0]
                .get("bytes")
                .is_none()
        );
        let read = room
            .handle(
                &keys[2],
                command(Action::ImageRead {
                    id: image,
                    offset: 0,
                }),
            )
            .unwrap();
        assert_eq!(
            STANDARD.decode(read["data"].as_str().unwrap()).unwrap(),
            png()
        );
        assert_eq!(read["done"], true);
        assert!(
            room.handle(
                &keys[2],
                command(Action::ImageRead {
                    id: image,
                    offset: u32::MAX
                })
            )
            .is_err()
        );
        room.handle(&keys[1], command(Action::FriendRequest { to: actors[2] }))
            .unwrap();
        room.handle(
            &keys[2],
            command(Action::FriendRespond {
                requester: actors[1],
                accept: true,
            }),
        )
        .unwrap();
        let (private, _) = send_image(&mut room, &keys[1], ImageTarget::Direct { to: actors[2] });
        let private_image = Uuid::parse_str(private["image"]["id"].as_str().unwrap()).unwrap();
        let private_message = Uuid::parse_str(private["id"].as_str().unwrap()).unwrap();
        assert!(room.snapshot_for(&keys[0]).unwrap().direct.is_empty());
        assert!(
            room.handle(
                &keys[0],
                command(Action::ImageRead {
                    id: private_image,
                    offset: 0
                })
            )
            .is_err()
        );
        assert!(
            room.handle(
                &keys[2],
                command(Action::ImageRead {
                    id: private_image,
                    offset: 0
                })
            )
            .is_ok()
        );
        drop(room);
        let mut room = RoomHost::new(
            Store::open(&database).unwrap(),
            server_copy,
            keys[0].clone(),
        )
        .unwrap();
        for index in 0..3 {
            room.admit(keys[index].clone(), actors[index], format!("Person{index}"))
                .unwrap();
        }
        assert_eq!(
            room.snapshot_for(&keys[2]).unwrap().direct[0].attachments[0].id,
            private_image
        );
        room.handle(&keys[1], command(Action::FriendRemove { peer: actors[2] }))
            .unwrap();
        assert!(
            room.handle(
                &keys[2],
                command(Action::ImageRead {
                    id: private_image,
                    offset: 0
                })
            )
            .is_ok()
        );
        room.handle(
            &keys[1],
            command(Action::DirectDelete {
                id: private_message,
            }),
        )
        .unwrap();
        assert!(
            room.handle(
                &keys[2],
                command(Action::ImageRead {
                    id: private_image,
                    offset: 0
                })
            )
            .is_err()
        );
        room.handle(&keys[1], command(Action::Delete { id: message }))
            .unwrap();
        assert!(
            room.handle(
                &keys[0],
                command(Action::ImageRead {
                    id: image,
                    offset: 0
                })
            )
            .is_err()
        );
        let store = Store::open(&database).unwrap();
        let blobs: u32 = store
            .db
            .query_row("SELECT COUNT(*) FROM native_image_data", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(blobs, 0);
        let transfer_receipts: u32 = store
            .db
            .query_row(
                "SELECT COUNT(*) FROM native_receipts WHERE response LIKE '%received%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(transfer_receipts, 0);
    }
    pub(crate) fn png() -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }
    #[test]
    fn decoder_rejects_traversal_mismatch_corruption_and_accepts_png_jpeg() {
        let bytes = png();
        let hash = sha256(&bytes);
        let image = validate_image("safe.png", bytes.clone(), &hash).unwrap();
        assert_eq!((image.metadata.width, image.metadata.height), (2, 2));
        for name in [
            "../evil.png",
            r"C:\evil.png",
            "CON.png",
            "a.png.",
            "safe.jpg",
        ] {
            assert!(validate_image(name, bytes.clone(), &hash).is_err());
        }
        assert!(validate_image("safe.png", bytes.clone(), &"0".repeat(64)).is_err());
        let truncated = bytes[..bytes.len() / 2].to_vec();
        assert!(validate_image("safe.png", truncated.clone(), &sha256(&truncated)).is_err());
        let mut jpeg = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut jpeg, image::ImageFormat::Jpeg)
            .unwrap();
        let jpeg = jpeg.into_inner();
        assert_eq!(
            validate_image("safe.jpg", jpeg.clone(), &sha256(&jpeg))
                .unwrap()
                .metadata
                .mime,
            "image/jpeg"
        );
        let oversized = vec![0; MAX_IMAGE_BYTES + 1];
        assert!(validate_image("safe.png", oversized, &hash).is_err());
        let mut wide = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(8193, 1)
            .write_to(&mut wide, image::ImageFormat::Png)
            .unwrap();
        let wide = wide.into_inner();
        assert!(validate_image("wide.png", wide.clone(), &sha256(&wide)).is_err());
    }
    #[test]
    fn bounded_uploads_bind_owner_order_hash_and_expiry_with_idempotent_chunks() {
        let owner = Uuid::new_v4();
        let foreign = Uuid::new_v4();
        let id = Uuid::new_v4();
        let target = ImageTarget::Channel {
            channel: Uuid::new_v4(),
        };
        let bytes = png();
        let mut uploads = Uploads::default();
        uploads
            .begin(
                owner,
                id,
                target.clone(),
                "safe.png".into(),
                bytes.len() as u32,
                sha256(&bytes),
                0,
            )
            .unwrap();
        let encoded = STANDARD.encode(&bytes);
        assert!(uploads.cancel(foreign, id).is_err());
        assert!(
            uploads
                .chunk(
                    owner,
                    id,
                    0,
                    &STANDARD.encode(vec![0; IMAGE_CHUNK_BYTES + 1]),
                    1
                )
                .is_err()
        );
        assert!(uploads.chunk(foreign, id, 0, &encoded, 1).is_err());
        assert!(uploads.chunk(owner, id, 1, &encoded, 1).is_err());
        assert_eq!(
            uploads.chunk(owner, id, 0, &encoded, 1).unwrap(),
            bytes.len()
        );
        assert_eq!(
            uploads.chunk(owner, id, 0, &encoded, 2).unwrap(),
            bytes.len()
        );
        assert!(
            uploads
                .chunk(owner, id, 0, &STANDARD.encode(vec![0; bytes.len()]), 2)
                .is_err()
        );
        assert!(uploads.finish(foreign, id, 2).is_err());
        assert!(uploads.finish(owner, id, 2).is_ok());
        assert!(uploads.cancel(foreign, id).is_err());
        uploads.cancel(owner, id).unwrap();
        uploads
            .begin(
                owner,
                id,
                target.clone(),
                "safe.png".into(),
                bytes.len() as u32,
                sha256(&bytes),
                10,
            )
            .unwrap();
        assert!(
            uploads
                .chunk(owner, id, 0, &encoded, 10 + UPLOAD_TTL_MS)
                .is_err()
        );
        for _ in 0..2 {
            uploads
                .begin(
                    owner,
                    Uuid::new_v4(),
                    target.clone(),
                    "safe.png".into(),
                    bytes.len() as u32,
                    sha256(&bytes),
                    100_000,
                )
                .unwrap();
        }
        assert!(
            uploads
                .begin(
                    owner,
                    Uuid::new_v4(),
                    target,
                    "safe.png".into(),
                    bytes.len() as u32,
                    sha256(&bytes),
                    100_000
                )
                .is_err()
        );
        uploads.remove_owner(owner);
        assert!(uploads.pending.is_empty());
    }
    #[test]
    fn quota_failure_rolls_back_message_and_preserves_upload_for_retry() {
        use crate::{
            model::ChannelKind,
            room::{Action, Command, RoomHost},
            store::Store,
        };
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("quota.sqlite");
        let mut store = Store::open(&database).unwrap();
        let owner = store.profile().unwrap().id;
        let server = store.create_community(owner, "Quota").unwrap();
        let channel = store
            .channels(server.id)
            .unwrap()
            .into_iter()
            .find(|c| c.kind == ChannelKind::Text)
            .unwrap()
            .id;
        let key = "o".repeat(43);
        let mut room = RoomHost::new(store, server.clone(), key.clone()).unwrap();
        room.admit(key.clone(), owner, "Owner".into()).unwrap();
        let (first, _) = send_image(&mut room, &key, ImageTarget::Channel { channel });
        let db = Store::open(&database).unwrap();
        db.db
            .execute(
                "UPDATE native_image_data SET size=?1",
                [MAX_SERVER_IMAGE_BYTES],
            )
            .unwrap();
        let command = |action| Command {
            id: Uuid::new_v4(),
            action,
        };
        let upload = Uuid::new_v4();
        let bytes = png();
        room.handle(
            &key,
            command(Action::ImageBegin {
                upload,
                target: ImageTarget::Channel { channel },
                name: "retry.png".into(),
                total_bytes: bytes.len() as u32,
                sha256: sha256(&bytes),
            }),
        )
        .unwrap();
        room.handle(
            &key,
            command(Action::ImageChunk {
                upload,
                offset: 0,
                data: STANDARD.encode(&bytes),
            }),
        )
        .unwrap();
        let commit = command(Action::ImageCommit {
            upload,
            text: "retry caption".into(),
        });
        assert!(room.handle(&key, commit.clone()).is_err());
        assert_eq!(room.snapshot_for(&key).unwrap().messages.len(), 1);
        let counts: (u32, u32) = db.db.query_row("SELECT (SELECT COUNT(*) FROM native_image_data),(SELECT COUNT(*) FROM native_message_images)", [], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(counts, (1, 1));
        let receipt: bool = db
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM native_receipts WHERE id=?1)",
                [commit.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!receipt);
        db.db
            .execute("UPDATE native_image_data SET size=?1", [bytes.len() as u32])
            .unwrap();
        let response = room.handle(&key, commit.clone()).unwrap();
        assert_ne!(response["image"]["id"], first["image"]["id"]);
        assert_eq!(room.handle(&key, commit.clone()).unwrap(), response);
        assert!(
            room.handle(
                &key,
                command(Action::ImageCommit {
                    upload,
                    text: "duplicate".into()
                })
            )
            .is_err()
        );
        drop(room);
        let mut room = RoomHost::new(Store::open(&database).unwrap(), server, key.clone()).unwrap();
        room.admit(key.clone(), owner, "Owner".into()).unwrap();
        assert_eq!(room.handle(&key, commit).unwrap(), response);
    }
}
