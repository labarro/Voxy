import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, statSync } from "node:fs";
import type { NsisUpdater } from "electron-updater";
import type { UpdateInfo } from "builder-util-runtime";
import type { RemoteUpdateState, ReleasePost } from "../shared/types";
import {
  verifyReleaseEnvelope,
  hash512,
  releaseBase,
  type TrustConfig,
  type SignedRelease,
} from "./updateTrust";
import { fetchUpdateText } from "./updateTransport";
import { newerVersion } from "./updates";
type Updater = Pick<
  NsisUpdater,
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "allowDowngrade"
  | "allowPrerelease"
  | "disableDifferentialDownload"
  | "previousBlockmapBaseUrlOverride"
  | "verifyUpdateCodeSignature"
  | "logger"
  | "on"
  | "removeAllListeners"
  | "checkForUpdates"
  | "downloadUpdate"
  | "quitAndInstall"
>;
export type RemoteUpdateOptions = {
  version: string;
  packaged: boolean;
  trust: TrustConfig;
  cachePath: string;
  factory: (url: string) => Updater;
  changed: (state: RemoteUpdateState) => void;
  beforeInstall: () => Promise<void>;
  fetchText?: (url: string) => Promise<string>;
  log?: (event: string) => void;
};
export class RemoteUpdates {
  private state: RemoteUpdateState = { phase: "idle" };
  private candidate?: SignedRelease;
  private cached?: SignedRelease;
  private updater?: Updater;
  private downloaded?: string;
  private running = false;
  private installing = false;
  private authorized = false;
  constructor(private options: RemoteUpdateOptions) {
    try {
      this.cached = verifyReleaseEnvelope(
        readFileSync(options.cachePath, "utf8"),
        options.trust,
      );
    } catch {}
    if (!options.packaged)
      this.state = {
        phase: "disabled",
        message: "Atualizações remotas funcionam no Voxy instalado.",
      };
    else if (!options.trust.publicKeys.length)
      this.state = {
        phase: "disabled",
        message:
          "A chave pública de atualizações ainda não foi configurada no build.",
      };
  }
  status() {
    return { ...this.state };
  }
  history(): ReleasePost[] {
    return this.cached?.releases ?? [];
  }
  private publish(state: RemoteUpdateState) {
    this.state = state;
    this.options.changed(this.status());
    this.options.log?.("updater." + state.phase);
  }
  private fetch(url: string) {
    return (
      this.options.fetchText?.(url) ?? fetchUpdateText(url, this.options.trust)
    );
  }
  private fail(error: unknown) {
    this.publish({
      phase: "error",
      version: this.authorized ? this.candidate?.version : undefined,
      message:
        error instanceof Error
          ? error.message
          : "Falha na atualização. Tente novamente.",
    });
  }
  async check(autoDownload = true) {
    if (
      this.state.phase === "disabled" ||
      this.running ||
      this.installing ||
      this.state.phase === "ready"
    )
      return;
    this.running = true;
    this.authorized = false;
    this.publish({ phase: "checking" });
    try {
      let envelope: string;
      try {
        envelope = await this.fetch(
          new URL("voxy-release.json", this.options.trust.endpoint).href,
        );
      } catch {
        envelope = await this.fetch(
          `https://github.com/${this.options.trust.repository}/releases/latest/download/voxy-release.json`,
        );
      }
      const release = verifyReleaseEnvelope(envelope, this.options.trust);
      if (this.cached && newerVersion(this.cached.version, release.version))
        throw Error(
          "O endpoint retornou uma versão antiga. A atualização foi bloqueada.",
        );
      if (
        !this.cached ||
        newerVersion(release.version, this.cached.version) ||
        release.version === this.cached.version
      ) {
        writeFileSync(this.options.cachePath + ".tmp", envelope);
        renameSync(this.options.cachePath + ".tmp", this.options.cachePath);
        this.cached = release;
      }
      if (!newerVersion(release.version, this.options.version)) {
        this.publish({ phase: "up-to-date" });
        return;
      }
      this.candidate = release;
      const base = releaseBase(this.options.trust, release.version),
        manifest = await this.fetch(base + "latest.yml");
      if (
        createHash("sha512").update(manifest).digest("base64") !==
        release.manifestSha512
      )
        throw Error("A assinatura não corresponde aos metadados do download.");
      this.updater?.removeAllListeners();
      const updater = this.options.factory(base);
      this.updater = updater;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      updater.allowPrerelease = false;
      updater.disableDifferentialDownload = false;
      updater.previousBlockmapBaseUrlOverride = releaseBase(
        this.options.trust,
        this.options.version,
      );
      updater.logger = {
        info: () => {},
        warn: () => this.options.log?.("updater.transport-warning"),
        error: () => this.options.log?.("updater.transport-error"),
        debug: () => {},
      };
      const authenticode = updater.verifyUpdateCodeSignature;
      updater.verifyUpdateCodeSignature = async (_names, path) => {
        try {
          await this.verifyFile(path);
          return this.options.trust.authenticodePublisher
            ? await authenticode(
                [this.options.trust.authenticodePublisher],
                path,
              )
            : null;
        } catch {
          return "Pacote não corresponde à publicação assinada do Voxy.";
        }
      };
      updater.on("error", () => {
        this.options.log?.("updater.native-error");
        if (this.installing) {
          this.installing = false;
          this.fail(
            Error(
              "O Windows não conseguiu iniciar o instalador. Sua instalação atual foi preservada.",
            ),
          );
        }
      });
      updater.on("download-progress", (progress) =>
        this.publish({
          phase: "downloading",
          version: release.version,
          percent: Math.max(0, Math.min(100, progress.percent)),
          bytesPerSecond: progress.bytesPerSecond,
        }),
      );
      const result = await updater.checkForUpdates();
      if (!result) throw Error("O provedor não confirmou a atualização.");
      this.verifyInfo(result.updateInfo, base);
      this.authorized = true;
      this.publish({ phase: "available", version: release.version });
    } catch (e) {
      this.fail(e);
    } finally {
      this.running = false;
    }
    if (autoDownload && this.state.phase === "available") await this.download();
  }
  private verifyInfo(info: UpdateInfo, base: string) {
    const release = this.candidate!,
      file = release.files.find((f) => f.name.endsWith(".exe"))!;
    if (
      info.version !== release.version ||
      (info as UpdateInfo & { packages?: unknown }).packages ||
      info.files.length !== 1 ||
      info.files[0].sha512 !== file.sha512 ||
      info.files[0].size !== file.size ||
      ![file.name, base + file.name].includes(info.files[0].url)
    )
      throw Error(
        "O download informado não corresponde ao manifesto assinado.",
      );
  }
  private async verifyFile(path: string) {
    const expected = this.candidate?.files.find((f) => f.name.endsWith(".exe"));
    if (
      !expected ||
      statSync(path).size !== expected.size ||
      (await hash512(path)) !== expected.sha512
    )
      throw Error(
        "O instalador falhou na verificação criptográfica. Baixe novamente.",
      );
  }
  async download() {
    if (this.running || this.installing) return;
    if (!this.updater || !this.candidate || !this.authorized)
      throw Error("Verifique uma publicação assinada antes de baixar.");
    this.running = true;
    this.publish({
      phase: "downloading",
      version: this.candidate.version,
      percent: 0,
    });
    try {
      const paths = await this.updater.downloadUpdate();
      if (paths.length !== 1) throw Error("Pacote de instalação inesperado.");
      await this.verifyFile(paths[0]);
      this.downloaded = paths[0];
      this.publish({
        phase: "ready",
        version: this.candidate.version,
        percent: 100,
      });
    } catch (e) {
      this.downloaded = undefined;
      this.fail(e);
    } finally {
      this.running = false;
    }
  }
  async install() {
    if (this.installing || this.running) return;
    if (this.state.phase !== "ready" || !this.downloaded || !this.updater)
      throw Error("Aguarde uma atualização verificada antes de reiniciar.");
    this.installing = true;
    try {
      await this.verifyFile(this.downloaded);
      // Hash is checked again before any data is closed or installer is run.
      await this.options.beforeInstall();
      this.publish({ phase: "installing", version: this.candidate?.version });
      this.updater.quitAndInstall(true, true);
    } catch (e) {
      this.installing = false;
      this.fail(e);
      throw e;
    }
  }
}
