//! Cached vector art. No network assets or animation timer.
use crate::design::{Materials, alpha};
use iced::widget::canvas::{self, Cache, Canvas, Frame, Geometry, Path, Stroke};
use iced::{Color, Point, Rectangle, Renderer, Theme};

#[derive(Clone, Copy)]
pub enum NavIcon {
    Home,
    Conversation,
    News,
    Settings,
}
pub struct Icon(pub NavIcon, pub Color);
#[derive(Clone, Copy)]
pub enum CaptionKind {
    Minimize,
    Maximize,
    Restore,
    Close,
}
pub struct Caption(pub CaptionKind, pub Color);
impl<Message> canvas::Program<Message> for Caption {
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
        let stroke = Stroke::default().with_width(1.).with_color(self.1);
        match self.0 {
            CaptionKind::Minimize => {
                frame.stroke(&Path::line(Point::new(1., 7.), Point::new(11., 7.)), stroke)
            }
            CaptionKind::Maximize => frame.stroke(
                &Path::rectangle(Point::new(1.5, 1.5), iced::Size::new(9., 9.)),
                stroke,
            ),
            CaptionKind::Restore => {
                frame.stroke(
                    &Path::new(|p| {
                        p.move_to(Point::new(3.5, 3.5));
                        p.line_to(Point::new(3.5, 1.5));
                        p.line_to(Point::new(10.5, 1.5));
                        p.line_to(Point::new(10.5, 8.5));
                        p.line_to(Point::new(8.5, 8.5));
                    }),
                    stroke,
                );
                frame.stroke(
                    &Path::rectangle(Point::new(1.5, 3.5), iced::Size::new(7., 7.)),
                    stroke,
                );
            }
            CaptionKind::Close => {
                frame.stroke(
                    &Path::line(Point::new(2., 2.), Point::new(10., 10.)),
                    stroke,
                );
                frame.stroke(
                    &Path::line(Point::new(2., 10.), Point::new(10., 2.)),
                    stroke,
                );
            }
        };
        vec![frame.into_geometry()]
    }
}
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
                    if self.materials.reduced { 1.0 } else { 0.12 },
                ),
            );
        })]
    }
}
