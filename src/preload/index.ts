import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopAPI,
  NetworkEvent,
  PttEvent,
  Reply,
} from "../shared/types";
async function invoke<T>(method: string, arg?: unknown): Promise<T> {
  const r = (await ipcRenderer.invoke("voxy:" + method, arg)) as Reply<T>;
  if (!r.ok) throw Error(r.error);
  return r.value;
}
const api: DesktopAPI = {
  inbox: () => invoke("inbox"),
  markDirectRead: (scope, peer, sequence) =>
    invoke("markDirectRead", { scope, peer, sequence }),
  directImage: (id, scope) => invoke("directImage", { id, scope }),
  remoteUpdateState: () => invoke("remoteUpdateState"),
  checkRemoteUpdate: () => invoke("checkRemoteUpdate"),
  downloadRemoteUpdate: () => invoke("downloadRemoteUpdate"),
  installRemoteUpdate: () => invoke("installRemoteUpdate"),
  releaseHistory: () => invoke("releaseHistory"),
  savedRooms: () => invoke("savedRooms"),
  roomAvailability: () => invoke("roomAvailability"),
  reconnectRoom: (id) => invoke("reconnectRoom", id),
  removeRoom: (id) => invoke("removeRoom", id),
  visitServer: (id) => invoke("visitServer", id),
  authorizeCamera: () => invoke("authorizeCamera"),
  releaseNotes: () => invoke("releaseNotes"),
  markReleaseNotes: (version) => invoke("markReleaseNotes", version),
  updateInfo: () => invoke("updateInfo"),
  chooseUpdate: () => invoke("chooseUpdate"),
  installUpdate: (id) => invoke("installUpdate", id),
  profile: () => invoke("profile"),
  saveProfile: (p) => invoke("saveProfile", p),
  setVolume: (id, value, stream) => invoke("setVolume", { id, value, stream }),
  setParticipantMuted: (id, muted) =>
    invoke("setParticipantMuted", { id, muted }),
  image: (id) => invoke("image", id),
  addresses: () => invoke("addresses"),
  host: (p) => invoke("host", p),
  connect: (invite) => invoke("connect", invite),
  disconnect: () => invoke("disconnect"),
  command: (c) => invoke("command", c),
  signal: (s) => invoke("signal", s),
  sources: () => invoke("sources"),
  selectSource: (id, audio) => invoke("selectSource", { id, audio }),
  copy: (text) => invoke("copy", text),
  onEvent: (fn) => {
    const handler = (_event: unknown, e: NetworkEvent | PttEvent) => fn(e);
    ipcRenderer.on("voxy:event", handler);
    return () => ipcRenderer.removeListener("voxy:event", handler);
  },
};
contextBridge.exposeInMainWorld("voxy", api);
