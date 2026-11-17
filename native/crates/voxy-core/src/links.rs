//! The OS launcher receives only a parsed HTTP(S) URL, never a command or file path.
use anyhow::{Result, ensure};
pub fn external_url(raw: &str) -> Result<String> {
    ensure!(
        raw.len() <= 4096 && !raw.chars().any(|c| c.is_control() || c.is_whitespace()),
        "Link inválido"
    );
    let url = url::Url::parse(raw)?;
    ensure!(
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none(),
        "Somente HTTP/S sem credenciais"
    );
    Ok(url.into())
}
pub fn message_parts(message: &str) -> Vec<(String, Option<String>)> {
    let lower = message.to_ascii_lowercase();
    let mut result = Vec::new();
    let mut offset = 0;
    while let Some(relative) = lower[offset..].find("http") {
        let start = offset + relative;
        if !(lower[start..].starts_with("http://") || lower[start..].starts_with("https://")) {
            let end = start + 4;
            result.push((message[offset..end].into(), None));
            offset = end;
            continue;
        }
        if start > offset {
            result.push((message[offset..start].into(), None));
        }
        let mut end = message[start..]
            .find(|c: char| c.is_whitespace() || ['<', '>', '\"', '\''].contains(&c))
            .map(|n| start + n)
            .unwrap_or(message.len());
        while end > start && ".,!?;:".contains(message.as_bytes()[end - 1] as char) {
            end -= 1;
        }
        while message[start..end].ends_with(')')
            && message[start..end].matches(')').count() > message[start..end].matches('(').count()
        {
            end -= 1;
        }
        let raw = &message[start..end];
        result.push((raw.into(), external_url(raw).ok()));
        offset = end;
    }
    if offset < message.len() {
        result.push((message[offset..].into(), None));
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_preserve_unicode_punctuation_and_reject_credentials_and_schemes() {
        let text = "Veja 🦀 (https://devbarros.com/), https://example.com/a_(b)?q=1&x=2. fim";
        let parts = message_parts(text);
        assert_eq!(parts.iter().map(|p| p.0.as_str()).collect::<String>(), text);
        assert_eq!(
            parts
                .iter()
                .filter_map(|p| p.1.as_deref())
                .collect::<Vec<_>>(),
            vec![
                "https://devbarros.com/",
                "https://example.com/a_(b)?q=1&x=2"
            ]
        );
        for raw in [
            "javascript:alert(1)",
            "file:///C:/Windows",
            "voxy://host",
            "https://u:p@example.com",
            "https://example.com/\nfile",
            "https://example.com/a\0b",
        ] {
            assert!(external_url(raw).is_err());
        }
        assert_eq!(
            message_parts("http errado https://u:p@example.com")
                .iter()
                .filter(|p| p.1.is_some())
                .count(),
            0
        );
    }
}
