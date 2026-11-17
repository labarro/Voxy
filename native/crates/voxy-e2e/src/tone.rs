//! Physical test tones, only with VOXY_TEST_PHYSICAL_AUDIO=1 (explicit consent):
//! a quiet sine on the default output, standing in for an application's audio.
use anyhow::{Context, Result, ensure};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub fn allowed() -> bool {
    std::env::var("VOXY_TEST_PHYSICAL_AUDIO").as_deref() == Ok("1")
}
/// Plays `hz` at a low level on the default output for as long as the
/// returned stream lives.
pub fn start(hz: f32) -> Result<cpal::Stream> {
    ensure!(allowed(), "VOXY_TEST_PHYSICAL_AUDIO=1 é obrigatório para tons físicos");
    let device = cpal::default_host()
        .default_output_device()
        .context("sem saída padrão")?;
    let config = device.default_output_config()?;
    let rate = config.sample_rate() as f32;
    let channels = config.channels() as usize;
    let mut phase = 0.0f32;
    let stream = device.build_output_stream(
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
    )?;
    stream.play()?;
    Ok(stream)
}
/// `voxy-e2e --tone <hz> <seconds>`: a separate "other application".
pub fn run(hz: f32, seconds: u64) -> Result<()> {
    let _stream = start(hz)?;
    std::thread::sleep(std::time::Duration::from_secs(seconds));
    Ok(())
}
