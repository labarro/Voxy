//! Voxy design tokens and widget styles ("Nocturne glass").
//!
//! One source for color, type scale, spacing, radii and elevation. Surfaces are
//! opaque, stepped in lightness, with a faint top sheen instead of real blur, so
//! the look holds on low-end GPUs and in the tiny-skia software renderer. Only
//! floating layers (tooltips, menus, dialogs, the call dock) cast shadows.
//! Communication states (speaking, muted, live) keep the same hue in every theme.
use iced::widget::{button, container, overlay::menu, pick_list, slider, text_input, toggler};
use iced::{Background, Border, Color, Radians, Shadow, Theme, Vector, gradient};
use voxy_core::model::Theme as ProfileTheme;

/// Type scale (logical px).
#[allow(dead_code)]
pub mod size {
    pub const MICRO: f32 = 11.0;
    pub const CAPTION: f32 = 12.0;
    pub const SMALL: f32 = 13.0;
    pub const BODY: f32 = 14.0;
    pub const STRONG: f32 = 15.0;
    pub const HEADING: f32 = 18.0;
    pub const TITLE: f32 = 22.0;
    pub const DISPLAY: f32 = 28.0;
}
/// 4-pt spacing scale (token table; screens pick from these values).
#[allow(dead_code)]
pub mod space {
    pub const XS: f32 = 4.0;
    pub const S: f32 = 8.0;
    pub const M: f32 = 12.0;
    pub const L: f32 = 16.0;
    pub const XL: f32 = 24.0;
    pub const XXL: f32 = 32.0;
}
pub mod radius {
    pub const S: f32 = 6.0;
    pub const M: f32 = 10.0;
    pub const L: f32 = 14.0;
    pub const XL: f32 = 20.0;
    pub const PILL: f32 = 999.0;
}
/// Minimum interactive target (logical px).
pub const HIT: f32 = 36.0;

