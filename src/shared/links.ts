export function externalUrl(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    raw.length > 4096 ||
    /[\u0000-\u0020\u007f]/.test(raw)
  )
    throw Error("Link inválido.");
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw Error("Somente links HTTP e HTTPS sem credenciais são permitidos.");
  return url.href;
}
export function messageParts(text: string): { text: string; href?: string }[] {
  const result: { text: string; href?: string }[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    let token = match[0].replace(/[.,!?;:]+$/, "");
    while (
      token.endsWith(")") &&
      (token.match(/\)/g)?.length ?? 0) > (token.match(/\(/g)?.length ?? 0)
    )
      token = token.slice(0, -1);
    const index = match.index!;
    if (index > offset) result.push({ text: text.slice(offset, index) });
    try {
      result.push({ text: token, href: externalUrl(token) });
    } catch {
      result.push({ text: token });
    }
    offset = index + token.length;
  }
  if (offset < text.length) result.push({ text: text.slice(offset) });
  return result;
}
