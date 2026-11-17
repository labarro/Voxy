//! Process-loopback isolation with distinct synthetic signals.
#![cfg(windows)]
use std::time::{Duration, Instant};
use voxy_media::app_audio::{LoopbackMode, ProcessAudioCapture};

/// When re-executed with VOXY_TONE_HZ, this binary acts as an "application"
/// rendering a sine tone on the default output (used only by the opt-in test).
fn tone_player() -> bool {
    let Ok(hz) = std::env::var("VOXY_TONE_HZ") else {
        return false;
    };
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let hz: f32 = hz.parse().unwrap();
    let device = cpal::default_host().default_output_device().unwrap();
    let config = device.default_output_config().unwrap();
    let rate = config.sample_rate() as f32;
    let channels = config.channels() as usize;
    let mut phase = 0.0f32;
    let stream = device
        .build_output_stream(
            config.into(),
            move |data: &mut [f32], _| {
                for frame in data.chunks_mut(channels) {
                    let value = (phase * std::f32::consts::TAU).sin() * 0.05;
                    phase = (phase + hz / rate) % 1.0;
                    frame.fill(value);
                }
            },
            |_| {},
            None,
        )
        .unwrap();
    stream.play().unwrap();
    std::thread::sleep(Duration::from_secs(8));
    true
}

fn power(samples: &[f32], hz: f32) -> f64 {
    // Goertzel over the left channel of interleaved stereo at 48 kHz.
    let coefficient = 2.0 * (std::f64::consts::TAU * hz as f64 / 48_000.0).cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    let mut count = 0;
    for frame in samples.as_chunks::<2>().0 {
        let s0 = frame[0] as f64 + coefficient * s1 - s2;
        s2 = s1;
        s1 = s0;
        count += 1;
    }
    (s1 * s1 + s2 * s2 - coefficient * s1 * s2).max(0.0) / (count.max(1) as f64).powi(2)
}

fn record(mode: LoopbackMode, seconds: u64) -> Vec<f32> {
    let runtime = voxy_media::MediaRuntime::new().unwrap();
    let mut capture = ProcessAudioCapture::start(&runtime, mode).expect("process loopback");
    let mut samples = Vec::new();
    let end = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < end {
        capture.read(&mut samples, 100).unwrap();
    }
    samples
}

#[test]
#[ignore = "activates WASAPI process loopback on this test process only; renders and records nothing audible"]
fn process_loopback_activates_without_rendering_audio() {
    if tone_player() {
        return;
    }
    let samples = record(LoopbackMode::IncludeTree(std::process::id()), 1);
    // This process renders nothing, so anything captured must be silence.
    assert!(samples.iter().all(|s| s.abs() < 1e-4));
}

#[test]
#[ignore = "requires explicit VOXY_TEST_PHYSICAL_AUDIO=1; two child processes play quiet tones on the default output"]
fn include_tree_captures_only_the_app_and_exclude_tree_removes_it() {
    if tone_player() {
        return;
    }
    assert_eq!(
        std::env::var("VOXY_TEST_PHYSICAL_AUDIO").as_deref(),
        Ok("1")
    );
    let exe = std::env::current_exe().unwrap();
    let spawn = |hz: &str| {
        std::process::Command::new(&exe)
            .args([
                "--exact",
                "include_tree_captures_only_the_app_and_exclude_tree_removes_it",
                "--ignored",
                "--nocapture",
            ])
            .env("VOXY_TONE_HZ", hz)
            .spawn()
            .unwrap()
    };
    let mut app_a = spawn("523");
    let mut app_c = spawn("784");
    std::thread::sleep(Duration::from_millis(1500));
    let included = record(LoopbackMode::IncludeTree(app_a.id()), 2);
    let excluded = record(LoopbackMode::ExcludeTree(app_a.id()), 2);
    let _ = (app_a.kill(), app_c.kill(), app_a.wait(), app_c.wait());
    let (a_in, c_in) = (power(&included, 523.0), power(&included, 784.0));
    let (a_out, c_out) = (power(&excluded, 523.0), power(&excluded, 784.0));
    println!("include: A={a_in:.3e} C={c_in:.3e}; exclude: A={a_out:.3e} C={c_out:.3e}");
    assert!(a_in > 1e-5, "shared app missing");
    assert!(
        c_in < a_in / 1000.0,
        "other app leaked into application capture"
    );
    assert!(c_out > 1e-5, "system capture missing other app");
    assert!(a_out < c_out / 1000.0, "excluded tree leaked");
}
