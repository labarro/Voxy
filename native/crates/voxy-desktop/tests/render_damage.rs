//! Regression for the accumulating dark layer: partial redraws must not paint a
//! quad's shadow over pixels outside the cleared damage region, and the damage
//! of a changed shadowed quad must cover its shadow (vendor/iced_tiny_skia patch).
use iced_tiny_skia::{
    Layer, Renderer,
    core::{
        Background, Border, Color, Font, Pixels, Rectangle, Shadow, Size, Transformation, Vector,
        renderer::{Quad, Renderer as _},
    },
    graphics::Viewport,
};

const W: u32 = 200;
const H: u32 = 120;

fn shadowed(renderer: &mut Renderer, color: Color) {
    renderer.fill_quad(
        Quad {
            bounds: Rectangle::new([60.0, 40.0].into(), Size::new(40.0, 30.0)),
            border: Border::default().rounded(6),
            shadow: Shadow {
                color: Color::from_rgba(0.0, 0.0, 0.0, 0.45),
                offset: Vector::new(0.0, 6.0),
                blur_radius: 18.0,
            },
            snap: false,
        },
        Background::Color(color),
    );
}

#[test]
fn partial_redraws_do_not_accumulate_shadows_outside_damage() {
    let viewport = Viewport::with_physical_size(Size::new(W, H), 1.0);
    let mut renderer = Renderer::new(Font::DEFAULT, Pixels(16.0));
    let mut pixmap = tiny_skia::Pixmap::new(W, H).unwrap();
    let mut mask = tiny_skia::Mask::new(W, H).unwrap();
    let background = Color::from_rgb8(0x30, 0x34, 0x3c);
    shadowed(&mut renderer, Color::WHITE);
    let full = [Rectangle::with_size(Size::new(W as f32, H as f32))];
    renderer.draw(
        &mut pixmap.as_mut(),
        &mut mask,
        &viewport,
        &full,
        background,
    );
    let first = pixmap.data().to_vec();
    // A hover-sized damage region that contains the quad but not its shadow.
    let damage = [Rectangle::new([56.0, 36.0].into(), Size::new(48.0, 38.0))];
    for _ in 0..50 {
        renderer.draw(
            &mut pixmap.as_mut(),
            &mut mask,
            &viewport,
            &damage,
            background,
        );
    }
    let changed = first
        .as_chunks::<4>()
        .0
        .iter()
        .zip(pixmap.data().as_chunks::<4>().0.iter())
        .filter(|(a, b)| a.iter().zip(b.iter()).any(|(x, y)| x.abs_diff(*y) > 1))
        .count();
    assert_eq!(
        changed, 0,
        "{changed} pixels darkened after 50 partial redraws"
    );
}

#[test]
fn damage_of_a_changed_shadowed_quad_covers_its_shadow() {
    let viewport = Viewport::with_physical_size(Size::new(W, H), 1.0);
    let _ = viewport;
    let mut renderer = Renderer::new(Font::DEFAULT, Pixels(16.0));
    shadowed(&mut renderer, Color::WHITE);
    let before: Vec<Layer> = renderer.layers().to_vec();
    renderer.reset(Rectangle::with_size(Size::new(W as f32, H as f32)));
    shadowed(&mut renderer, Color::from_rgb(0.9, 0.2, 0.2));
    let after = renderer.layers().to_vec();
    let damage: Vec<Rectangle> = before
        .iter()
        .zip(after.iter())
        .flat_map(|(a, b)| Layer::damage(a, b))
        .collect();
    let shadow = Rectangle::new([42.0, 28.0].into(), Size::new(76.0, 66.0));
    assert!(
        damage.iter().any(|d| shadow.is_within(&d.expand(0.5))),
        "damage {damage:?} misses shadow {shadow:?}"
    );
    let _ = Transformation::IDENTITY;
}