#[derive(Clone, Copy)]
pub struct Materials {
    pub reduced: bool,
    /// App floor behind everything (titlebar, gaps).
    pub base: Color,
    /// Left rail.
    pub rail: Color,
    /// Context sidebar (channels, conversations, settings nav).
    pub sidebar: Color,
    /// Main canvas.
    pub canvas: Color,
    /// Cards, tiles, inputs on the canvas.
    pub panel: Color,
    /// Floating layers: menus, tooltips, dialogs, dock.
    pub elevated: Color,
    pub accent: Color,
    /// Text/icon color placed on `accent`.
    pub on_accent: Color,
    pub secondary: Color,
    pub ink: Color,
    pub muted: Color,
    pub faint: Color,
    pub border: Color,
    pub speaking: Color,
    pub danger: Color,
    pub warning: Color,
    pub live: Color,
}
pub fn rgb(value: u32) -> Color {
    Color::from_rgb8((value >> 16) as u8, (value >> 8) as u8, value as u8)
}
pub fn alpha(mut color: Color, a: f32) -> Color {
    color.a = a;
    color
}
/// Mixes `b` over `a` by `t` (opaque result when both are opaque).
pub fn mix(a: Color, b: Color, t: f32) -> Color {
    Color {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
        a: a.a + (b.a - a.a) * t,
    }
}
pub fn vertical_scrollbar() -> iced::widget::scrollable::Direction {
    iced::widget::scrollable::Direction::Vertical(
        iced::widget::scrollable::Scrollbar::new()
            .width(6)
            .scroller_width(4)
            .margin(2),
    )
}
/// Button roles.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    /// Accent filled: the one main action of a surface.
    Primary,
    /// Quiet filled.
    Secondary,
    /// Text-only until hovered.
    Ghost,
    /// Destructive / disconnect.
    Danger,
    /// Toggled-on control (e.g. muted microphone shows as `Alert`).
    Active,
    Alert,
}
impl Materials {
    pub fn new(theme: ProfileTheme) -> Self {
        // (accent, secondary, base, rail, sidebar, canvas, panel, elevated, on_accent)
        let t = match theme {
            ProfileTheme::Voxy => (
                0x9b8cff, 0x6fd6c9, 0x0a0c11, 0x0b0d12, 0x10131a, 0x13161e, 0x1a1e28, 0x222734,
                0x06051a,
            ),
            ProfileTheme::Ocean => (
                0x5fc8e6, 0x7aa7ff, 0x07121a, 0x08131b, 0x0c1a23, 0x0f1f29, 0x152a36, 0x1c3443,
                0x020c14,
            ),
            ProfileTheme::Forest => (
                0xa3cf7e, 0xd8c08a, 0x0b110d, 0x0c120e, 0x111912, 0x141d16, 0x1b261d, 0x243127,
                0x081205,
            ),
            ProfileTheme::Kuromi => (
                0xf39bcb, 0xb89cf2, 0x110c15, 0x120d16, 0x19121e, 0x1d1523, 0x271c2f, 0x31243b,
                0x1c0814,
            ),
        };
        Self {
            reduced: false,
            accent: rgb(t.0),
            secondary: rgb(t.1),
            base: rgb(t.2),
            rail: rgb(t.3),
            sidebar: rgb(t.4),
            canvas: rgb(t.5),
            panel: rgb(t.6),
            elevated: rgb(t.7),
            on_accent: rgb(t.8),
            ink: rgb(0xeceef3),
            muted: rgb(0xa3a8b6),
            faint: rgb(0x6c7180),
            border: alpha(rgb(0xffffff), 0.075),
            speaking: rgb(0x3ddc84),
            danger: rgb(0xf2555a),
            warning: rgb(0xf5b94a),
            live: rgb(0xff4d5e),
        }
    }
    /// Faint top sheen on an opaque surface ("glass" without blur).
    fn sheen(self, color: Color, strength: f32) -> Background {
        if self.reduced {
            return color.into();
        }
        Background::Gradient(
            gradient::Linear::new(Radians(std::f32::consts::PI))
                .add_stop(0.0, mix(color, Color::WHITE, strength))
                .add_stop(0.45, color)
                .add_stop(1.0, color)
                .into(),
        )
    }
    pub fn surface(self, color: Color) -> container::Style {
        container::Style {
            background: Some(color.into()),
            text_color: Some(self.ink),
            ..Default::default()
        }
    }
    /// Card on the canvas: opaque, hairline, sheen, no shadow.
    pub fn card(self) -> container::Style {
        container::Style {
            background: Some(self.sheen(self.panel, 0.035)),
            text_color: Some(self.ink),
            border: Border {
                color: self.border,
                width: 1.0,
                radius: radius::L.into(),
            },
            ..Default::default()
        }
    }
    /// Floating layer with depth (menus, popovers, the call dock).
    pub fn floating(self) -> container::Style {
        container::Style {
            background: Some(self.sheen(self.elevated, 0.05)),
            text_color: Some(self.ink),
            border: Border {
                color: alpha(Color::WHITE, 0.1),
                width: 1.0,
                radius: radius::L.into(),
            },
            shadow: if self.reduced {
                Shadow::default()
            } else {
                Shadow {
                    color: alpha(Color::BLACK, 0.45),
                    offset: Vector::new(0.0, 10.0),
                    blur_radius: 28.0,
                }
            },
            ..Default::default()
        }
    }
    pub fn tooltip(self) -> container::Style {
        container::Style {
            background: Some(mix(self.elevated, Color::BLACK, 0.15).into()),
            text_color: Some(self.ink),
            border: Border {
                color: alpha(Color::WHITE, 0.12),
                width: 1.0,
                radius: radius::S.into(),
            },
            shadow: Shadow {
                color: alpha(Color::BLACK, 0.4),
                offset: Vector::new(0.0, 4.0),
                blur_radius: 12.0,
            },
            ..Default::default()
        }
    }
    /// Kept for existing call sites: a card (`elevated=false`) or floating layer.
    pub fn glass(self, elevated: bool) -> container::Style {
        if elevated {
            self.floating()
        } else {
            self.card()
        }
    }
    pub fn dialog(self) -> container::Style {
        let mut style = self.floating();
        style.border.radius = radius::XL.into();
        style
    }
    /// Full-window scrim behind dialogs.
    pub fn scrim(self) -> container::Style {
        container::Style {
            background: Some(alpha(mix(self.base, Color::BLACK, 0.4), 0.78).into()),
            ..Default::default()
        }
    }
    /// Sidebar row (channel, conversation, settings section).
    pub fn navigation(self, selected: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
        move |_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(
                    if selected {
                        alpha(self.ink, 0.085)
                    } else if hover {
                        alpha(self.ink, 0.05)
                    } else {
                        Color::TRANSPARENT
                    }
                    .into(),
                ),
                text_color: if selected || hover {
                    self.ink
                } else {
                    self.muted
                },
                border: Border {
                    radius: radius::M.into(),
                    ..Default::default()
                },
                ..Default::default()
            }
        }
    }
    pub fn scroll(
        self,
    ) -> impl Fn(&Theme, iced::widget::scrollable::Status) -> iced::widget::scrollable::Style {
        move |theme, status| {
            let mut style = iced::widget::scrollable::default(theme, status);
            let active = matches!(
                status,
                iced::widget::scrollable::Status::Hovered { .. }
                    | iced::widget::scrollable::Status::Dragged { .. }
            );
            let rail = iced::widget::scrollable::Rail {
                background: None,
                border: Border::default(),
                scroller: iced::widget::scrollable::Scroller {
                    background: alpha(self.ink, if active { 0.28 } else { 0.12 }).into(),
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
    pub fn tone(self, tone: Tone) -> impl Fn(&Theme, button::Status) -> button::Style {
        move |_, status| {
            let hover = matches!(status, button::Status::Hovered);
            let pressed = matches!(status, button::Status::Pressed);
            let disabled = matches!(status, button::Status::Disabled);
            let (fill, text) = match tone {
                Tone::Primary => (self.accent, self.on_accent),
                Tone::Danger => (self.danger, Color::WHITE),
                Tone::Alert => (
                    alpha(self.danger, 0.18),
                    mix(self.danger, Color::WHITE, 0.25),
                ),
                Tone::Active => (
                    alpha(self.accent, 0.2),
                    mix(self.accent, Color::WHITE, 0.35),
                ),
                Tone::Secondary => (alpha(self.ink, 0.07), self.ink),
                Tone::Ghost => (Color::TRANSPARENT, self.muted),
            };
            let fill = if disabled {
                alpha(self.ink, 0.04)
            } else if pressed {
                mix(fill, Color::BLACK, 0.12)
            } else if hover {
                match tone {
                    Tone::Ghost => alpha(self.ink, 0.07),
                    Tone::Secondary => alpha(self.ink, 0.11),
                    Tone::Primary | Tone::Danger => mix(fill, Color::WHITE, 0.1),
                    Tone::Alert => alpha(self.danger, 0.26),
                    Tone::Active => alpha(self.accent, 0.28),
                }
            } else {
                fill
            };
            button::Style {
                background: Some(fill.into()),
                text_color: if disabled {
                    self.faint
                } else if tone == Tone::Ghost && hover {
                    self.ink
                } else {
                    text
                },
                border: Border {
                    color: Color::TRANSPARENT,
                    width: 0.0,
                    radius: radius::M.into(),
                },
                ..Default::default()
            }
        }
    }
    /// Kept for existing call sites.
    pub fn button(self, primary: bool) -> impl Fn(&Theme, button::Status) -> button::Style {
        self.tone(if primary {
            Tone::Primary
        } else {
            Tone::Secondary
        })
    }
    pub fn input(self) -> impl Fn(&Theme, text_input::Status) -> text_input::Style {
        move |_, status| {
            let focused = matches!(status, text_input::Status::Focused { .. });
            let hovered = matches!(status, text_input::Status::Hovered);
            text_input::Style {
                background: Background::Color(mix(self.canvas, Color::BLACK, 0.18)),
                border: Border {
                    color: if focused {
                        alpha(self.accent, 0.85)
                    } else if hovered {
                        alpha(self.ink, 0.16)
                    } else {
                        alpha(self.ink, 0.09)
                    },
                    width: 1.0,
                    radius: radius::M.into(),
                },
                icon: self.muted,
                placeholder: self.faint,
                value: self.ink,
                selection: alpha(self.accent, 0.32),
            }
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
                    alpha(self.ink, 0.14).into()
                },
                background_border_width: 0.,
                background_border_color: Color::TRANSPARENT,
                foreground: if on {
                    self.on_accent.into()
                } else {
                    mix(self.ink, self.canvas, 0.15).into()
                },
                foreground_border_width: 0.,
                foreground_border_color: Color::TRANSPARENT,
                text_color: Some(self.ink),
                border_radius: None,
                padding_ratio: 0.16,
            }
        }
    }
    pub fn select(self) -> impl Fn(&Theme, pick_list::Status) -> pick_list::Style {
        move |_, status| pick_list::Style {
            text_color: self.ink,
            placeholder_color: self.faint,
            handle_color: self.muted,
            background: mix(self.canvas, Color::BLACK, 0.18).into(),
            border: Border {
                radius: radius::M.into(),
                width: 1.,
                color: if matches!(status, pick_list::Status::Hovered) {
                    alpha(self.ink, 0.18)
                } else if matches!(status, pick_list::Status::Opened { .. }) {
                    alpha(self.accent, 0.85)
                } else {
                    alpha(self.ink, 0.09)
                },
            },
        }
    }
    pub fn menu(self) -> impl Fn(&Theme) -> menu::Style {
        move |_| menu::Style {
            background: self.elevated.into(),
            border: Border {
                radius: radius::M.into(),
                width: 1.,
                color: alpha(Color::WHITE, 0.1),
            },
            text_color: self.ink,
            selected_text_color: self.ink,
            selected_background: alpha(self.accent, 0.2).into(),
            shadow: Shadow {
                color: alpha(Color::BLACK, 0.45),
                offset: Vector::new(0., 8.),
                blur_radius: 20.,
            },
        }
    }
    pub fn slider(self) -> impl Fn(&Theme, slider::Status) -> slider::Style {
        move |_, status| slider::Style {
            rail: slider::Rail {
                backgrounds: (self.accent.into(), alpha(self.ink, 0.12).into()),
                width: 4.,
                border: Border {
                    radius: 2.0.into(),
                    ..Default::default()
                },
            },
            handle: slider::Handle {
                shape: slider::HandleShape::Circle {
                    radius: if matches!(status, slider::Status::Hovered | slider::Status::Dragged) {
                        8.
                    } else {
                        7.
                    },
                },
                background: self.ink.into(),
                border_width: 2.,
                border_color: self.accent,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// WCAG relative luminance contrast.
    fn contrast(a: Color, b: Color) -> f32 {
        let l = |c: Color| {
            let f = |v: f32| {
                if v <= 0.03928 {
                    v / 12.92
                } else {
                    ((v + 0.055) / 1.055).powf(2.4)
                }
            };
            0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
        };
        let (x, y) = (l(a), l(b));
        (x.max(y) + 0.05) / (x.min(y) + 0.05)
    }
    #[test]
    fn every_theme_keeps_readable_contrast() {
        for theme in [
            ProfileTheme::Voxy,
            ProfileTheme::Ocean,
            ProfileTheme::Forest,
            ProfileTheme::Kuromi,
        ] {
            let m = Materials::new(theme);
            for surface in [m.base, m.sidebar, m.canvas, m.panel, m.elevated] {
                assert!(
                    contrast(m.ink, surface) >= 10.0,
                    "ink {}",
                    contrast(m.ink, surface)
                );
                assert!(
                    contrast(m.muted, surface) >= 4.5,
                    "muted text AA {}",
                    contrast(m.muted, surface)
                );
            }
            assert!(
                contrast(m.on_accent, m.accent) >= 7.0,
                "text on accent {}",
                contrast(m.on_accent, m.accent)
            );
            assert!(
                contrast(m.speaking, m.canvas) >= 3.0,
                "speaking ring is a UI indicator"
            );
            assert!(contrast(m.danger, m.canvas) >= 3.0);
        }
    }
}
