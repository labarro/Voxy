import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  desktopCapturer,
  safeStorage,
  clipboard,
  dialog,
  Notification,
  shell,
} from "electron";
import { externalUrl } from "../shared/links";
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
import { randomBytes, randomUUID, createHash } from "node:crypto";
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
  radminIPv4,
} from "../shared/validation";
import type { Profile, NetworkEvent, PttEvent, Reply } from "../shared/types";
import { PushToTalk } from "./pushToTalk";
import { configureLog, log } from "./log";
import { roomAddresses } from "./addresses";
import { RecentRooms, probeRoom } from "./recentRooms";
import releases from "../shared/releases.json";
import type { RoomState } from "../shared/types";
import { NsisUpdater } from "electron-updater";
import { RemoteUpdates } from "./remoteUpdates";
import updateTrust from "../shared/update-trust.json";
import { DirectInbox } from "./directInbox";
import { deviceCredential } from "./deviceIdentity";
let win: BrowserWindow,
  store: Store,
  host: RoomHost | undefined,
  client: Socket | undefined,
  profile: Profile;
let selected: { id: string; audio: boolean; expires: number } | undefined;
let inVoice = false;
let cameraPermissionUntil = 0;
let recentRooms: RecentRooms;
let currentInvite = "";
let currentHosted = false;
let currentState: RoomState | undefined;
let inbox: DirectInbox;
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
function ensurePrivateRoute(address: string) {
  if (radminIPv4(address) && !addresses().some((ip) => ip.startsWith("26.")))
    throw Error(
      "Conecte o Radmin VPN antes de acessar esta sala. Sua conexão atual foi mantida.",
    );
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
  cameraPermissionUntil = 0;
  currentInvite = "";
  currentState = undefined;
  if (inbox) {
    inbox.activeScope = undefined;
    emit({ type: "inbox", inbox: inbox.view() });
  }
  client?.disconnect();
  client = undefined;
  await host?.close();
  host = undefined;
  emit({ type: "connection", status: "disconnected" });
}
async function connect(invite: string, ownerKey?: string) {
  const v = parseInvite(invite);
  ensurePrivateRoute(v.address);
  const identityKey = deviceCredential(
    data("profile-identity.bin"),
    safeStorage,
    profile.id,
    v.token,
  );
  const scope = createHash("sha256")
    .update(profile.id + ":" + v.token)
    .digest("hex");
  client?.disconnect();
  currentInvite = invite;
  currentHosted = !!ownerKey;
  let firstState = true;
  let firstDirect = true;
  let savedStamp = "";
  const socket = io(`http://${v.address}:${v.port}`, {
    transports: ["websocket"],
    auth: {
      protocol: 2,
      token: v.token,
      identityKey,
      profile: {
        id: profile.id,
        name: profile.name,
        avatar: profile.avatar,
        presence: profile.presence ?? "online",
      },
      ownerKey,
    },
    timeout: 8000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 6000,
    randomizationFactor: 0.25,
  });
  client = socket;
  socket.on("state", (state) => {
    if (socket !== client) return;
    if (state.protocol !== 2) {
      socket.disconnect();
      emit({ type: "connection", status: "error" });
      return;
    }
    currentState = state;
    try {
      const stamp = JSON.stringify(state.servers);
      if (firstState || stamp !== savedStamp) {
        recentRooms.remember(
          invite,
          state.servers,
          state.avatars ?? {},
          !!ownerKey,
          firstState,
        );
        savedStamp = stamp;
        firstState = false;
        emit({ type: "saved-rooms" });
      }
    } catch {
      log("recent.save-failed");
    }
    inVoice = !!state.participants.find(
      (p: { id: string; channelId: string | null }) => p.id === socket.id,
    )?.channelId;
    updatePtt();
    emit({ type: "state", state });
  });
  socket.on("signal", (signal) => {
    if (socket === client) emit({ type: "signal", signal });
  });
  socket.on("direct", (raw) => {
    if (socket !== client) return;
    try {
      const received = inbox.receive(
        scope,
        currentState?.servers[0]?.name ?? "Sala privada",
        raw,
      );
      const last = firstDirect ? undefined : received.at(-1);
      firstDirect = false;
      emit({
        type: "inbox",
        inbox: inbox.view(),
        incoming: last
          ? { scope, peer: last.author, name: last.name }
          : undefined,
      });
      if (
        last &&
        !win.isFocused() &&
        profile.presence !== "busy" &&
        Notification.isSupported()
      ) {
        try {
          const notice = new Notification({
            title: "Mensagem privada no Voxy",
            body: `${last.name} enviou uma mensagem privada.`,
          });
          notice.on("click", () => {
            win.show();
            win.focus();
            emit({ type: "open-direct", scope, peer: last.author });
          });
          notice.show();
        } catch {
          log("direct.notification-unavailable");
        }
      }
    } catch {
      log("direct.snapshot-invalid");
      emit({
        type: "inbox-error",
        message:
          "Não foi possível atualizar as conversas privadas. Reconecte à sala e confira se o host está atualizado.",
      });
    }
  });
  socket.on("connect", () => {
    if (socket !== client) return;
    inbox.activeScope = scope;
    emit({ type: "connection", status: "connected", selfId: socket.id });
    emit({ type: "inbox", inbox: inbox.view() });
  });
  socket.on("disconnect", () => {
    if (socket !== client) return;
    inVoice = false;
    ptt.stop();
    inbox.activeScope = undefined;
    emit({ type: "inbox", inbox: inbox.view() });
    emit({
      type: "connection",
      status: socket.active ? "reconnecting" : "disconnected",
    });
  });
  socket.io.on("reconnect_attempt", (attempt) => {
    if (socket === client)
      emit({
        type: "connection",
        status: "reconnecting",
        attempt,
        maxAttempts: 5,
      });
  });
  socket.io.on("reconnect_failed", () => {
    if (socket === client) {
      socket.disconnect();
      emit({
        type: "connection",
        status: "error",
        message:
          "Reconexão encerrada após 5 tentativas. Confira o Radmin e use Reconectar na lista de servidores.",
      });
    }
  });
  socket.on("connect_error", () => {
    if (socket === client)
      emit({
        type: "connection",
        status: socket.active ? "reconnecting" : "error",
        message: socket.active
          ? undefined
          : "A conexão foi recusada. Confira o convite e atualize o aplicativo.",
      });
  });
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect_error", failed);
      socket.off("state", ready);
    };
    const failed = (e: Error) => {
      cleanup();
      socket.disconnect();
      reject(
        Error(
          `Não foi possível conectar: ${e.message}. Confira Radmin VPN, convite e firewall.`,
        ),
      );
    };
    const ready = (state: RoomState) => {
      cleanup();
      if (state.protocol === 2) resolve();
      else {
        socket.disconnect();
        reject(
          Error(
            "Host incompatível. Atualize todos os participantes para Voxy 0.4.0 ou posterior.",
          ),
        );
      }
    };
    const timer = setTimeout(
      () => failed(Error("O host não confirmou a versão da sala")),
      10000,
    );
    socket.once("state", ready);
    socket.once("connect_error", failed);
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
  recentRooms = new RecentRooms(data("recent-rooms.json"), safeStorage);
  inbox = new DirectInbox(data("direct-inbox.json"), profile.id);
  const updates = new UpdateManager(app.getPath("userData"), app.getVersion());
  let notifiedVersion = "";
  const remoteUpdates = new RemoteUpdates({
    version: app.getVersion(),
    packaged: app.isPackaged,
    trust: updateTrust,
    cachePath: data("remote-release-history.json"),
    factory: (url) => new NsisUpdater({ provider: "generic", url }),
    changed: (state) => {
      emit({ type: "remote-update", state });
      if (state.phase === "available" && state.version !== notifiedVersion) {
        notifiedVersion = state.version!;
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: "Nova versão do Voxy",
            body: `Voxy ${state.version} disponível. O download será preparado em segundo plano.`,
          });
          notification.on("click", () => {
            win.show();
            win.focus();
          });
          notification.show();
        }
      }
    },
    beforeInstall: async () => {
      store.flush();
      updates.backup();
      await disconnect();
    },
    log: (event) => log(event),
  });
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
              (!(details.mediaTypes ?? []).includes("video") ||
                (inVoice && Date.now() < cameraPermissionUntil)))),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, _origin, details) =>
      wc === win.webContents &&
      details.isMainFrame &&
      trusted(details.requestingUrl ?? "") &&
      ((permission === "media" &&
        (details.mediaType !== "video" ||
          (inVoice && Date.now() < cameraPermissionUntil))) ||
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
  handle("inbox", () => inbox.view());
  handle("markDirectRead", (raw) => {
    const value = z
      .object({
        scope: z.string().regex(/^[a-f0-9]{64}$/),
        peer: z.uuid(),
        sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .parse(raw);
    inbox.markRead(value.scope, value.peer, value.sequence);
    emit({ type: "inbox", inbox: inbox.view() });
  });
  handle("directImage", async (raw) => {
    const { id, scope } = z
      .object({ id: z.uuid(), scope: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(raw);
    if (!client?.connected || scope !== inbox.activeScope)
      throw Error(
        "Reconecte à sala desta conversa para carregar a imagem privada.",
      );
    const reply = (await client
      .timeout(10000)
      .emitWithAck("direct-image", id)) as Reply<string>;
    if (!reply.ok) throw Error(reply.error);
    return reply.value;
  });
  handle("authorizeCamera", () => {
    if (!inVoice || !client?.connected)
      throw Error("Entre em um canal de voz antes de ligar a câmera.");
    cameraPermissionUntil = Date.now() + 30000;
  });
  handle("releaseHistory", () => {
    const posts = new Map(
      Object.entries(releases).map(([version, entry]) => [
        version,
        { version, ...entry },
      ]),
    );
    for (const entry of remoteUpdates.history())
      posts.set(entry.version, entry);
    return [...posts.values()].sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
  });
  handle("remoteUpdateState", () => remoteUpdates.status());
  handle("checkRemoteUpdate", () => remoteUpdates.check());
  handle("downloadRemoteUpdate", () => remoteUpdates.download());
  handle("installRemoteUpdate", () => remoteUpdates.install());
  handle("savedRooms", () => recentRooms.list());
  handle("roomAvailability", () =>
    recentRooms.availability(
      (address) =>
        !address.startsWith("26.") ||
        addresses().some((ip) => ip.startsWith("26.")),
    ),
  );
  handle("removeRoom", (raw) => {
    recentRooms.remove(z.uuid().parse(raw));
    emit({ type: "saved-rooms" });
  });
  handle("visitServer", (raw) => {
    const id = z.string().max(100).parse(raw),
      server = currentState?.servers.find((s) => s.id === id);
    if (server && currentInvite)
      recentRooms.remember(
        currentInvite,
        [server],
        currentState?.avatars ?? {},
        currentHosted,
        true,
      );
    emit({ type: "saved-rooms" });
  });
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
    if (client)
      client.auth = {
        ...client.auth,
        profile: {
          id: profile.id,
          name: profile.name,
          avatar: profile.avatar,
          presence: profile.presence ?? "online",
        },
      };
    updatePtt();
    if (client?.connected)
      await send("command", {
        type: "profile",
        name: profile.name,
        avatar: profile.avatar,
        presence: profile.presence ?? "online",
      });
    return profile;
  });
  handle("setVolume", (raw) => {
    const v = z
      .object({
        id: z.uuid(),
        value: z.number().min(0).max(2),
        stream: z.boolean(),
      })
      .parse(raw);
    const key = v.stream ? "streamVolumes" : "volumes";
    if (v.stream && v.value > 1)
      throw Error("O volume da transmissão deve ser de 0 a 100%.");
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
  const startHost = async (raw: unknown) => {
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
    if (!store.snapshot().servers.length)
      store.createServer(options.name, profile.id);
    const ownerKey = randomBytes(32).toString("hex");
    host = new RoomHost(store, token, ownerKey);
    const port = await host.listen(options.address, options.port);
    const invite = `voxy://${options.address}:${port}/${token}`;
    await connect(invite, ownerKey);
    return { invite, address: options.address, port };
  };
  handle("host", startHost);
  handle("reconnectRoom", async (raw) => {
    const saved = recentRooms.get(z.uuid().parse(raw));
    if (currentInvite !== saved.invite || !client?.connected) {
      if (!saved.hosted) {
        const invite = parseInvite(saved.invite);
        ensurePrivateRoute(invite.address);
        const available = await probeRoom(
          invite.address,
          invite.port,
          invite.token,
          saved.serverId,
        );
        if (available !== "available")
          throw Error(
            available === "full"
              ? "Essa sala está cheia. Sua conexão atual foi mantida."
              : available === "invalid"
                ? "O convite salvo não é mais válido. Peça um novo convite."
                : available === "missing"
                  ? "Esse servidor foi removido. Sua conexão atual foi mantida."
                  : "A sala está fora de alcance. Confira o host, o Radmin e o firewall. Sua conexão atual foi mantida.",
          );
      }
      if (saved.hosted)
        await startHost({
          address: saved.address,
          port: saved.port,
          name: saved.name,
        });
      else {
        await disconnect();
        await connect(saved.invite);
      }
    }
    if (!currentState?.servers.some((s) => s.id === saved.serverId))
      throw Error(
        "Este servidor foi removido pelo host. Remova o acesso salvo da Home.",
      );
    const v = parseInvite(currentInvite);
    return {
      serverId: saved.serverId,
      hostInfo: currentHosted
        ? { invite: currentInvite, address: v.address, port: v.port }
        : undefined,
    };
  });
  handle("connect", async (raw) => {
    const invite = z.string().max(400).parse(raw);
    parseInvite(invite);
    await disconnect();
    await connect(invite);
  });
  handle("openExternal", async (raw) => {
    await shell.openExternal(externalUrl(raw));
  });
  handle("disconnect", disconnect);
  handle("command", (raw) => {
    const command = commandSchema.parse(raw);
    if ("scope" in command && command.scope !== inbox.activeScope)
      throw Error("Reconecte à sala desta conversa antes de enviar.");
    return send("command", command);
  });
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
  if (app.isPackaged) {
    const timer = setTimeout(() => void remoteUpdates.check(), 10000);
    timer.unref();
    const periodic = setInterval(
      () => void remoteUpdates.check(),
      6 * 60 * 60 * 1000,
    );
    periodic.unref();
  }
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
