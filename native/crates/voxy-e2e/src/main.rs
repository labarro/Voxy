//! Real multi-instance E2E driver for the native Voxy desktop.
//!
//! Each participant is an independent `voxy-desktop.exe` with its own data
//! directory, identity and `voxy-core serve` session process. The driver clicks
//! visible labels with posted mouse messages, reads the clipboard invite the app
//! copied, and verifies session-confirmed state plus objective audio metrics
//! from the synthetic playback analyzer. Only the device boundary is synthetic.
mod pattern;
mod visual;
#[cfg(windows)]
mod win;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Child,
    time::{Duration, Instant},
};

const VOICES: [u32; 3] = [140, 210, 330];

struct Participant {
    name: String,
    voice_hz: u32,
    data: PathBuf,
    auto: PathBuf,
    child: Option<Child>,
    seq: u64,
    /// Next click keeps the window z-order the app sets (see win::click_ex).
    keep_z: bool,
    bin: PathBuf,
    signal: String,
    slot: i32,
}
impl Participant {
    fn launch(&mut self) -> Result<()> {
        let child = std::process::Command::new(self.bin.join("voxy-desktop.exe"))
            .env("VOXY_NATIVE_DATA_DIR", &self.data)
            .env("VOXY_TEST_AUTOMATION", &self.auto)
            .env("VOXY_TEST_SYNTHETIC_AUDIO", "1")
            .env("VOXY_TEST_SYNTHETIC_CAMERA", "1")
            .env(
                "VOXY_TEST_SYNTHETIC_AUDIO_REPORT",
                self.auto.join("audio.json"),
            )
            .env("VOXY_SIGNAL_URL", &self.signal)
            .env("VOXY_TEST_SOURCE_FILTER", pattern::TITLE)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .context("voxy-desktop.exe")?;
        self.child = Some(child);
        let _ = std::fs::remove_file(self.auto.join("ui.json"));
        self.wait("interface pronta", 30, |ui| ui["serviceAttached"] == true)?;
        let hwnd = self.hwnd()?;
        win::place(hwnd, 20 + self.slot * 160, 20 + self.slot * 40, 1180, 760);
        std::thread::sleep(Duration::from_millis(800));
        if self.has_label("Entendi") {
            self.click("Entendi")?;
            self.wait("aviso de novidades dispensado", 5, |ui| {
                !ui["labels"]
                    .as_array()
                    .is_some_and(|l| l.iter().any(|x| x["text"] == "Entendi"))
            })?;
        }
        Ok(())
    }
    fn pid(&self) -> Result<u32> {
        Ok(self.child.as_ref().context("instância encerrada")?.id())
    }
    fn hwnd(&self) -> Result<windows_sys::Win32::Foundation::HWND> {
        let pid = self.pid()?;
        let end = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(hwnd) = win::window_of(pid) {
                return Ok(hwnd);
            }
            ensure!(Instant::now() < end, "{}: janela não encontrada", self.name);
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    fn ui(&self) -> Value {
        std::fs::read(self.auto.join("ui.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null)
    }
    fn audio(&self) -> Value {
        std::fs::read(self.auto.join("audio.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null)
    }
    fn session_pid(&self) -> Option<u32> {
        let endpoint: Value =
            serde_json::from_slice(&std::fs::read(self.data.join("session.json")).ok()?).ok()?;
        endpoint["pid"].as_u64().map(|pid| pid as u32)
    }
    fn wait(&self, what: &str, seconds: u64, check: impl Fn(&Value) -> bool) -> Result<Value> {
        let end = Instant::now() + Duration::from_secs(seconds);
        loop {
            let ui = self.ui();
            if check(&ui) {
                return Ok(ui);
            }
            if Instant::now() > end {
                let labels: Vec<_> = ui["labels"]
                    .as_array()
                    .map(|l| {
                        l.iter()
                            .filter_map(|x| x["text"].as_str())
                            .take(80)
                            .collect()
                    })
                    .unwrap_or_default();
                bail!(
                    "{}: tempo esgotado aguardando {what}. phase={} error={} status={} labels={labels:?}",
                    self.name,
                    ui["session"]["phase"],
                    ui["session"]["error"],
                    ui["status"]
                );
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }
    fn command(&mut self, command: Value) -> Result<()> {
        self.seq += 1;
        let mut command = command;
        command["seq"] = json!(self.seq);
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.auto.join("commands.jsonl"))?;
        writeln!(file, "{command}")?;
        let seq = self.seq;
        self.wait("comando aplicado", 10, |ui| ui["seq"].as_u64() >= Some(seq))?;
        std::thread::sleep(Duration::from_millis(300));
        Ok(())
    }
    fn type_text(&mut self, field: &str, value: &str) -> Result<()> {
        self.command(json!({"op":"type","field":field,"value":value}))
    }
    fn select(&mut self, field: &str, value: &str) -> Result<()> {
        self.command(json!({"op":"select","field":field,"value":value}))
    }
    fn screenshot(&mut self, evidence: &Path, name: &str) -> Result<()> {
        let file = format!("{}-{name}", self.name.to_lowercase());
        self.command(json!({"op":"screenshot","name":file}))?;
        let source = self.auto.join(format!("{file}.png"));
        let end = Instant::now() + Duration::from_secs(5);
        while !source.exists() {
            ensure!(Instant::now() < end, "captura {file} não gerada");
            std::thread::sleep(Duration::from_millis(100));
        }
        std::thread::sleep(Duration::from_millis(200));
        std::fs::copy(&source, evidence.join(format!("{file}.png")))?;
        Ok(())
    }
    /// Clicks the last visible label whose text matches exactly (overlays are last).
    /// Matches visible text, or the accessible id of an icon-only control
    /// (`btn-<label>` / `rail-<label>`, the same label its tooltip shows).
    fn click(&mut self, label: &str) -> Result<()> {
        let ids = [format!("\"btn-{label}\""), format!("\"rail-{label}\"")];
        self.click_where(label, |text| {
            text == label
                || (text.starts_with('#') && ids.iter().any(|id| text.contains(id.as_str())))
        })
    }
    fn click_where(&mut self, what: &str, matches: impl Fn(&str) -> bool) -> Result<()> {
        let hwnd = self.hwnd()?;
        let (width, height) = win::client_size(hwnd);
        let ui = self.wait(&format!("rótulo '{what}'"), 15, |ui| {
            ui["labels"].as_array().is_some_and(|labels| {
                labels
                    .iter()
                    .any(|l| l["text"].as_str().is_some_and(&matches))
            })
        })?;
        let target = ui["labels"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|l| l["text"].as_str().is_some_and(&matches))
            .filter(|l| {
                let (x, y) = (
                    l["x"].as_f64().unwrap_or(-1.0) as f32,
                    l["y"].as_f64().unwrap_or(-1.0) as f32,
                );
                x >= 0.0 && y >= 0.0 && x < width && y < height
            })
            .last()
            .with_context(|| format!("{}: '{what}' fora da área visível", self.name))?;
        let x = target["x"].as_f64().unwrap() as f32 + target["w"].as_f64().unwrap() as f32 / 2.0;
        let y = target["y"].as_f64().unwrap() as f32 + target["h"].as_f64().unwrap() as f32 / 2.0;
        // Delivery is verified by the app's received-click counter; physical input
        // can be lost while a window is still being resized or another app grabs focus.
        let mut before = ui["clicks"].as_u64().unwrap_or(0);
        let mut delivered = false;
        for _ in 0..3 {
            win::click_ex(hwnd, x, y, !self.keep_z)?;
            let end = Instant::now() + Duration::from_secs(2);
            while Instant::now() < end {
                let now = self.ui();
                if now["clicks"].as_u64().unwrap_or(0) > before {
                    // Accept only a click received at the target (human motion may move it).
                    let at = &now["lastClick"];
                    let (cx, cy) = (
                        at[0].as_f64().unwrap_or(-99.0) as f32,
                        at[1].as_f64().unwrap_or(-99.0) as f32,
                    );
                    delivered = (cx - x).abs() <= 4.0 && (cy - y).abs() <= 4.0;
                    if !delivered {
                        eprintln!(
                            "{}: clique em '{what}' recebido fora do alvo ({cx},{cy}); entrada humana concorrente, repetindo",
                            self.name
                        );
                        before = now["clicks"].as_u64().unwrap_or(0);
                    }
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if delivered {
                break;
            }
        }
        ensure!(
            delivered,
            "{}: clique em '{what}' não chegou à interface",
            self.name
        );
        std::thread::sleep(Duration::from_millis(350));
        Ok(())
    }
    fn nav(&mut self, page: &str) -> Result<()> {
        let id = format!("nav-item-{page}");
        self.click_where(&id, |t| t.starts_with('#') && t.contains(&id))
    }
    fn has_label(&self, label: &str) -> bool {
        self.ui()["labels"]
            .as_array()
            .is_some_and(|l| l.iter().any(|x| x["text"] == label))
    }
    /// Mean band fraction and RMS of analyzer windows that started after `since`.
    fn band(&self, since_ms: u64) -> (usize, f64, Vec<f64>) {
        let audio = self.audio();
        let windows: Vec<&Value> = audio["windows"]
            .as_array()
            .map(|w| {
                w.iter()
                    .filter(|w| w["atMs"].as_u64().unwrap_or(0) > since_ms + 500)
                    .collect()
            })
            .unwrap_or_default();
        let count = windows.len().max(1) as f64;
        let rms = windows
            .iter()
            .map(|w| w["rms"].as_f64().unwrap_or(0.0))
            .sum::<f64>()
            / count;
        // Absolute band amplitude per window: sqrt(fraction) * window RMS. Fractions
        // alone shrink when several voices are mixed, amplitudes do not.
        let bands = VOICES
            .iter()
            .map(|hz| {
                windows
                    .iter()
                    .map(|w| {
                        w["bandFraction"][hz.to_string()]
                            .as_f64()
                            .unwrap_or(0.0)
                            .sqrt()
                            * w["rms"].as_f64().unwrap_or(0.0)
                    })
                    .sum::<f64>()
                    / count
            })
            .collect();
        (windows.len(), rms, bands)
    }
    fn stop(&mut self) {
        let session = self.session_pid();
        if let Some(mut child) = self.child.take() {
            let _ = win::kill(child.id());
            let _ = child.wait();
        }
        if let Some(pid) = session {
            let _ = win::kill(pid);
        }
    }
}
impl Drop for Participant {
    fn drop(&mut self) {
        self.stop();
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

struct Run {
    evidence: PathBuf,
    checks: Vec<Value>,
    started: Instant,
}
impl Run {
    fn check(&mut self, name: &str, ok: bool, detail: Value) -> Result<()> {
        println!(
            "[{:>6.1}s] {} {name} {detail}",
            self.started.elapsed().as_secs_f32(),
            if ok { "PASS" } else { "FAIL" }
        );
        self.checks.push(json!({"check":name,"passed":ok,"detail":detail,"atSeconds":self.started.elapsed().as_secs_f32()}));
        ensure!(ok, "Falhou: {name} {detail}");
        Ok(())
    }
}

/// Audio presence thresholds on absolute band amplitude (documented in TESTING):
/// present > 0.02, absent < 0.006, silence RMS < 0.002; >= 4 half-second windows.
const PRESENT: f64 = 0.02;
const ABSENT: f64 = 0.006;

fn hear(
    run: &mut Run,
    listener: &Participant,
    expect: &[(u32, bool)],
    label: &str,
    seconds: u64,
) -> Result<()> {
    let since = now_ms();
    std::thread::sleep(Duration::from_secs(seconds));
    let (windows, rms, bands) = listener.band(since);
    let mut ok = windows >= 4;
    let mut detail = serde_json::Map::new();
    for (hz, present) in expect {
        let index = VOICES.iter().position(|v| v == hz).unwrap();
        let value = bands[index];
        ok &= if *present {
            value > PRESENT
        } else {
            value < ABSENT
        };
        detail.insert(
            format!("{hz}Hz"),
            json!((value * 10000.0).round() / 10000.0),
        );
    }
    detail.insert("rms".into(), json!((rms * 10000.0).round() / 10000.0));
    detail.insert("windows".into(), json!(windows));
    run.check(
        &format!("{}: {label}", listener.name),
        ok,
        Value::Object(detail),
    )
}

fn in_call(p: &Participant, members: usize) -> Result<Value> {
    p.wait("chamada confirmada", 45, |ui| {
        let voice = &ui["session"]["voice"];
        ui["session"]["phase"] == "Em chamada"
            && ui["session"]["microphoneReady"] == true
            && ui["snapshot"]["members"].as_array().is_some_and(|m| {
                m.iter()
                    .filter(|m| &m["voice"] == voice && !voice.is_null())
                    .count()
                    >= members
            })
    })
}

fn voice_scenario(
    bin: &Path,
    signal: &str,
    evidence: &Path,
    count: usize,
    kind: &str,
) -> Result<Value> {
    // Screen scenarios share a dynamic synthetic window; killed when the run ends.
    let mut pattern_window = if kind == "screen" {
        Some(
            std::process::Command::new(std::env::current_exe()?)
                .args(["--pattern-window"])
                .spawn()?,
        )
    } else {
        None
    };
    let root = std::env::temp_dir().join(format!("voxy-e2e-{}", now_ms()));
    let names = ["Ana", "Bruno", "Clara"];
    let mut people: Vec<Participant> = (0..count)
        .map(|i| {
            let data = root.join(names[i]).join("data");
            let auto = root.join(names[i]).join("automation");
            std::fs::create_dir_all(&data)?;
            std::fs::create_dir_all(&auto)?;
            Ok(Participant {
                name: names[i].into(),
                voice_hz: VOICES[i],
                data,
                auto,
                child: None,
                seq: 0,
                keep_z: false,
                bin: bin.into(),
                signal: signal.into(),
                slot: i as i32,
            })
        })
        .collect::<Result<_>>()?;
    let mut run = Run {
        evidence: evidence.into(),
        checks: vec![],
        started: Instant::now(),
    };
    let previous_clipboard = win::clipboard_text().ok().flatten();
    let result = (|| -> Result<()> {
        for p in &mut people {
            p.launch()?;
            // Profile name and synthetic devices through the real settings screen.
            p.click("Configurações")?;
            p.click("Áudio e voz")?;
            p.wait("configurações de áudio", 10, |ui| {
                ui["page"] == "Settings"
            })?;
            p.select("input", &format!("synthetic:voice:{}", p.voice_hz))?;
            p.select("output", "synthetic:analyzer")?;
            p.click("Salvar")?;
            let hz = p.voice_hz;
            p.wait("dispositivos salvos", 10, |ui| {
                ui["input"] == format!("synthetic:voice:{hz}")
            })?;
            p.click("Perfil")?;
            let name = p.name.clone();
            p.type_text("name", &name)?;
            p.click("Salvar")?;
            p.wait("perfil salvo", 10, |ui| ui["profileName"] == name)?;
        }
        run.check(
            "instâncias reais independentes",
            people
                .iter()
                .map(|p| p.ui()["profileId"].to_string())
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                == count,
            json!({"instances":count}),
        )?;
        // Host creates and hosts a server, then copies the invite with the UI button.
        let host = &mut people[0];
        host.nav("Início")?;
        host.click("Criar servidor")?;
        host.type_text("serverName", "E2E Amigos")?;
        host.click("Criar servidor")?;
        host.wait("servidor local aberto", 10, |ui| ui["page"] == "Chat")?;
        if kind == "hover" {
            return visual::hover_cycles(host, &mut run, 50);
        }
        host.click("Hospedar servidor")?;
        let ui = host.wait("servidor hospedado", 40, |ui| {
            ui["session"]["invitePresent"] == true && !ui["snapshot"].is_null()
        })?;
        run.check(
            "host registrado na sinalização pública",
            true,
            json!({"phase":ui["session"]["phase"]}),
        )?;
        win::set_clipboard_text("")?;
        host.click("Copiar convite")?;
        let invite = win::clipboard_text()?
            .filter(|t| t.starts_with("voxy-native://"))
            .context("convite não copiado pela interface")?;
        run.check(
            "convite copiado pela interface",
            true,
            json!({"scheme":"voxy-native://","length":invite.len()}),
        )?;
        for p in people.iter_mut().skip(1) {
            p.nav("Início")?;
            p.click("Entrar por convite")?;
            p.type_text("invite", &invite)?;
            p.click("Entrar")?;
            let ui = p.wait("servidor recebido do host", 45, |ui| {
                ui["snapshot"]["server"] == "E2E Amigos"
            })?;
            run.check(
                &format!("{} entrou por convite", p.name),
                true,
                json!({"phase":ui["session"]["phase"]}),
            )?;
        }
        for p in &mut people {
            p.click("Sala dos amigos")?;
        }
        for p in &people {
            let ui = in_call(p, count)?;
            run.check(
                &format!("{} em chamada confirmada pelo host", p.name),
                true,
                json!({"members":ui["snapshot"]["members"].as_array().map(|m| m.len())}),
            )?;
        }
        std::thread::sleep(Duration::from_secs(2));
        for p in &mut people {
            p.screenshot(&run.evidence, "in-call")?;
        }
        if kind == "tour" {
            return visual::tour(&mut people, &mut run);
        }
        if kind == "screen" {
            return screen_steps(&mut people, &mut run);
        }
        if kind == "camera" {
            return camera_steps(&mut people, &mut run);
        }
        // Every listener hears every other participant and never itself.
        for listener in &people {
            let expect: Vec<(u32, bool)> = people
                .iter()
                .map(|p| (p.voice_hz, p.voice_hz != listener.voice_hz))
                .collect();
            hear(
                &mut run,
                listener,
                &expect,
                "recebe todos os outros, não a própria voz",
                4,
            )?;
        }
        for p in &people {
            let s = &p.ui()["session"];
            run.check(&format!("{} contadores de mídia", p.name), s["sentFrames"].as_u64() > Some(100) && s["receivedFrames"].as_u64() > Some(100) && s["decodedFrames"].as_u64() > Some(100), json!({"sent":s["sentFrames"],"received":s["receivedFrames"],"decoded":s["decodedFrames"],"playbackSamples":s["playbackSamples"]}))?;
        }
        for p in &people {
            let ui = p.wait(
                "indicadores de fala e mídia desenhados pela interface",
                15,
                |ui| {
                    let view = ui["memberView"].as_array().cloned().unwrap_or_default();
                    view.iter().filter(|m| m["speakingRing"] == true).count() >= count - 1
                        && view.len() == count
                        && !view.iter().any(|m| {
                            m["icons"].as_array().is_some_and(|i| {
                                i.iter()
                                    .any(|x| x == "negociando mídia" || x == "mídia interrompida")
                            })
                        })
                        && ui["callQuality"]
                            .as_str()
                            .is_some_and(|q| q.starts_with("Good"))
                        && ui["session"]["transmitting"] == true
                },
            )?;
            let links = ui["session"]["links"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let routes: Vec<_> = links.iter().map(|l| json!({"route":l["route"],"state":l["state"],"rttMs":l["rtt_ms"],"audioSent":l["audio_sent"],"audioReceived":l["audio_received"],"speaking":l["speaking"]})).collect();
            run.check(
                &format!(
                    "{}: interface mostra fala, mídia e transmissão confirmadas",
                    p.name
                ),
                links.len() == count - 1
                    && links.iter().all(|l| {
                        l["state"] == "connected"
                            && l["route"].as_str().is_some_and(|r| r.starts_with("direto"))
                    }),
                json!(routes),
            )?;
        }
        win::set_clipboard_text("")?;
        people[0].click("Copiar diagnóstico")?;
        let diagnostics = win::clipboard_text()?.unwrap_or_default();
        let invite_key = invite.len() > 40 && diagnostics.contains(&invite[20..40]);
        let keys = people[0].ui()["session"]["links"]
            .as_array()
            .is_some_and(|links| {
                links
                    .iter()
                    .filter_map(|l| l["key"].as_str())
                    .any(|key| diagnostics.contains(key))
            });
        run.check(
            "diagnóstico copiável sem convite, chaves ou SDP",
            diagnostics.contains("diagnóstico de chamada")
                && diagnostics.contains("rota direto")
                && !diagnostics.contains("voxy-native://")
                && !invite_key
                && !keys
                && !diagnostics.contains("a=candidate")
                && !diagnostics.contains("v=0"),
            json!({"lines":diagnostics.lines().count()}),
        )?;
        std::fs::write(run.evidence.join("diagnostico-ana.txt"), &diagnostics)?;
        // Mute at A: confirmed by session and host, and A's voice disappears for others.
        people[0].click("Silenciar microfone")?;
        let a_id = people[0].ui()["profileId"].clone();
        people[0].wait("mute confirmado pela sessão", 10, |ui| {
            ui["session"]["muted"] == true
        })?;
        people[1].wait("mute de A visível ao participante B", 10, |ui| {
            ui["snapshot"]["members"]
                .as_array()
                .is_some_and(|m| m.iter().any(|m| m["id"] == a_id && m["muted"] == true))
        })?;
        people[0].screenshot(&run.evidence, "muted")?;
        let others: Vec<(u32, bool)> = people.iter().skip(1).map(|p| (p.voice_hz, false)).collect();
        let _ = others;
        hear(
            &mut run,
            &people[1],
            &[(VOICES[0], false)],
            "mute de A interrompe a voz de A",
            3,
        )?;
        let ana_view = |ui: &Value| {
            ui["memberView"]
                .as_array()
                .and_then(|v| v.iter().find(|m| m["id"] == a_id).cloned())
                .unwrap_or_default()
        };
        people[1].wait("ícone de mudo de Ana na interface de Bruno", 10, |ui| {
            ana_view(ui)["icons"]
                .as_array()
                .is_some_and(|i| i.iter().any(|x| x == "mudo"))
        })?;
        // The speech hold is 450 ms; the ring must be gone after it.
        std::thread::sleep(Duration::from_millis(700));
        let seen = ana_view(&people[1].ui());
        run.check(
            "Bruno vê Ana com ícone de mudo e sem anel de fala",
            seen["speakingRing"] == false,
            seen.clone(),
        )?;
        people[1].screenshot(&run.evidence, "sees-ana-muted")?;
        people[0].click("Ativar microfone")?;
        people[0].wait("desmute confirmado", 10, |ui| {
            ui["session"]["muted"] == false
        })?;
        hear(
            &mut run,
            &people[1],
            &[(VOICES[0], true)],
            "voz de A retorna após desmutar",
            3,
        )?;
        // Deafen at B: B stops delivering any playback; A still transmits.
        people[1].click("Ensurdecer")?;
        people[1].wait("ensurdecer confirmado", 10, |ui| {
            ui["session"]["deafened"] == true
        })?;
        // The deafen cue itself is audible by design; measure after it ends.
        std::thread::sleep(Duration::from_millis(900));
        let since = now_ms();
        std::thread::sleep(Duration::from_secs(3));
        let (windows, rms, _) = people[1].band(since);
        run.check(
            "Bruno: ensurdecer zera a reprodução",
            windows >= 4 && rms < 0.002,
            json!({"rms":rms,"windows":windows}),
        )?;
        people[1].click("Ativar áudio")?;
        people[1].wait("ensurdecer desfeito", 10, |ui| {
            ui["session"]["deafened"] == false
        })?;
        hear(
            &mut run,
            &people[1],
            &[(VOICES[0], true)],
            "reprodução retorna após desfazer ensurdecer",
            3,
        )?;
        // Close B's interface: the call must keep working in the session process.
        let b_hwnd = people[1].hwnd()?;
        win::close(b_hwnd);
        if let Some(mut child) = people[1].child.take() {
            let end = Instant::now() + Duration::from_secs(10);
            while child.try_wait()?.is_none() {
                ensure!(Instant::now() < end, "interface de Bruno não encerrou");
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let session = people[1].session_pid().context("sessão de Bruno")?;
        run.check(
            "Bruno: interface encerrada, sessão viva",
            win::alive(session),
            json!({"sessionPid":session}),
        )?;
        hear(
            &mut run,
            &people[1],
            &[(VOICES[0], true)],
            "continua ouvindo com a interface fechada",
            4,
        )?;
        hear(
            &mut run,
            &people[0],
            &[(VOICES[1], true)],
            "continua ouvindo Bruno com a interface dele fechada",
            4,
        )?;
        people[1].launch()?;
        let ui = in_call(&people[1], count)?;
        run.check(
            "Bruno: reabertura recupera a chamada",
            true,
            json!({"phase":ui["session"]["phase"]}),
        )?;
        people[1].screenshot(&run.evidence, "reopened")?;
        // Leave: B's voice disappears for A; B no longer receives.
        people[1].click("Sair da chamada")?;
        people[1].wait("saída confirmada", 10, |ui| {
            ui["session"]["voice"].is_null()
        })?;
        hear(
            &mut run,
            &people[0],
            &[(VOICES[1], false)],
            "Bruno saiu: voz dele some",
            3,
        )?;
        Ok(())
    })();
    let mut resources = vec![];
    for p in &people {
        for pid in p
            .child
            .as_ref()
            .map(|c| c.id())
            .into_iter()
            .chain(p.session_pid())
        {
            if let Ok((ws, private, cpu)) = win::resources(pid) {
                resources.push(json!({"participant":p.name,"pid":pid,"workingSetMiB":ws as f64/1048576.0,"privateMiB":private as f64/1048576.0,"cpuSeconds":cpu}));
            }
        }
    }
    if result.is_err() {
        for p in &mut people {
            if p.child.is_some() {
                let _ = p.screenshot(&run.evidence, "failure");
                let _ = std::fs::copy(
                    p.auto.join("ui.json"),
                    run.evidence
                        .join(format!("{}-failure-ui.json", p.name.to_lowercase())),
                );
                let _ = std::fs::copy(
                    p.auto.join("audio.json"),
                    run.evidence
                        .join(format!("{}-failure-audio.json", p.name.to_lowercase())),
                );
            }
        }
    }
    for p in &mut people {
        p.stop();
    }
    if let Some(mut window) = pattern_window.take() {
        let _ = window.kill();
        let _ = window.wait();
    }
    if let Some(text) = previous_clipboard {
        let _ = win::set_clipboard_text(&text);
    }
    let _ = std::fs::remove_dir_all(&root);
    let report = json!({
        "scenario": format!("{kind}-{count}"),
        "signal": signal,
        "binaries": bin,
        "passed": result.is_ok(),
        "error": result.as_ref().err().map(|e| e.to_string()),
        "durationSeconds": run.started.elapsed().as_secs_f32(),
        "checks": run.checks,
        "resourcesAtEnd": resources,
        "method": "independent voxy-desktop processes with own data dirs/identities/session processes; clicks are physical SendInput mouse input on visible labels, verified by the app's received-click position; text fields and pick-list choices applied as their widget messages; invite read from the clipboard written by the app's copy button; audio source/sink are the synthetic device boundary (VOXY_TEST_SYNTHETIC_AUDIO) feeding the unchanged DSP/Opus/SRTP/jitter/mixer pipeline",
        "physicalDevices": false,
        "sameMachine": true,
    });
    std::fs::write(
        evidence.join(format!("{kind}-{count}.json")),
        serde_json::to_vec_pretty(&report)?,
    )?;
    result.map(|_| report)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--pattern-window") {
        return pattern::run(40, 40);
    }
    let get = |name: &str| args.windows(2).find(|w| w[0] == name).map(|w| w[1].clone());
    let bin =
        PathBuf::from(get("--bin").context("--bin <pasta com voxy-desktop.exe e voxy-core.exe>")?);
    let signal = get("--signal").unwrap_or_else(|| "wss://voxy.devbarros.com".into());
    let evidence = PathBuf::from(get("--evidence").context("--evidence <pasta>")?);
    let scenario = get("--scenario").unwrap_or_else(|| "voice-2".into());
    std::fs::create_dir_all(&evidence)?;
    let report = match scenario.as_str() {
        "voice-2" => voice_scenario(&bin, &signal, &evidence, 2, "voice"),
        "voice-3" => voice_scenario(&bin, &signal, &evidence, 3, "voice"),
        "screen-2" => voice_scenario(&bin, &signal, &evidence, 2, "screen"),
        "camera-2" => voice_scenario(&bin, &signal, &evidence, 2, "camera"),
        "hover-50" => voice_scenario(&bin, &signal, &evidence, 1, "hover"),
        "tour-3" => voice_scenario(&bin, &signal, &evidence, 3, "tour"),
        other => bail!("Cenário desconhecido: {other}"),
    }?;
    println!(
        "E2E aprovado: {} verificações",
        report["checks"].as_array().map(Vec::len).unwrap_or(0)
    );
    Ok(())
}

fn texts(ui: &Value) -> Vec<String> {
    ui["labels"]
        .as_array()
        .map(|labels| {
            labels
                .iter()
                .filter_map(|l| l["text"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn member_flag(ui: &Value, id: &Value, field: &str) -> Value {
    ui["snapshot"]["members"]
        .as_array()
        .and_then(|m| m.iter().find(|m| &m["id"] == id))
        .map(|m| m[field].clone())
        .unwrap_or(Value::Null)
}
fn stream_of<'a>(ui: &'a Value, id: &Value) -> Option<&'a Value> {
    ui["streams"]
        .as_array()?
        .iter()
        .find(|s| &s["member"] == id)
}
fn video_sent(ui: &Value) -> u64 {
    ui["session"]["links"]
        .as_array()
        .map(|l| l.iter().filter_map(|l| l["video_sent"].as_u64()).sum())
        .unwrap_or(0)
}

/// Screen share through the real UI: A shares the synthetic pattern window, B
/// watches; image content is verified against the known pattern.
fn screen_steps(people: &mut [Participant], run: &mut Run) -> Result<()> {
    let ana = people[0].ui()["profileId"].clone();
    people[0].click("Compartilhar tela")?;
    people[0].wait("seletor de compartilhamento aberto", 10, |ui| {
        ui["shareDialog"] == true
    })?;
    people[0].click_where("janela de teste no seletor", |t| t.contains(pattern::TITLE))?;
    people[0].select("sharePreset", "720p30")?;
    let ui = people[0].wait("prévia privada da fonte", 10, |ui| {
        !texts(ui)
            .iter()
            .any(|t| t.starts_with("Carregando prévia") || t.starts_with("Escolha uma janela"))
    })?;
    people[0].screenshot(&run.evidence, "share-picker")?;
    run.check(
        "Ana: seletor lista a janela de teste e mostra prévia",
        texts(&ui).iter().any(|t| t.contains(pattern::TITLE)),
        json!({}),
    )?;
    people[0].click("Iniciar compartilhamento")?;
    let ui = people[0].wait("captura e codificação ativas", 20, |ui| {
        ui["screen"]["encoded"].as_u64() > Some(10)
    })?;
    run.check(
        "Ana: captura WGC e codificação H.264 reais",
        ui["screen"]["width"] == 1280 && ui["screen"]["keyframes"].as_u64() >= Some(1),
        ui["screen"].clone(),
    )?;
    people[1].wait("Bruno vê Ana transmitindo", 15, |ui| {
        member_flag(ui, &ana, "screen") == true && texts(ui).iter().any(|t| t == "Assistir")
    })?;
    people[1].click("Assistir")?;
    let ui = people[1].wait("quadros decodificados de Ana", 25, |ui| {
        stream_of(ui, &ana).is_some_and(|s| s["decoded"].as_u64() > Some(20))
    })?;
    let stream = stream_of(&ui, &ana).cloned().unwrap_or_default();
    let signature: Vec<u64> = stream["signature"]
        .as_array()
        .map(|s| s.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default();
    let mut mismatches = vec![];
    for gy in 0..7 {
        for gx in 0..8 {
            let value = signature.get(gy * 8 + gx).copied().unwrap_or(0);
            let ok = if pattern::bright(gx, gy) {
                value > 150
            } else {
                value < 100
            };
            if !ok {
                mismatches.push(json!({"cell":[gx,gy],"luma":value}));
            }
        }
    }
    run.check("Bruno: imagem decodificada corresponde ao padrão da janela de origem", signature.len() == 64 && mismatches.is_empty(), json!({"width":stream["width"],"height":stream["height"],"mismatches":mismatches,"row0":&signature.get(0..8)}))?;
    let first = (
        stream["decoded"].as_u64().unwrap_or(0),
        signature[56..64].to_vec(),
    );
    std::thread::sleep(Duration::from_millis(1500));
    let later = stream_of(&people[1].ui(), &ana)
        .cloned()
        .unwrap_or_default();
    let later_row: Vec<u64> = later["signature"]
        .as_array()
        .map(|s| s.iter().skip(56).filter_map(Value::as_u64).collect())
        .unwrap_or_default();
    let decoded = later["decoded"].as_u64().unwrap_or(0);
    run.check("Bruno: quadros contínuos e conteúdo em movimento", decoded >= first.0 + 20 && later_row != first.1, json!({"decodedIn1500ms":decoded - first.0,"dropped":later["dropped"],"row7Before":first.1,"row7After":later_row}))?;
    people[1].screenshot(&run.evidence, "watching")?;
    let ui = people[0].wait("Ana: um espectador confirmado", 10, |ui| {
        ui["screen"]["watchers"] == 1 && ui["screen"]["sent_kbps"].as_u64() > Some(0)
    })?;
    run.check("Ana: envia somente com espectador confirmado", true, json!({"sentKbps":ui["screen"]["sent_kbps"],"bitrateKbps":ui["screen"]["bitrate_kbps"],"dropped":ui["screen"]["dropped"]}))?;
    people[1].click("Ampliar")?;
    people[1].wait("transmissão ampliada", 10, |ui| {
        !ui["streamFocus"].is_null()
    })?;
    people[1].screenshot(&run.evidence, "focused")?;
    people[1].click("Voltar à grade")?;
    people[1].wait("retorno à grade", 10, |ui| ui["streamFocus"].is_null())?;
    people[1].click("Tela cheia")?;
    people[1].wait("tela cheia", 10, |ui| ui["streamFullscreen"] == true)?;
    std::thread::sleep(Duration::from_millis(600));
    people[1].screenshot(&run.evidence, "fullscreen-hud")?;
    let hidden = people[1].wait("HUD ocultado automaticamente", 8, |ui| {
        !texts(ui).iter().any(|t| t == "Sair da tela cheia")
    })?;
    people[1].screenshot(&run.evidence, "fullscreen")?;
    let hwnd = people[1].hwnd()?;
    let (w, h) = win::client_size(hwnd);
    win::hover(hwnd, w / 2.0, h / 2.0)?;
    people[1].wait("HUD reaparece ao mover o mouse", 5, |ui| {
        texts(ui).iter().any(|t| t == "Sair da tela cheia")
    })?;
    run.check(
        "Bruno: tela cheia com HUD que some e reaparece",
        hidden["streamFullscreen"] == true,
        json!({}),
    )?;
    people[1].click("Sair da tela cheia")?;
    people[1].wait("saída da tela cheia", 10, |ui| {
        ui["streamFullscreen"] == false
    })?;
    people[1].keep_z = true;
    let pip = people[1].click("Picture-in-Picture");
    people[1].keep_z = false;
    pip?;
    people[1].wait("Picture-in-Picture ativo", 10, |ui| ui["streamPip"] == true)?;
    std::thread::sleep(Duration::from_millis(800));
    let hwnd = people[1].hwnd()?;
    let (pw, ph) = win::client_size(hwnd);
    let before = stream_of(&people[1].ui(), &ana)
        .and_then(|s| s["decoded"].as_u64())
        .unwrap_or(0);
    std::thread::sleep(Duration::from_millis(1200));
    let after = stream_of(&people[1].ui(), &ana)
        .and_then(|s| s["decoded"].as_u64())
        .unwrap_or(0);
    people[1].screenshot(&run.evidence, "pip")?;
    run.check(
        "Bruno: Picture-in-Picture compacto, sempre no topo e recebendo quadros",
        (pw - 480.0).abs() < 4.0
            && (ph - 300.0).abs() < 4.0
            && win::is_topmost(hwnd)
            && after > before,
        json!({"size":[pw,ph],"topmost":win::is_topmost(hwnd),"decodedIn1200ms":after - before}),
    )?;
    people[1].click("Voltar à janela")?;
    people[1].wait("retorno à janela principal", 10, |ui| {
        ui["streamPip"] == false
    })?;
    std::thread::sleep(Duration::from_millis(600));
    let hwnd = people[1].hwnd()?;
    run.check(
        "Bruno: retorno do PiP restaura a janela normal",
        !win::is_topmost(hwnd) && win::client_size(hwnd).0 > 1000.0,
        json!({}),
    )?;
    people[1].click("Parar de assistir")?;
    people[0].wait("Ana sem espectadores", 10, |ui| {
        ui["screen"]["watchers"] == 0
    })?;
    // Link counters are reported every 2 s: wait for a report taken after the
    // unsubscription, then compare across two more complete report cycles.
    std::thread::sleep(Duration::from_millis(2600));
    let before = video_sent(&people[0].ui());
    std::thread::sleep(Duration::from_millis(4500));
    let after = video_sent(&people[0].ui());
    run.check(
        "Ana: sem espectadores, nenhum quadro é enviado",
        after == before,
        json!({"videoSentBefore":before,"videoSentAfter":after}),
    )?;
    people[0].click("Parar compartilhamento")?;
    people[0].wait("compartilhamento encerrado", 10, |ui| {
        ui["screen"].is_null()
    })?;
    people[1].wait("Bruno vê o fim da transmissão", 10, |ui| {
        member_flag(ui, &ana, "screen") == false
    })?;
    run.check("encerramento confirmado pelos dois lados", true, json!({}))?;
    Ok(())
}

fn stream_kind<'a>(ui: &'a Value, id: &Value, camera: bool) -> Option<&'a Value> {
    ui["streams"]
        .as_array()?
        .iter()
        .find(|s| &s["member"] == id && s["camera"] == camera)
}

/// Camera through the real UI: Bruno turns on the synthetic camera, Ana watches;
/// the decoded image must show the camera stripes, not the screen checkerboard.
fn camera_steps(people: &mut [Participant], run: &mut Run) -> Result<()> {
    let bruno = people[1].ui()["profileId"].clone();
    run.check(
        "câmera desligada ao entrar na chamada",
        people[1].ui()["camera"].is_null()
            && member_flag(&people[0].ui(), &bruno, "camera") == false,
        json!({}),
    )?;
    people[1].click("Ligar câmera")?;
    people[1].wait("seletor de câmera aberto", 10, |ui| {
        ui["cameraDialog"] == true
    })?;
    people[1].click("Câmera de teste sintética")?;
    people[1].select("cameraPreset", "360p30")?;
    people[1].wait("prévia privada da câmera", 10, |ui| {
        !texts(ui)
            .iter()
            .any(|t| t.starts_with("Carregando prévia") || t.starts_with("Escolha uma câmera"))
    })?;
    run.check(
        "prévia privada não publica a câmera",
        member_flag(&people[0].ui(), &bruno, "camera") == false,
        json!({}),
    )?;
    people[1].screenshot(&run.evidence, "camera-picker")?;
    people[1].click("Ativar câmera")?;
    let ui = people[1].wait("câmera publicando", 15, |ui| {
        ui["camera"]["encoded"].as_u64() > Some(10)
    })?;
    run.check(
        "Bruno: câmera capturada e codificada",
        ui["camera"]["width"] == 640 && ui["camera"]["height"] == 360,
        ui["camera"].clone(),
    )?;
    people[0].wait("Ana vê a câmera de Bruno", 15, |ui| {
        member_flag(ui, &bruno, "camera") == true && texts(ui).iter().any(|t| t == "Assistir")
    })?;
    people[0].click("Assistir")?;
    let ui = people[0].wait("quadros da câmera decodificados", 20, |ui| {
        stream_kind(ui, &bruno, true).is_some_and(|s| s["decoded"].as_u64() > Some(20))
    })?;
    let stream = stream_kind(&ui, &bruno, true).cloned().unwrap_or_default();
    let signature: Vec<u64> = stream["signature"]
        .as_array()
        .map(|s| s.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default();
    let mut mismatches = vec![];
    for gy in 0..7 {
        for gx in 0..8 {
            let value = signature.get(gy * 8 + gx).copied().unwrap_or(0);
            if !(if gx % 2 == 0 {
                value > 150
            } else {
                value < 100
            }) {
                mismatches.push(json!({"cell":[gx,gy],"luma":value}));
            }
        }
    }
    run.check(
        "Ana: imagem da câmera corresponde às listras da fonte",
        signature.len() == 64 && mismatches.is_empty() && stream["width"] == 640,
        json!({"width":stream["width"],"height":stream["height"],"mismatches":mismatches}),
    )?;
    let before = stream["decoded"].as_u64().unwrap_or(0);
    std::thread::sleep(Duration::from_millis(1500));
    let after = stream_kind(&people[0].ui(), &bruno, true)
        .and_then(|s| s["decoded"].as_u64())
        .unwrap_or(0);
    run.check(
        "Ana: câmera continua chegando",
        after >= before + 20,
        json!({"decodedIn1500ms":after - before}),
    )?;
    people[0].screenshot(&run.evidence, "watching-camera")?;
    people[1].wait("Bruno: um espectador", 10, |ui| {
        ui["camera"]["watchers"] == 1
    })?;
    people[1].click("Desligar câmera")?;
    people[1].wait("câmera desligada", 10, |ui| ui["camera"].is_null())?;
    let ui = people[0].wait("Ana vê a câmera desligada", 10, |ui| {
        member_flag(ui, &bruno, "camera") == false && stream_kind(ui, &bruno, true).is_none()
    })?;
    run.check(
        "desligar a câmera encerra a transmissão nos dois lados",
        true,
        json!({"streams":ui["streams"]}),
    )?;
    Ok(())
}
