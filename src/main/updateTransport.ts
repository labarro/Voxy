import { get } from "node:https";
import type { TrustConfig } from "./updateTrust";
export function fetchUpdateText(
  url: string,
  trust: TrustConfig,
  redirects = 0,
): Promise<string> {
  const parsed = new URL(url),
    endpoint = new URL(trust.endpoint);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    ![
      endpoint.hostname,
      "github.com",
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(parsed.hostname) ||
    redirects > 5
  )
    return Promise.reject(Error("Endereço de atualização não autorizado."));
  return new Promise((resolve, reject) => {
    const req = get(
      parsed,
      {
        headers: { "User-Agent": "Voxy updater", "Cache-Control": "no-cache" },
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode ?? 0) &&
          res.headers.location
        ) {
          res.resume();
          fetchUpdateText(
            new URL(res.headers.location!, parsed).href,
            trust,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            Error(
              "Endpoint de atualização indisponível (HTTP " +
                res.statusCode +
                ").",
            ),
          );
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            req.destroy(Error("Metadados de atualização grandes demais."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
        res.on("aborted", () =>
          reject(Error("Download de metadados interrompido.")),
        );
      },
    );
    const timer = setTimeout(
      () => req.destroy(Error("Tempo esgotado ao verificar atualização.")),
      15000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
  });
}
