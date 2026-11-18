//! persist-3: server identity across hosting sessions, short invites, profile
//! media and inline images, with three real application instances.
use crate::{Participant, Run};
use anyhow::{Context, Result};
use serde_json::{Value, json};

fn code(ui: &Value) -> Option<String> {
    ui["session"]["inviteCode"].as_str().map(str::to_owned)
}
fn connected(ui: &Value) -> bool {
    ui["snapshot"]["server"] == "E2E Amigos"
}
fn saved_once(ui: &Value) -> bool {
    ui["communities"]
        .as_array()
        .is_some_and(|c| c.iter().filter(|n| *n == "E2E Amigos").count() == 1)
}
/// Writes a small valid PNG (solid colour + stripe) that the instance will "pick".
fn write_png(path: &std::path::Path, size: u32, rgb: [u8; 3]) -> Result<()> {
    let file = std::fs::File::create(path)?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), size, size);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut data = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            let stripe = (x / 8 + y / 8) % 2 == 0;
            let c = if stripe {
                rgb
            } else {
                [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]]
            };
            data.extend_from_slice(&[c[0], c[1], c[2], 255]);
        }
    }
    encoder.write_header()?.write_image_data(&data)?;
    Ok(())
}

pub fn steps(people: &mut [Participant], run: &mut Run, link: &str) -> Result<()> {
    let host_ui = people[0].ui();
    let first_code = code(&host_ui).context("código curto ausente no host")?;
    run.check(
        "link curto copiado pela interface",
        link.ends_with(&format!("/join/{first_code}")) && link.len() < 64,
        json!({"link":link,"code":first_code}),
    )?;
    // Invalid code is refused without joining.
    {
        let c = &mut people[2];
        c.nav("Início")?;
        c.click("Entrar por convite")?;
        c.type_text("invite", "ZZZZ-ZZZZ")?;
        c.click("Entrar")?;
        let ui = c.wait("código inválido recusado", 20, |ui| {
            ui["status"]
                .as_str()
                .is_some_and(|s| s.contains("inválido"))
        })?;
        run.check(
            "código inválido recusado",
            ui["snapshot"].is_null(),
            json!({"status":ui["status"]}),
        )?;
    }
    // Bruno joins with the link, Clara types the bare code.
    for (index, input) in [
        (1usize, link.to_owned()),
        (2, first_code.to_lowercase().replace('-', "")),
    ] {
        let p = &mut people[index];
        if index == 2 {
            p.click("Cancelar")?;
        }
        p.nav("Início")?;
        p.click("Entrar por convite")?;
        p.type_text("invite", &input)?;
        p.click("Entrar")?;
        let ui = p.wait("entrou pelo convite curto", 60, connected)?;
        run.check(
            &format!(
                "{} entrou com {}",
                p.name,
                if index == 1 {
                    "o link"
                } else {
                    "o código digitado"
                }
            ),
            true,
            json!({"phase":ui["session"]["phase"]}),
        )?;
    }
    // Profile photo: Bruno picks one; host and Clara must receive and display it.
    let avatar = people[1].auto.join("pick.png");
    write_png(&avatar, 96, [40, 160, 220])?;
    {
        let b = &mut people[1];
        b.click("Configurações")?;
        b.click("Perfil")?;
        b.click("Escolher foto")?;
        b.wait("foto aplicada localmente", 15, |ui| {
            ui["ownMedia"]
                .as_array()
                .is_some_and(|m| m.iter().any(|k| k == "avatar"))
        })?;
    }
    for index in [0usize, 2] {
        let ui = people[index].wait("foto de Bruno recebida", 45, |ui| {
            ui["memberMedia"].as_array().is_some_and(|m| {
                m.iter()
                    .any(|x| x["name"] == "Bruno" && x["avatarShown"] == true)
            })
        })?;
        run.check(
            &format!("{} vê a foto de perfil de Bruno", people[index].name),
            true,
            json!({"memberMedia":ui["memberMedia"]}),
        )?;
    }
    // Inline chat image from Bruno, rendered by the others without opening a file.
    write_png(&avatar, 320, [230, 90, 40])?;
    {
        let b = &mut people[1];
        b.click("server-E2E Amigos")?;
        b.click("conversa")?;
        b.click("Enviar imagem (PNG/JPEG até 3 MiB)")?;
        b.wait("imagem enviada e exibida para o remetente", 30, |ui| {
            ui["mediaReady"].as_array().is_some_and(|m| !m.is_empty())
        })?;
    }
    for index in [0usize, 2] {
        let ui = people[index].wait("imagem exibida no chat", 45, |ui| {
            ui["mediaReady"].as_array().is_some_and(|m| !m.is_empty())
        })?;
        run.check(
            &format!("{} recebe a imagem inline no chat", people[index].name),
            true,
            json!({"mediaReady":ui["mediaReady"]}),
        )?;
    }
    for p in people.iter_mut() {
        p.screenshot(&run.evidence, "media")?;
    }
    // Host stops hosting: guests see the saved server as offline (not removed).
    people[0].click("Desconectar do servidor")?;
    for index in [1usize, 2] {
        let ui = people[index].wait("servidor offline", 45, |ui| {
            !ui["session"]["waitingHost"].is_null()
        })?;
        run.check(
            &format!(
                "{} vê o servidor offline e mantém o salvo",
                people[index].name
            ),
            saved_once(&ui),
            json!({"phase":ui["session"]["phase"],"communities":ui["communities"]}),
        )?;
    }
    // Host again: same code; guests return by themselves, no new invite.
    let rehost = |people: &mut [Participant], run: &mut Run, label: &str| -> Result<()> {
        people[0].click("Hospedar servidor")?;
        let ui = people[0].wait("host novamente", 60, |ui| {
            connected(ui) && ui["session"]["inviteCode"].is_string()
        })?;
        run.check(
            &format!("{label}: mesmo código"),
            code(&ui) == code(&host_ui),
            json!({"code":code(&ui)}),
        )?;
        for index in [1usize, 2] {
            let ui = people[index].wait("reconectou pelo servidor salvo", 90, connected)?;
            run.check(
                &format!("{label}: {} voltou sem novo convite", people[index].name),
                saved_once(&ui),
                json!({"communities":ui["communities"]}),
            )?;
        }
        Ok(())
    };
    rehost(people, run, "re-hospedar")?;
    // Full restart of the host application (UI and core).
    people[0].stop();
    for index in [1usize, 2] {
        people[index].wait("host fechado: offline", 60, |ui| {
            !ui["session"]["waitingHost"].is_null()
        })?;
    }
    people[0].launch()?;
    people[0].click("server-E2E Amigos")?;
    rehost(people, run, "após reiniciar o host")?;
    // Guest restarts its own app and uses "Reconectar" on the saved server.
    people[2].stop();
    people[2].launch()?;
    people[2].click("server-E2E Amigos")?;
    people[2].click("Reconectar")?;
    let ui = people[2].wait("Clara reconecta após reiniciar", 60, connected)?;
    run.check(
        "Clara reconecta pelo servidor salvo após reiniciar o app",
        saved_once(&ui),
        json!({"phase":ui["session"]["phase"]}),
    )?;
    // Revocation: new code; members keep access through their saved pass.
    people[0].click("Gerenciar servidor")?;
    people[0].click("Revogar e gerar novo")?;
    let ui = people[0].wait("novo código após revogar", 60, |ui| {
        code(ui).is_some_and(|c| Some(c) != code(&host_ui))
    })?;
    run.check(
        "revogação gera outro código",
        true,
        json!({"code":code(&ui)}),
    )?;
    // Guests are disconnected by the revocation; require an actual new session.
    for index in [1usize, 2] {
        people[index].wait("convidado desconectado pela revogação", 30, |ui| {
            ui["session"]["phase"] != "Conectado" || ui["snapshot"].is_null()
        })?;
    }
    for index in [1usize, 2] {
        let ui = people[index].wait("membro volta após revogação", 90, |ui| {
            connected(ui) && ui["session"]["phase"] == "Conectado"
        })?;
        run.check(
            &format!(
                "{} mantém acesso salvo após revogar o convite",
                people[index].name
            ),
            true,
            json!({"phase":ui["session"]["phase"]}),
        )?;
    }
    Ok(())
}
