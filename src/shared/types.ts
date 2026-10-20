import type { PttKey } from "./preferences";
export type Profile = {
  id: string;
  name: string;
  avatar: string;
  input: string;
  output: string;
  pttEnabled?: boolean;
  pttKey?: PttKey;
  callSounds?: boolean;
  volumes?: Record<string, number>;
  streamVolumes?: Record<string, number>;
};
export type Community = { id: string; name: string };
export type Channel = {
  id: string;
  serverId: string;
  name: string;
  kind: "text" | "voice";
};
export type Participant = {
  id: string;
  profile: Pick<Profile, "id" | "name" | "avatar">;
  channelId: string | null;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  host: boolean;
};
export type Message = {
  id: string;
  channelId: string;
  author: string;
  name: string;
  avatar: string;
  text: string;
  time: number;
  imageId?: string | null;
};
export type RoomState = {
  servers: Community[];
  channels: Channel[];
  participants: Participant[];
  messages: Message[];
};
export type Signal = {
  from?: string;
  to: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
export type Command =
  | { type: "server.create"; name: string }
  | { type: "server.rename"; id: string; name: string }
  | { type: "server.delete"; id: string }
  | {
      type: "channel.create";
      serverId: string;
      name: string;
      kind: "text" | "voice";
    }
  | { type: "channel.rename"; id: string; name: string }
  | { type: "channel.delete"; id: string }
  | { type: "message"; channelId: string; text: string; image?: string }
  | { type: "voice"; channelId: string | null }
  | { type: "status"; muted: boolean; deafened: boolean; sharing: boolean }
  | { type: "profile"; name: string; avatar: string };
export type Reply<T = unknown> =
  { ok: true; value: T } | { ok: false; error: string };
export type NetworkEvent =
  | { type: "state"; state: RoomState }
  | { type: "signal"; signal: Signal }
  | { type: "connection"; status: string; selfId?: string };
export type PttEvent = { type: "ptt"; pressed: boolean; error?: string };
export type HostInfo = { invite: string; address: string; port: number };
export type Source = { id: string; name: string; thumbnail: string };
export type UpdatePackage = {
  id: string;
  version: string;
  size: number;
  sha256: string;
  verified: boolean;
};
export type ReleaseNotes = { version: string; title: string; items: string[] };
export interface DesktopAPI {
  releaseNotes(): Promise<ReleaseNotes | null>;
  markReleaseNotes(version: string): Promise<void>;
  updateInfo(): Promise<{ version: string; packaged: boolean }>;
  chooseUpdate(): Promise<UpdatePackage | null>;
  installUpdate(id: string): Promise<void>;
  profile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<Profile>;
  setVolume(id: string, value: number, stream: boolean): Promise<void>;
  image(id: string): Promise<string>;
  addresses(): Promise<string[]>;
  host(options: {
    address: string;
    port: number;
    name: string;
  }): Promise<HostInfo>;
  connect(invite: string): Promise<void>;
  disconnect(): Promise<void>;
  command(command: Command): Promise<void>;
  signal(signal: Signal): Promise<void>;
  sources(): Promise<Source[]>;
  selectSource(id: string, audio: boolean): Promise<void>;
  copy(text: string): Promise<void>;
  onEvent(fn: (event: NetworkEvent | PttEvent) => void): () => void;
}
declare global {
  interface Window {
    voxy: DesktopAPI;
  }
}
