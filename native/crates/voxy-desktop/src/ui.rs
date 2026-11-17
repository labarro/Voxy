//! Reusable components built on the design tokens. Screens compose these instead
//! of styling widgets ad hoc.
use crate::{
    Msg, bold,
    design::{self, Materials, Tone, alpha, mix, radius, size},
    icons::Icon,
};
use iced::{
    Border, Color, Element,
    Length::Fill,
    widget::{button, column, container, row, svg, text, tooltip},
};
use std::time::Duration;

pub fn icon<'a>(icon: Icon, px: f32, color: Color) -> Element<'a, Msg> {
    svg(icon.handle())
        .width(px)
        .height(px)
        .style(move |_, _| svg::Style { color: Some(color) })
        .into()
}

/// Styled tooltip: delayed, snapped inside the window, never affects layout.
pub fn tip<'a>(
    m: Materials,
    content: impl Into<Element<'a, Msg>>,
    label: impl text::IntoFragment<'a>,
    position: tooltip::Position,
) -> Element<'a, Msg> {
    tooltip(
        content,
        container(text(label).size(size::CAPTION).color(m.ink))
            .padding([5, 9])
            .style(move |_| m.tooltip()),
        position,
    )
    .gap(8)
    .delay(Duration::from_millis(350))
    .snap_within_viewport(true)
    .into()
}

/// Square icon button with an accessible label (tooltip + automation id).
pub fn icon_button<'a>(
    m: Materials,
    glyph: Icon,
    label: &str,
    msg: Option<Msg>,
    tone: Tone,
    px: f32,
) -> Element<'a, Msg> {
    let color = match tone {
        Tone::Primary => m.on_accent,
        Tone::Danger => Color::WHITE,
        Tone::Alert => mix(m.danger, Color::WHITE, 0.25),
        Tone::Active => mix(m.accent, Color::WHITE, 0.35),
        Tone::Secondary => m.ink,
        Tone::Ghost => {
            if msg.is_some() {
                m.muted
            } else {
                m.faint
            }
        }
    };
    let side = px.max(design::HIT * 0.78);
    let mut b = button(
        container(icon(glyph, (px * 0.5).round().max(14.0), color))
            .id(format!("btn-{label}"))
            .width(side)
            .height(side)
            .center(side),
    )
    .padding(0)
    .style(m.tone(tone));
    if let Some(msg) = msg {
        b = b.on_press(msg);
    }
    tip(m, b, label.to_owned(), tooltip::Position::Top)
}

/// Icon + text button (toolbar and dialog actions).
pub fn action<'a>(
    m: Materials,
    glyph: Option<Icon>,
    label: &str,
    msg: Option<Msg>,
    tone: Tone,
) -> button::Button<'a, Msg> {
    let color = match tone {
        Tone::Primary => m.on_accent,
        Tone::Danger => Color::WHITE,
        Tone::Ghost => m.muted,
        _ => m.ink,
    };
    let mut content = row![].spacing(8).align_y(iced::Center);
    if let Some(glyph) = glyph {
        content = content.push(icon(glyph, 16.0, color));
    }
    content = content.push(text(label.to_owned()).size(size::SMALL).font(bold()));
    let mut b = button(content).padding([8, 14]).style(m.tone(tone));
    if let Some(msg) = msg {
        b = b.on_press(msg);
    }
    b
}

/// Stable per-person hue so the same person is recognizable everywhere.
pub fn person_color(name: &str) -> Color {
    const HUES: [u32; 8] = [
        0x7c6cf2, 0x2f9fd6, 0x2bb39a, 0xd08a3a, 0xd25f8a, 0x8f6bd6, 0x4f8fe0, 0xc4684a,
    ];
    let hash = name
        .bytes()
        .fold(2166136261u32, |h, b| (h ^ b as u32).wrapping_mul(16777619));
    design::rgb(HUES[(hash % HUES.len() as u32) as usize])
}
pub fn initials(name: &str) -> String {
    let mut parts = name.split_whitespace();
    let first = parts.next().and_then(|p| p.chars().next());
    let second = parts.next().and_then(|p| p.chars().next());
    match (first, second) {
        (Some(a), Some(b)) => format!("{a}{b}").to_uppercase(),
        (Some(a), None) => a.to_uppercase().to_string(),
        _ => "V".into(),
    }
}

