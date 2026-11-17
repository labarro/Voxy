//! Visual regressions on the pixels the window actually presented.
use crate::{Participant, Run, win};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

pub struct Shot {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}
pub fn save(path: &Path, shot: &Shot) -> Result<()> {
    let file = std::fs::File::create(path)?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), shot.w, shot.h);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(&shot.rgba)?;
    Ok(())
}
fn luma(p: &[u8]) -> f64 {
    0.2126 * p[0] as f64 + 0.7152 * p[1] as f64 + 0.0722 * p[2] as f64
}
/// Difference statistics inside a physical-pixel region.
pub fn compare(a: &Shot, b: &Shot, region: (u32, u32, u32, u32)) -> Value {
    let (x0, y0, x1, y1) = region;
    let (mut n, mut changed, mut sum, mut max, mut la, mut lb) =
        (0u64, 0u64, 0f64, 0u32, 0f64, 0f64);
    for y in y0..y1.min(a.h).min(b.h) {
        for x in x0..x1.min(a.w).min(b.w) {
            let i = ((y * a.w + x) * 4) as usize;
            let j = ((y * b.w + x) * 4) as usize;
            let d = (0..3)
                .map(|c| (a.rgba[i + c] as i32 - b.rgba[j + c] as i32).unsigned_abs())
                .max()
                .unwrap_or(0);
            n += 1;
            sum += d as f64;
            max = max.max(d);
            if d > 6 {
                changed += 1;
            }
            la += luma(&a.rgba[i..i + 3]);
            lb += luma(&b.rgba[j..j + 3]);
        }
    }
    let n = n.max(1) as f64;
    json!({"pixels":n,"changedFraction":changed as f64 / n,"meanDiff":sum / n,"maxDiff":max,
           "meanLumaBefore":la / n,"meanLumaAfter":lb / n})
}
fn diff_image(a: &Shot, b: &Shot) -> Shot {
    let mut rgba = a.rgba.clone();
    for (i, px) in rgba.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let d = (0..3)
            .map(|c| (a.rgba[i * 4 + c] as i32 - b.rgba[i * 4 + c] as i32).unsigned_abs())
            .max()
            .unwrap_or(0);
        let v = (d * 8).min(255) as u8;
        px.copy_from_slice(&[v, v, v, 255]);
    }
    Shot {
        w: a.w,
        h: a.h,
        rgba,
    }
}
pub fn grab(p: &Participant) -> Result<Shot> {
    let (w, h, rgba) = win::capture(p.hwnd()?)?;
    Ok(Shot { w, h, rgba })
}

/// 50 enter/leave cycles over every left-rail item (tooltips included), then the
/// presented pixels must match the initial capture with the cursor parked.
pub fn hover_cycles(p: &mut Participant, run: &mut Run, cycles: usize) -> Result<()> {
    let hwnd = p.hwnd()?;
    let scale = win::scale(hwnd);
    let ui = p.ui();
    let rail: Vec<(f32, f32)> = ui["labels"]
        .as_array()
        .context("labels")?
        .iter()
        .filter(|l| {
            let t = l["text"].as_str().unwrap_or("");
            t.contains("nav-item-") || t.contains("rail-")
        })
        .map(|l| {
            (
                l["x"].as_f64().unwrap_or(0.0) as f32 + l["w"].as_f64().unwrap_or(0.0) as f32 / 2.0,
                l["y"].as_f64().unwrap_or(0.0) as f32 + l["h"].as_f64().unwrap_or(0.0) as f32 / 2.0,
            )
        })
        .collect();
    anyhow::ensure!(!rail.is_empty(), "nenhum item da lateral encontrado");
    let (cw, ch) = win::client_size(hwnd);
    let park = (cw * 0.55, ch * 0.5);
    win::set_topmost(hwnd, true);
    let result = (|| -> Result<()> {
        win::hover(hwnd, park.0, park.1)?;
        std::thread::sleep(Duration::from_millis(900));
        let before = grab(p)?;
        // Measurement sanity: a hovered rail item must visibly change the frame.
        win::hover(hwnd, rail[0].0, rail[0].1)?;
        std::thread::sleep(Duration::from_millis(700));
        let during = grab(p)?;
        save(&run.evidence.join("hover-during.png"), &during)?;
        let live = compare(&before, &during, (0, 0, before.w, before.h));
        run.check(
            "hover produz alteração visível (tooltip/realce)",
            live["changedFraction"].as_f64().unwrap_or(0.0) > 0.0002,
            json!({"region":live}),
        )?;
        for i in 0..cycles {
            let target = rail[i % rail.len()];
            win::hover(hwnd, target.0, target.1)?;
            std::thread::sleep(Duration::from_millis(260));
            // Leave toward the channel/content area, crossing the panel border.
            win::hover(hwnd, target.0 + 180.0, target.1)?;
            std::thread::sleep(Duration::from_millis(160));
        }
        win::hover(hwnd, park.0, park.1)?;
        std::thread::sleep(Duration::from_millis(900));
        let after = grab(p)?;
        save(&run.evidence.join("hover-before.png"), &before)?;
        save(&run.evidence.join("hover-after.png"), &after)?;
        save(
            &run.evidence.join("hover-diff-x8.png"),
            &diff_image(&before, &after),
        )?;
        let whole = compare(&before, &after, (0, 0, before.w, before.h));
        // Left rail + channel column, where the accumulation was reported.
        let column = compare(&before, &after, (0, 0, (330.0 * scale) as u32, before.h));
        let ok = |v: &Value| {
            v["changedFraction"].as_f64().unwrap_or(1.0) < 0.001
                && (v["meanLumaBefore"].as_f64().unwrap_or(0.0)
                    - v["meanLumaAfter"].as_f64().unwrap_or(9.0))
                .abs()
                    < 0.25
        };
        run.check(
            &format!("{cycles} ciclos de hover sem acúmulo na lateral/canais"),
            ok(&column),
            json!({"cycles":cycles,"railItems":rail.len(),"region":column}),
        )?;
        run.check(
            "janela inteira idêntica após hover",
            ok(&whole),
            json!({"region":whole}),
        )
    })();
    win::set_topmost(hwnd, false);
    result
}

