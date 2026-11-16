//! Cached vector art. No network assets or animation timer.
use crate::design::{Materials, alpha};
use iced::widget::canvas::{self, Cache, Canvas, Frame, Geometry, Path, Stroke};
use iced::{Color, Point, Rectangle, Renderer, Size, Theme};

#[derive(Clone, Copy)]
pub enum NavIcon {
    Home,
    Conversation,
    News,
    Settings,
}
pub struct Icon(pub NavIcon, pub Color);
impl<Message> canvas::Program<Message> for Icon {
    type State = ();
    fn draw(
        &self,
        _: &(),
        renderer: &Renderer,
        _: &Theme,
        bounds: Rectangle,
        _: iced::mouse::Cursor,
    ) -> Vec<Geometry> {
        let mut frame = Frame::new(renderer, bounds.size());
        let stroke = Stroke::default().with_color(self.1).with_width(1.6);
        let mut line = |points: &[(f32, f32)]| {
            let path = Path::new(|p| {
                p.move_to(Point::new(points[0].0, points[0].1));
                for &(x, y) in &points[1..] {
                    p.line_to(Point::new(x, y));
                }
            });
            frame.stroke(&path, stroke);
        };
        match self.0 {
            NavIcon::Home => {
                line(&[(3., 11.), (12., 3.), (21., 11.)]);
                line(&[
                    (5., 9.),
                    (5., 21.),
                    (10., 21.),
                    (10., 15.),
                    (14., 15.),
                    (14., 21.),
                    (19., 21.),
                    (19., 9.),
                ]);
            }
            NavIcon::Conversation => {
                line(&[
                    (5., 4.),
                    (20., 4.),
                    (20., 16.),
                    (11., 16.),
                    (5., 21.),
                    (5., 16.),
                    (3., 16.),
                    (3., 6.),
                    (5., 4.),
                ]);
                line(&[(7., 8.), (16., 8.)]);
                line(&[(7., 12.), (13., 12.)]);
            }
            NavIcon::News => {
                line(&[
                    (12., 2.),
                    (15., 9.),
                    (22., 12.),
                    (15., 15.),
                    (12., 22.),
                    (9., 15.),
                    (2., 12.),
                    (9., 9.),
                    (12., 2.),
                ]);
            }
            NavIcon::Settings => {
                for (y, x) in [(5., 8.), (12., 16.), (19., 10.)] {
                    line(&[(3., y), (x - 2., y)]);
                    line(&[(x + 2., y), (21., y)]);
                    line(&[
                        (x - 2., y - 2.),
                        (x + 2., y - 2.),
                        (x + 2., y + 2.),
                        (x - 2., y + 2.),
                        (x - 2., y - 2.),
                    ]);
                }
            }
        }
        vec![frame.into_geometry()]
    }
}
#[derive(Default)]
pub struct Atmosphere {
    pub cache: Cache,
}
impl Atmosphere {
    pub fn view<Message>(&self, materials: Materials) -> Canvas<Backdrop<'_>, Message> {
        Canvas::new(Backdrop {
            cache: &self.cache,
            materials,
        })
        .width(iced::Fill)
        .height(iced::Fill)
    }
}
pub struct Backdrop<'a> {
    cache: &'a Cache,
    materials: Materials,
}
impl<Message> canvas::Program<Message> for Backdrop<'_> {
    type State = ();
    fn draw(
        &self,
        _: &(),
        renderer: &Renderer,
        _: &Theme,
        bounds: Rectangle,
        _: iced::mouse::Cursor,
    ) -> Vec<Geometry> {
        vec![self.cache.draw(renderer, bounds.size(), |frame| {
            frame.fill_rectangle(
                Point::ORIGIN,
                bounds.size(),
                alpha(
                    self.materials.base,
                    if self.materials.reduced { 1.0 } else { 0.78 },
                ),
            );
            if self.materials.reduced {
                return;
            }
            for (center, color, radius) in [
                (
                    Point::new(bounds.width * 0.87, bounds.height * 0.13),
                    self.materials.accent,
                    410.0,
                ),
                (
                    Point::new(bounds.width * 0.28, bounds.height * 0.85),
                    self.materials.secondary,
                    380.0,
                ),
            ] {
                for i in (1..=60).rev() {
                    let fraction = i as f32 / 60.0;
                    frame.fill(
                        &Path::circle(center, radius * fraction),
                        alpha(color, 0.012 * (1.0 - fraction)),
                    );
                }
            }
        })]
    }
}
pub struct Frequency(pub Materials);
impl<Message> canvas::Program<Message> for Frequency {
    type State = ();
    fn draw(
        &self,
        _: &(),
        renderer: &Renderer,
        _: &Theme,
        bounds: Rectangle,
        _: iced::mouse::Cursor,
    ) -> Vec<Geometry> {
        let mut frame = Frame::new(renderer, Size::new(bounds.width, bounds.height));
        let center = Point::new(bounds.width * 0.53, bounds.height * 0.5);
        for i in (1..36).rev() {
            frame.stroke(
                &Path::circle(center, 110.0 + i as f32 * 2.0),
                Stroke::default()
                    .with_color(alpha(self.0.secondary, 0.005))
                    .with_width(3.0),
            );
        }
        for i in 0..45 {
            let t = i as f32 / 44.0;
            let height =
                10.0 + (t * std::f32::consts::PI).sin() * (40.0 + (t * 26.0).sin().abs() * 65.0);
            let x = center.x - 140.0 + i as f32 * 6.4;
            frame.stroke(
                &Path::line(
                    Point::new(x, center.y - height),
                    Point::new(x, center.y + height),
                ),
                Stroke::default()
                    .with_color(alpha(
                        if i % 3 == 0 {
                            self.0.secondary
                        } else {
                            self.0.accent
                        },
                        0.30 + (t * std::f32::consts::PI).sin() * 0.5,
                    ))
                    .with_width(2.0),
            );
        }
        vec![frame.into_geometry()]
    }
}