/// Avatar state ring, independent of color alone: speaking adds a thick ring,
/// muted/deafened add a corner badge with an icon.
#[derive(Clone, Copy, Default, PartialEq)]
pub struct Ring {
    pub speaking: bool,
    pub muted: bool,
    pub deafened: bool,
}
pub fn avatar<'a>(m: Materials, name: &str, px: f32, ring: Ring) -> Element<'a, Msg> {
    let tint = person_color(name);
    let face = container(
        text(initials(name))
            .size((px * 0.38).max(10.0))
            .font(bold())
            .color(Color::WHITE),
    )
    .id(format!("avatar-{}", px as u32))
    .width(px)
    .height(px)
    .center(px)
    .style(move |_| container::Style {
        background: Some(mix(tint, m.canvas, 0.25).into()),
        border: Border {
            radius: radius::PILL.into(),
            width: 1.0,
            color: alpha(Color::WHITE, 0.08),
        },
        ..Default::default()
    });
    let gap = (px * 0.07).clamp(2.0, 4.0);
    let width = (px * 0.07).clamp(2.0, 3.5);
    let outer = px + 2.0 * (gap + width);
    let ringed = container(face)
        .padding(gap + width)
        .width(outer)
        .height(outer)
        .style(move |_| container::Style {
            border: Border {
                radius: radius::PILL.into(),
                width,
                color: if ring.speaking {
                    m.speaking
                } else {
                    Color::TRANSPARENT
                },
            },
            ..Default::default()
        });
    if !(ring.muted || ring.deafened) || px < 26.0 {
        return ringed.into();
    }
    let badge_px = (px * 0.36).clamp(16.0, 26.0);
    let badge = container(icon(
        if ring.deafened {
            Icon::HeadphoneOff
        } else {
            Icon::MicOff
        },
        badge_px * 0.6,
        Color::WHITE,
    ))
    .width(badge_px)
    .height(badge_px)
    .center(badge_px)
    .style(move |_| container::Style {
        background: Some(m.danger.into()),
        border: Border {
            radius: radius::PILL.into(),
            width: 2.0,
            color: m.canvas,
        },
        ..Default::default()
    });
    iced::widget::stack![
        ringed,
        container(badge)
            .width(outer)
            .height(outer)
            .align_x(iced::alignment::Horizontal::Right)
            .align_y(iced::alignment::Vertical::Bottom)
    ]
    .into()
}

pub fn presence_color(m: Materials, presence: Option<voxy_core::room::Presence>) -> Color {
    match presence {
        Some(voxy_core::room::Presence::Online) => m.speaking,
        Some(voxy_core::room::Presence::Away) => m.warning,
        Some(voxy_core::room::Presence::Busy) => m.danger,
        None => m.faint,
    }
}
pub fn dot<'a>(color: Color, px: f32) -> Element<'a, Msg> {
    container(text(""))
        .width(px)
        .height(px)
        .style(move |_| container::Style {
            background: Some(color.into()),
            border: Border {
                radius: radius::PILL.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}

/// Small uppercase-free section label.
pub fn label<'a>(m: Materials, title: impl text::IntoFragment<'a>) -> Element<'a, Msg> {
    text(title)
        .size(size::CAPTION)
        .font(bold())
        .color(m.faint)
        .into()
}

/// Compact badge (e.g. "AO VIVO", "720p · 30 fps").
pub fn badge<'a>(
    text_value: impl text::IntoFragment<'a>,
    fg: Color,
    bg: Color,
) -> Element<'a, Msg> {
    container(text(text_value).size(size::MICRO).font(bold()).color(fg))
        .padding([2, 7])
        .style(move |_| container::Style {
            background: Some(bg.into()),
            border: Border {
                radius: radius::S.into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .into()
}

/// Empty state with a purpose and real actions; never filler content.
pub fn empty<'a>(
    m: Materials,
    glyph: Icon,
    title: &str,
    body: &str,
    actions: Vec<Element<'a, Msg>>,
) -> Element<'a, Msg> {
    let mut content = column![
        container(icon(glyph, 26.0, m.accent))
            .width(56)
            .height(56)
            .center(56)
            .style(move |_| container::Style {
                background: Some(alpha(m.accent, 0.12).into()),
                border: Border {
                    radius: radius::L.into(),
                    ..Default::default()
                },
                ..Default::default()
            }),
        text(title.to_owned()).size(size::HEADING).font(bold()),
        text(body.to_owned())
            .size(size::SMALL)
            .color(m.muted)
            .align_x(iced::Center),
    ]
    .spacing(10)
    .align_x(iced::Center)
    .max_width(420);
    if !actions.is_empty() {
        content = content.push(
            iced::widget::Row::with_children(actions)
                .spacing(8)
                .padding(iced::Padding::new(0.0).top(6.0)),
        );
    }
    container(content).center(Fill).into()
}
