import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  desktopCapturer,
  safeStorage,
  clipboard,
  dialog,
} from "electron";
import { spawn } from "node:child_process";
import { UpdateManager } from "./updates";
import { ReleaseNotesStore } from "./releaseNotes";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { z } from "zod";
import { Store } from "../database/store";
import { RoomHost } from "../services/signaling/host";
import {
  profileSchema,
  commandSchema,
  signalSchema,
  parseInvite,
  privateIPv4,
} from "../shared/validation";
import type { Profile, NetworkEvent, PttEvent, Reply } from "../shared/types";
import { PushToTalk } from "./pushToTalk";
import { configureLog, log } from "./log";
import { roomAddresses } from "./addresses";
let win: BrowserWindow,
  store: Store,
  host: RoomHost | undefined,
  client: Socket | undefined,
  profile: Profile;
let selected: { id: string; audio: boolean; expires: number } | undefined;
let inVoice = false;
const ptt = new PushToTalk((pressed, error) =>
  emit({ type: "ptt", pressed, error }),
);
function updatePtt() {
  ptt.configure(inVoice && !!profile.pttEnabled, profile.pttKey ?? "KeyV");
}
const dev = process.env.VOXY_DEV === "1";
const origin = dev ? "http://127.0.0.1:5173" : "file://";
const trusted = (url: string) =>
  dev
    ? url.startsWith(origin + "/")
    : url ===
      new URL(
        "../renderer/index.html",
        `file://${__dirname.replaceAll("\\", "/")}/`,
      ).href;