/// Screenshot tour of the main screens for before/after comparison. Every step
/// is a real click or the same edit message a widget emits.
pub fn tour(people: &mut [Participant], run: &mut Run) -> Result<()> {
    let evidence = run.evidence.clone();
    let shot = |p: &mut Participant, name: &str| -> Result<()> {
        std::thread::sleep(Duration::from_millis(500));
        p.screenshot(&evidence, name)
    };
    // Conversation with real messages from two identities.
    people[0].click("conversa")?;
    people[0].type_text("draft", "Oi pessoal! Partida às 21h, quem topa?")?;
    people[0].click("Enviar")?;
    people[1].click("conversa")?;
    people[1].type_text("draft", "Chegando! Vou abrir a tela pra mostrar o mapa.")?;
    people[1].click("Enviar")?;
    people[2].click("conversa")?;
    people[2].type_text("draft", "Topo. Já estou na sala de voz https://example.com")?;
    people[2].click("Enviar")?;
    people[0].wait("mensagens recebidas", 15, |ui| {
        ui["snapshot"]["messages"].as_u64() >= Some(3)
    })?;
    shot(&mut people[0], "tour-chat")?;
    let ana = &mut people[0];
    ana.click("Bruno")?;
    shot(ana, "tour-mini-profile")?;
    ana.click("Fechar perfil")?;
    ana.click("Gerenciar servidor")?;
    shot(ana, "tour-admin")?;
    ana.click("Voz conectada")?;
    shot(ana, "tour-call")?;
    ana.click("Opções de Bruno")?;
    shot(ana, "tour-tile-menu")?;
    ana.click("Fechar opções")?;
    ana.click("Dispositivos de áudio")?;
    shot(ana, "tour-devices")?;
    ana.click("Dispositivos de áudio")?;
    ana.nav("Início")?;
    shot(ana, "tour-home")?;
    ana.click("Criar servidor")?;
    shot(ana, "tour-modal-create")?;
    ana.click("Cancelar")?;
    ana.click("Configurações")?;
    shot(ana, "tour-settings-audio")?;
    for (label, file) in [
        ("Vídeo e transmissão", "tour-settings-video"),
        ("Perfil", "tour-settings-profile"),
        ("Notificações e sons", "tour-settings-sounds"),
        ("Aparência", "tour-settings-appearance"),
    ] {
        ana.click(label)?;
        shot(ana, file)?;
    }
    // Tooltip on the presented pixels.
    let hwnd = ana.hwnd()?;
    let target = ana.ui()["labels"]
        .as_array()
        .and_then(|l| {
            l.iter()
                .find(|x| {
                    x["text"]
                        .as_str()
                        .is_some_and(|t| t.contains("nav-item-Início"))
                })
                .cloned()
        })
        .context("item Início")?;
    win::set_topmost(hwnd, true);
    win::hover(
        hwnd,
        target["x"].as_f64().unwrap_or(0.0) as f32 + 20.0,
        target["y"].as_f64().unwrap_or(0.0) as f32 + 20.0,
    )?;
    std::thread::sleep(Duration::from_millis(900));
    let tip = grab(ana)?;
    win::set_topmost(hwnd, false);
    save(&evidence.join("ana-tour-tooltip.png"), &tip)?;
    // Window sizes on the call view (the connection panel opens it from anywhere).
    ana.click("Voz conectada")?;
    for (w, h) in [(1280, 720), (1600, 900), (1920, 1080)] {
        win::place(hwnd, 20, 20, w, h);
        std::thread::sleep(Duration::from_millis(900));
        let file = format!("tour-call-{w}x{h}");
        ana.screenshot(&evidence, &file)?;
    }
    win::place(hwnd, 20, 20, 1180, 760);
    std::thread::sleep(Duration::from_millis(1500));
    // Theme switch (Kuromi) through settings, then the call and home.
    ana.click("Configurações")?;
    ana.click("Aparência")?;
    ana.click("Kuromi")?;
    ana.click("Salvar")?;
    ana.wait("tema salvo", 10, |ui| ui["theme"] == "Kuromi")?;
    ana.click("Voz conectada")?;
    shot(ana, "tour-call-kuromi")?;
    ana.nav("Início")?;
    shot(ana, "tour-home-kuromi")?;
    run.check("tour visual capturado", true, json!({"screens":21}))
}
