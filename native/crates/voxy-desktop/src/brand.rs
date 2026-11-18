//! Voxy brand icon: the original 1.4.1 artwork (build/icon.ico) with only the
//! background recoloured for the Beta channel (assets/voxy-*.png, voxy.ico).
use std::sync::OnceLock;

fn decode(bytes: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().ok()?;
    let mut buffer = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buffer).ok()?;
    let rgba = match info.color_type {
        png::ColorType::Rgba => buffer[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => buffer[..info.buffer_size()]
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        _ => return None,
    };
    Some((info.width, info.height, rgba))
}

/// Small mark for the titlebar (decoded once).
pub fn mark() -> iced::widget::image::Handle {
    static MARK: OnceLock<iced::widget::image::Handle> = OnceLock::new();
    MARK.get_or_init(|| match decode(include_bytes!("../assets/voxy-64.png")) {
        Some((w, h, rgba)) => iced::widget::image::Handle::from_rgba(w, h, rgba),
        None => iced::widget::image::Handle::from_rgba(1, 1, vec![0, 0, 0, 0]),
    })
    .clone()
}

/// Window/taskbar icon.
pub fn window_icon() -> Option<iced::window::Icon> {
    let (w, h, rgba) = decode(include_bytes!("../assets/voxy-256.png"))?;
    iced::window::icon::from_rgba(rgba, w, h).ok()
}
