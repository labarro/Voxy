//! Server management: overview, channels, roles, invites and the danger zone.
use super::*;
use crate::{
    design::{Tone, radius, size},
    icons::Icon,
    ui,
};
use iced::widget::{Space, column, toggler};

fn section<'a>(
    m: Materials,
    title: &'a str,
    subtitle: &'a str,
    trailing: Option<Element<'a, Msg>>,
    body: Element<'a, Msg>,
) -> Element<'a, Msg> {
    let mut head = row![
        column![
            text(title).size(size::STRONG).font(bold()),
            text(subtitle).size(size::CAPTION).color(m.muted)
        ]
        .spacing(2)
        .width(Fill)
    ]
    .align_y(iced::Center);
    if let Some(trailing) = trailing {
        head = head.push(trailing);
    }
    container(column![head, body].spacing(14))
        .padding(18)
        .width(Fill)
        .style(move |_| m.card())
        .into()
}

pub(super) fn view(app: &App) -> Element<'_, Msg> {
    let m = app.palette();
    let overview = section(
        m,
        "Visão geral",
        "O nome aparece para todos os membros.",
        None,
        row![
            text_input("Nome do servidor", &app.server_name)
                .on_input(Msg::ServerName)
                .on_submit(Msg::AdminRename)
                .padding([9, 12])
                .width(Fill)
                .style(m.input()),
            ui::action(
                m,
                Some(Icon::Check),
                "Renomear",
                Some(Msg::AdminRename),
                Tone::Primary
            )
        ]
        .spacing(8)
        .align_y(iced::Center)
        .into(),
    );
    let mut list = column![].spacing(4);
    for channel in &app.channels {
        let glyph = if channel.kind == ChannelKind::Text {
            Icon::Hash
        } else {
            Icon::Volume2
        };
        list = list.push(
            container(
                row![
                    ui::icon(glyph, 17.0, m.muted),
                    text(channel.name.clone()).size(size::BODY).width(Fill),
                    ui::icon_button(
                        m,
                        Icon::Pencil,
                        "Renomear canal",
                        Some(Msg::AdminChannelEdit(channel.id)),
                        Tone::Ghost,
                        30.0
                    ),
                    ui::icon_button(
                        m,
                        Icon::Trash2,
                        "Excluir canal",
                        Some(Msg::AdminRemove(channel.id)),
                        Tone::Ghost,
                        30.0
                    )
                ]
                .spacing(10)
                .align_y(iced::Center),
            )
            .padding([4, 8]),
        );
        if app.editing_channel == Some(channel.id) {
            list = list.push(
                row![
                    text_input("Nome do canal", &app.channel_name)
                        .on_input(Msg::AdminChannelName)
                        .on_submit(Msg::AdminChannelSave)
                        .padding([8, 10])
                        .width(Fill)
                        .style(m.input()),
                    ui::action(
                        m,
                        Some(Icon::Check),
                        "Salvar nome",
                        Some(Msg::AdminChannelSave),
                        Tone::Primary
                    )
                ]
                .spacing(8)
                .padding(iced::Padding::new(0.0).left(34.0)),
            );
        }
    }
    let channels = section(
        m,
        "Canais",
        "Texto para conversar, voz para chamadas.",
        Some(
            row![
                ui::action(
                    m,
                    Some(Icon::Hash),
                    "Adicionar texto",
                    Some(Msg::AdminCreate(ChannelKind::Text)),
                    Tone::Secondary
                ),
                ui::action(
                    m,
                    Some(Icon::Volume2),
                    "Adicionar voz",
                    Some(Msg::AdminCreate(ChannelKind::Voice)),
                    Tone::Secondary
                )
            ]
            .spacing(6)
            .into(),
        ),
        list.into(),
    );
    let mut roles = column![].spacing(6);
    if app.is_remote() {
        let preview = chat::hex(&app.role_color).unwrap_or(m.faint);
        roles = roles.push(
            row![
                text_input("Nome do cargo", &app.role_name)
                    .on_input(Msg::RoleName)
                    .padding([8, 10])
                    .width(Fill)
                    .style(m.input()),
                ui::dot(preview, 14.0),
                text_input("#RRGGBB", &app.role_color)
                    .on_input(Msg::RoleColor)
                    .padding([8, 10])
                    .width(110)
                    .style(m.input()),
                ui::action(
                    m,
                    Some(Icon::Plus),
                    "Salvar cargo",
                    Some(Msg::RoleSave),
                    Tone::Primary
                )
            ]
            .spacing(8)
            .align_y(iced::Center),
        );
        if let Some(snapshot) = &app.remote.snapshot {
            for role in &snapshot.roles {
                let color = chat::hex(&role.color).unwrap_or(m.ink);
                let members = snapshot
                    .member_roles
                    .iter()
                    .filter(|r| r.role == role.id)
                    .count();
                let editing = app.editing_role == Some(role.id);
                roles = roles.push(
                    container(
                        row![
                            ui::dot(color, 12.0),
                            text(role.name.clone())
                                .size(size::BODY)
                                .font(bold())
                                .color(color),
                            text(format!("{members} membro(s)"))
                                .size(size::CAPTION)
                                .color(m.muted)
                                .width(Fill),
                            ui::icon_button(
                                m,
                                Icon::Users,
                                if editing {
                                    "Fechar membros"
                                } else {
                                    "Membros do cargo"
                                },
                                Some(Msg::RoleEdit(role.id)),
                                if editing { Tone::Active } else { Tone::Ghost },
                                30.0
                            ),
                            ui::icon_button(
                                m,
                                Icon::Trash2,
                                "Excluir cargo",
                                Some(Msg::RoleDelete(role.id)),
                                Tone::Ghost,
                                30.0
                            )
                        ]
                        .spacing(10)
                        .align_y(iced::Center),
                    )
                    .padding([4, 8]),
                );
                if editing {
                    for member in &snapshot.members {
                        let assigned = snapshot
                            .member_roles
                            .iter()
                            .any(|r| r.role == role.id && r.member == member.id);
                        roles = roles.push(
                            row![
                                ui::avatar(m, &member.name, 24.0, ui::Ring::default()),
                                text(member.name.clone()).size(size::SMALL).width(Fill),
                                toggler(assigned)
                                    .on_toggle(move |v| Msg::RoleAssign(role.id, member.id, v))
                                    .style(m.toggle())
                            ]
                            .spacing(10)
                            .align_y(iced::Center)
                            .padding(iced::Padding::new(0.0).left(30.0).right(8.0)),
                        );
                    }
                }
            }
        }
    } else {
        roles = roles.push(
            text("Hospede o servidor para gerenciar cargos de membros autenticados.")
                .size(size::CAPTION)
                .color(m.muted),
        );
    }
    let roles = section(
        m,
        "Cargos",
        "Cores e títulos exibidos no chat e na lista de membros.",
        None,
        roles.into(),
    );
    let invites = section(
        m,
        "Convites",
        "Quem recebe o convite entra pelo host. TURN desativado: algumas redes podem não conectar.",
        None,
        row![
            if app.is_remote() {
                ui::action(
                    m,
                    Some(Icon::Copy),
                    "Copiar convite",
                    Some(Msg::CopyInvite),
                    Tone::Primary,
                )
            } else {
                ui::action(
                    m,
                    Some(Icon::Radio),
                    "Hospedar servidor",
                    Some(Msg::HostRemote),
                    Tone::Primary,
                )
            },
            ui::action(
                m,
                Some(Icon::RefreshCw),
                "Revogar e gerar novo",
                app.is_remote().then_some(Msg::RotateInvite),
                Tone::Secondary
            ),
            ui::action(
                m,
                Some(Icon::Shield),
                "Rede e privacidade",
                Some(Msg::Section(Section::Privacy)),
                Tone::Ghost
            ),
        ]
        .spacing(8)
        .into(),
    );
    let danger =
        container(
            row![
                column![
                text("Excluir servidor local").size(size::STRONG).font(bold()).color(m.danger),
                text("Remove canais e mensagens deste servidor neste computador. Desconecte antes.")
                    .size(size::CAPTION)
                    .color(m.muted)
            ]
                .spacing(2)
                .width(Fill),
                ui::action(
                    m,
                    Some(Icon::Trash2),
                    "Excluir servidor local",
                    Some(Msg::AdminDelete),
                    Tone::Danger
                )
            ]
            .spacing(12)
            .align_y(iced::Center),
        )
        .padding(18)
        .style(move |_| container::Style {
            background: Some(alpha(m.danger, 0.06).into()),
            border: Border {
                radius: radius::L.into(),
                width: 1.0,
                color: alpha(m.danger, 0.35),
            },
            ..Default::default()
        });
    scrollable(
        container(
            column![
                row![
                    text("Gerenciar servidor")
                        .size(size::TITLE)
                        .font(bold())
                        .width(Fill),
                    ui::action(
                        m,
                        Some(Icon::ArrowLeft),
                        "Voltar ao chat",
                        Some(Msg::Navigate(Page::Chat)),
                        Tone::Secondary
                    )
                ]
                .align_y(iced::Center),
                overview,
                channels,
                roles,
                invites,
                danger,
                Space::new().height(8)
            ]
            .spacing(16),
        )
        .padding([24, 28])
        .max_width(880),
    )
    .height(Fill)
    .width(Fill)
    .direction(design::vertical_scrollbar())
    .style(m.scroll())
    .into()
}