function emit(e: NetworkEvent | PttEvent) {
  if (e.type === "connection") log("connection", { status: e.status });
  if (win && !win.isDestroyed()) win.webContents.send("voxy:event", e);
}
function addresses() {
  return roomAddresses(networkInterfaces());
}
function data(name: string) {
  return join(app.getPath("userData"), name);
}
function saveProfile() {
  writeFileSync(data("profile.json.tmp"), JSON.stringify(profile));
  renameSync(data("profile.json.tmp"), data("profile.json"));
}
async function disconnect() {
  inVoice = false;
  ptt.stop();
  selected = undefined;
  client?.disconnect();
  client = undefined;
  await host?.close();
  host = undefined;
  emit({ type: "connection", status: "disconnected" });
}
async function connect(invite: string, ownerKey?: string) {
  const v = parseInvite(invite);
  client?.disconnect();
  const socket = io(`http://${v.address}:${v.port}`, {
    transports: ["websocket"],
    auth: {
      token: v.token,
      profile: {
        id: profile.id,
        name: profile.name,
        avatar: profile.avatar,
      },
      ownerKey,
    },
    timeout: 8000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1500,
  });
  client = socket;
  socket.on("state", (state) => {
    inVoice = !!state.participants.find(
      (p: { id: string; channelId: string | null }) => p.id === socket.id,
    )?.channelId;
    updatePtt();
    emit({ type: "state", state });
  });
  socket.on("signal", (signal) => emit({ type: "signal", signal }));
  socket.on("connect", () =>
    emit({ type: "connection", status: "connected", selfId: socket.id }),
  );
  socket.on("disconnect", () => {
    inVoice = false;
    ptt.stop();
    emit({ type: "connection", status: "disconnected" });
  });
  socket.io.on("reconnect_attempt", () =>
    emit({ type: "connection", status: "reconnecting" }),
  );
  socket.on("connect_error", () =>
    emit({ type: "connection", status: "error" }),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (e) =>
      reject(
        Error(
          `Não foi possível conectar: ${e.message}. Confira Radmin VPN, convite e firewall.`,
        ),
      ),
    );
  });
}
async function send(event: string, value: unknown) {
  if (!client?.connected) throw Error("Conecte-se a uma sala.");
  const r = (await client.timeout(8000).emitWithAck(event, value)) as Reply;
  if (!r.ok) throw Error(r.error);
}
function handle(name: string, fn: (arg: any) => unknown) {
  ipcMain.handle("voxy:" + name, async (event, arg) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      !trusted(event.senderFrame?.url ?? "")
    )
      return { ok: false, error: "Origem não autorizada." };
    try {
      return { ok: true, value: await fn(arg) };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof z.ZodError ? "Dados inválidos." : (e as Error).message,
      };
    }
  });
}
app.whenReady().then(async () => {
  if (process.env.VOXY_DATA_DIR)
    app.setPath("userData", process.env.VOXY_DATA_DIR);
  mkdirSync(app.getPath("userData"), { recursive: true });
  configureLog(data("diagnostics.log"));
  log("app.start", { version: app.getVersion() });
  try {
    profile = profileSchema.parse(
      JSON.parse(readFileSync(data("profile.json"), "utf8")),
    );
  } catch {
    profile = profileSchema.parse({
      id: randomUUID(),
      name: "Amigo",
      avatar: "🪻",
      input: "",
      output: "",
    });
    saveProfile();
  }
  store = await Store.open(data("room.sqlite"));
  const updates = new UpdateManager(app.getPath("userData"), app.getVersion());
  const releaseNotes = new ReleaseNotesStore(
    data("release-notes.json"),
    app.getVersion(),
  );
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#232b3b",
    title: "Voxy",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Voice detection timers must keep running while minimized or in a game.
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!trusted(url)) e.preventDefault();
  });
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
  session.defaultSession.setPermissionRequestHandler(
    (wc, permission, cb, details) =>
      cb(
        wc === win.webContents &&
          trusted(details.requestingUrl) &&
          (permission === "speaker-selection" ||
            permission === "fullscreen" ||
            (permission === "media" &&
              "mediaTypes" in details &&
              !(details.mediaTypes ?? []).includes("video"))),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, _origin, details) =>
      wc === win.webContents &&
      details.isMainFrame &&
      trusted(details.requestingUrl ?? "") &&
      (permission === "media" ||
        permission === "display-capture" ||
        permission === "speaker-selection" ||
        permission === "fullscreen"),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const pick = selected;
      selected = undefined;
      if (
        request.frame !== win.webContents.mainFrame ||
        !trusted(request.frame?.url ?? "") ||
        !pick ||
        Date.now() > pick.expires
      ) {
        callback({});
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
        });
        const source = sources.find((x) => x.id === pick.id);
        if (!source) {
          callback({});
          return;
        }
        callback({
          video: source,
          ...(pick.audio && process.platform === "win32"
            ? { audio: "loopback" as const }
            : {}),
        });
      } catch {
        callback({});
      }
    },
  );
  handle("profile", () => profile);
  handle("releaseNotes", () => releaseNotes.notes());
  handle("markReleaseNotes", (raw) =>
    releaseNotes.mark(z.string().max(40).parse(raw)),
  );
  handle("updateInfo", () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  handle("chooseUpdate", async () => {
    const choice = await dialog.showOpenDialog(win, {
      title: "Selecionar nova versão do Voxy",
      properties: ["openFile"],
      filters: [{ name: "Instalador Voxy", extensions: ["exe"] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    return updates.prepare(choice.filePaths[0]);
  });
  handle("installUpdate", async (raw) => {
    if (!app.isPackaged)
      throw Error(
        "A instalação de atualização funciona na versão instalada do Voxy.",
      );
    const file = await updates.installer(z.uuid().parse(raw));
    store.flush();
    updates.backup();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, ["/S", "--updated", "--force-run"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    log("update.install");
    app.quit();
  });
  handle("saveProfile", async (raw) => {
    const p = profileSchema.parse(raw);
    profile = {
      ...p,
      id: profile.id,
      volumes: profile.volumes,
      streamVolumes: profile.streamVolumes,
      mutedParticipants: profile.mutedParticipants,
    };
    saveProfile();
    updatePtt();
    if (client?.connected)
      await send("command", {
        type: "profile",
        name: profile.name,
        avatar: profile.avatar,
      });
    return profile;
  });
  handle("setVolume", (raw) => {
    const v = z
      .object({
        id: z.uuid(),
        value: z.number().min(0).max(1),
        stream: z.boolean(),
      })
      .parse(raw);
    const key = v.stream ? "streamVolumes" : "volumes";
    profile[key] = { ...profile[key], [v.id]: v.value };
    saveProfile();
  });
  handle("setParticipantMuted", (raw) => {
    const v = z.object({ id: z.uuid(), muted: z.boolean() }).parse(raw);
    profile.mutedParticipants = {
      ...profile.mutedParticipants,
      [v.id]: v.muted,
    };
    saveProfile();
  });
  handle("image", async (raw) => {
    const id = z.uuid().parse(raw);
    if (!client?.connected)
      throw Error("Conecte-se à sala para carregar a imagem.");
    const reply = (await client
      .timeout(10000)
      .emitWithAck("image", id)) as Reply<string>;
    if (!reply.ok) throw Error(reply.error);
    return reply.value;
  });
  handle("addresses", addresses);
  handle("host", async (raw) => {
    const options = z
      .object({
        address: z.string().refine((a) => addresses().includes(a)),
        port: z.number().int().min(1024).max(65535),
        name: z.string().trim().min(1).max(60),
      })
      .parse(raw);
    await disconnect();
    if (!safeStorage.isEncryptionAvailable())
      throw Error("A proteção de segredos do Windows não está disponível.");
    let token: string;
    try {
      token = safeStorage.decryptString(readFileSync(data("host-secret.bin")));
      if (!/^[a-f0-9]{64}$/.test(token)) throw Error();
    } catch {
      token = randomBytes(32).toString("hex");
      writeFileSync(data("host-secret.bin"), safeStorage.encryptString(token));
    }
    if (!store.snapshot().servers.length) store.createServer(options.name);
    const ownerKey = randomBytes(32).toString("hex");
    host = new RoomHost(store, token, ownerKey);
    const port = await host.listen(options.address, options.port);
    const invite = `voxy://${options.address}:${port}/${token}`;
    await connect(invite, ownerKey);
    return { invite, address: options.address, port };
  });
  handle("connect", async (raw) => {
    const invite = z.string().max(400).parse(raw);
    parseInvite(invite);
    await disconnect();
    await connect(invite);
  });
  handle("disconnect", disconnect);
  handle("command", (raw) => send("command", commandSchema.parse(raw)));
  handle("signal", (raw) => send("signal", signalSchema.parse(raw)));
  handle("sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });
  handle("selectSource", async (raw) => {
    const v = z
      .object({ id: z.string().max(200), audio: z.boolean() })
      .parse(raw);
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
    });
    if (!sources.some((s) => s.id === v.id))
      throw Error("Fonte não está mais disponível.");
    selected = { ...v, expires: Date.now() + 30000 };
  });
  handle("copy", (raw) => clipboard.writeText(z.string().max(4000).parse(raw)));
  if (dev) await win.loadURL(origin);
  else await win.loadFile(join(__dirname, "../renderer/index.html"));
  win.on("closed", () => {
    void disconnect();
  });
});
app.on("window-all-closed", () => app.quit());
let closing = false;
app.on("before-quit", (e) => {
  if (closing) return;
  e.preventDefault();
  closing = true;
  void disconnect().finally(() => {
    store?.close();
    app.quit();
  });
});
