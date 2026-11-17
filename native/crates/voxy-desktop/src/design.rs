use iced::widget::{button, container, overlay::menu, pick_list, slider, text_input, toggler};
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
pub fn vertical_scrollbar() -> iced::widget::scrollable::Direction {
    iced::widget::scrollable::Direction::Vertical(
        iced::widget::scrollable::Scrollbar::new()
            .width(4)
            .scroller_width(4),
    )
}
impl Materials {
    pub fn dialog(self) -> container::Style {
        let mut style = self.glass(true);
        if !self.reduced {
            style.background = Some(Background::Gradient(
                gradient::Linear::new(Radians(0.8))
                    .add_stop(0.0, alpha(self.elevated, 0.98))
                    .add_stop(1.0, alpha(self.base, 0.99))
                    .into(),
            ));
        }
        style
    }
    pub fn navigation(self, selected: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
        move |_, status| button::Style {
            background: Some(
                alpha(
                    self.ink,
                    if selected {
                        0.1
                    } else if matches!(status, button::Status::Hovered) {
                        0.05
                    } else {
                        0.0
                    },
                )
                .into(),
            ),
            text_color: if selected { self.ink } else { self.muted },
            border: Border {
                radius: 8.0.into(),
                width: if selected { 1. } else { 0. },
                color: alpha(self.ink, 0.13),
            },
            ..Default::default()
        }
    }
    pub fn scroll(
        self,
    ) -> impl Fn(&Theme, iced::widget::scrollable::Status) -> iced::widget::scrollable::Style {
        move |theme, status| {
            let mut style = iced::widget::scrollable::default(theme, status);
            let rail = iced::widget::scrollable::Rail {
                background: None,
                border: Border::default(),
                scroller: iced::widget::scrollable::Scroller {
                    background: alpha(self.ink, 0.22).into(),
                    border: Border {
                        radius: 4.0.into(),
                        ..Default::default()
                    },
                },
            };
            style.vertical_rail = rail;
            style.horizontal_rail = rail;
            style
        }
    }
    pub fn new(theme: ProfileTheme) -> Self {
        let (accent, secondary, base, panel, elevated) = match theme {
            ProfileTheme::Voxy => (0xdedfe3, 0xa2a6af, 0x111214, 0x1c1e21, 0x32353b),
            ProfileTheme::Ocean => (0x9bd4d6, 0x6d9eae, 0x0c171b, 0x172b32, 0x284751),
            ProfileTheme::Forest => (0xbfc9ab, 0xbaaa87, 0x141913, 0x232d22, 0x3c4634),
            ProfileTheme::Kuromi => (0xf1b5d1, 0xba9acb, 0x18121c, 0x2c2034, 0x49324e),
        };
        Self {
            reduced: false,
            base: rgb(base),
            panel: alpha(rgb(panel), 0.88),
            elevated: alpha(rgb(elevated), 0.73),
            accent: rgb(accent),
            secondary: rgb(secondary),
            ink: rgb(0xe9e9ec),
            muted: rgb(0xa4a6ae),
            border: alpha(rgb(0xe4e5ea), 0.13),
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
                radius: if elevated { 16.0.into() } else { 10.0.into() },
            },
            shadow: Shadow {
                color: alpha(Color::BLACK, 0.24),
                offset: Vector::new(0.0, 5.0),
                blur_radius: 16.0,
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
                    radius: 8.0.into(),
                },
                shadow: if primary && !pressed && !disabled && !self.reduced {
                    Shadow {
                        color: alpha(Color::BLACK, 0.18),
                        offset: Vector::new(0.0, 2.0),
                        blur_radius: 5.0,
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
    pub fn toggle(self) -> impl Fn(&Theme, toggler::Status) -> toggler::Style {
        move |_, status| {
            let on = matches!(
                status,
                toggler::Status::Active { is_toggled: true }
                    | toggler::Status::Hovered { is_toggled: true }
                    | toggler::Status::Disabled { is_toggled: true }
            );
            toggler::Style {
                background: if on {
                    self.accent.into()
                } else {
                    alpha(self.ink, 0.13).into()
                },
                background_border_width: 1.,
                background_border_color: self.border,
                foreground: if on {
                    self.base.into()
                } else {
                    self.ink.into()
                },
                foreground_border_width: 0.,
                foreground_border_color: Color::TRANSPARENT,
                text_color: Some(self.ink),
                border_radius: None,
                padding_ratio: 0.18,
            }
        }
    }
    pub fn select(self) -> impl Fn(&Theme, pick_list::Status) -> pick_list::Style {
        move |_, status| pick_list::Style {
            text_color: self.ink,
            placeholder_color: self.muted,
            handle_color: self.muted,
            background: alpha(self.base, 0.8).into(),
            border: Border {
                radius: 8.0.into(),
                width: 1.,
                color: if matches!(status, pick_list::Status::Hovered) {
                    alpha(self.ink, 0.4)
                } else {
                    self.border
                },
            },
        }
    }
    pub fn menu(self) -> impl Fn(&Theme) -> menu::Style {
        move |_| menu::Style {
            background: rgb(0x25272b).into(),
            border: Border {
                radius: 8.0.into(),
                width: 1.,
                color: self.border,
            },
            text_color: self.ink,
            selected_text_color: self.ink,
            selected_background: alpha(self.accent, 0.15).into(),
            shadow: Shadow {
                color: alpha(Color::BLACK, 0.4),
                offset: Vector::new(0., 6.),
                blur_radius: 14.,
            },
        }
    }
    pub fn slider(self) -> impl Fn(&Theme, slider::Status) -> slider::Style {
        move |_, _| slider::Style {
            rail: slider::Rail {
                backgrounds: (self.accent.into(), alpha(self.ink, 0.1).into()),
                width: 3.,
                border: Border {
                    radius: 2.0.into(),
                    ..Default::default()
                },
            },
            handle: slider::Handle {
                shape: slider::HandleShape::Circle { radius: 6. },
                background: self.ink.into(),
                border_width: 1.,
                border_color: self.border,
            },
        }
    }
}
