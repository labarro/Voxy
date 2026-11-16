use iced::widget::{button, container, text_input};
use iced::{Background, Border, Color, Radians, Shadow, Theme, Vector, gradient};
use voxy_core::model::Theme as ProfileTheme;
#[derive(Clone, Copy)]
pub struct Materials {
    pub reduced: bool,
    pub base: Color,
    pub panel: Color,
    pub elevated: Color,
    pub accent: Color,
    pub secondary: Color,
    pub ink: Color,
    pub muted: Color,
    pub border: Color,
}
pub fn rgb(value: u32) -> Color {
    Color::from_rgb8((value >> 16) as u8, (value >> 8) as u8, value as u8)
}
pub fn alpha(mut color: Color, a: f32) -> Color {
    color.a = a;
    color
}
impl Materials {
    pub fn new(theme: ProfileTheme) -> Self {
        let (accent, secondary, base) = match theme {
            ProfileTheme::Voxy => (0x9bbdff, 0xc0a9ec, 0x10131e),
            ProfileTheme::Ocean => (0x87d8ee, 0x8dacf8, 0x0d1822),
            ProfileTheme::Forest => (0xb6dbaf, 0xe1bf91, 0x111b19),
            ProfileTheme::Kuromi => (0xffaad6, 0xc1abf5, 0x1c1323),
        };
        Self {
            reduced: false,
            base: rgb(base),
            panel: alpha(rgb(0x202738), 0.78),
            elevated: alpha(rgb(0x333e55), 0.62),
            accent: rgb(accent),
            secondary: rgb(secondary),
            ink: rgb(0xf0f2fa),
            muted: rgb(0xa9b2c8),
            border: alpha(rgb(0xc9dbff), 0.14),
        }
    }
    pub fn glass(self, elevated: bool) -> container::Style {
        if self.reduced {
            return container::Style {
                background: Some(self.base.into()),
                text_color: Some(self.ink),
                border: Border {
                    color: self.border,
                    width: 1.0,
                    radius: 14.0.into(),
                },
                ..Default::default()
            };
        }
        container::Style {
            background: Some(Background::Gradient(
                gradient::Linear::new(Radians(0.8))
                    .add_stop(0.0, if elevated { self.elevated } else { self.panel })
                    .add_stop(1.0, alpha(self.base, 0.82))
                    .into(),
            )),
            text_color: Some(self.ink),
            border: Border {
                color: self.border,
                width: 1.0,
                radius: 20.0.into(),
            },
            shadow: Shadow {
                color: alpha(Color::BLACK, 0.24),
                offset: Vector::new(0.0, 10.0),
                blur_radius: 28.0,
            },
            ..Default::default()
        }
    }
    pub fn button(self, primary: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
        move |_, status| {
            let hover = matches!(status, button::Status::Hovered);
            let pressed = matches!(status, button::Status::Pressed);
            let disabled = matches!(status, button::Status::Disabled);
            button::Style {
                background: Some(Background::Color(if primary {
                    alpha(
                        self.accent,
                        if disabled {
                            0.25
                        } else if pressed {
                            0.68
                        } else {
                            0.96
                        },
                    )
                } else {
                    alpha(self.ink, if hover { 0.1 } else { 0.045 })
                })),
                text_color: if primary && !disabled {
                    self.base
                } else if disabled {
                    self.muted
                } else {
                    self.ink
                },
                border: Border {
                    color: if hover {
                        alpha(self.accent, 0.6)
                    } else {
                        self.border
                    },
                    width: 1.0,
                    radius: 11.0.into(),
                },
                shadow: if primary && !pressed && !disabled {
                    Shadow {
                        color: alpha(self.accent, 0.13),
                        offset: Vector::new(0.0, 4.0),
                        blur_radius: 15.0,
                    }
                } else {
                    Shadow::default()
                },
                ..Default::default()
            }
        }
    }
    pub fn input(self) -> impl Fn(&Theme, text_input::Status) -> text_input::Style {
        move |_, status| text_input::Style {
            background: Background::Color(alpha(self.base, 0.55)),
            border: Border {
                color: if matches!(status, text_input::Status::Focused { .. }) {
                    self.accent
                } else {
                    self.border
                },
                width: 1.0,
                radius: 11.0.into(),
            },
            icon: self.muted,
            placeholder: self.muted,
            value: self.ink,
            selection: alpha(self.accent, 0.3),
        }
    }
}
