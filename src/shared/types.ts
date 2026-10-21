import type { PttKey } from "./preferences";
export type Presence = "online" | "away" | "busy";
export type Profile = {
  id: string;
  name: string;
  avatar: string;
  presence?: Presence;
  input: string;
  output: string;
  cameraDevice?: string;
  pttEnabled?: boolean;
  pttKey?: PttKey;
  inputVolume?: number;
  voiceDetection?: boolean;
  voiceThreshold?: number;
  callSounds?: boolean;
  volumes?: Record<string, number>;
  streamVolumes?: Record<string, number>;
  mutedParticipants?: Record<string, boolean>;
};
export type Community = {
  id: string;
  name: string;
  ownerId?: string | null;
  icon?: string | null;
};
export type Channel = {
  id: string;
  serverId: string;
  name: string;
  kind: "text" | "voice";
};
export type Participant = {
  id: string;
  profile: Pick<Profile, "id" | "name" | "avatar" | "presence">;
  channelId: string | null;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  camera?: boolean;
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
  editedAt?: number | null;
};
export type RoomState = {
  features?: { directMessages: boolean; presence: boolean };
  protocol?: number;
  avatars?: Record<string, string>;
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
  | {
      type: "direct.message";
      scope: string;
      recipient: string;
      text: string;
      image?: string;
    }
  | { type: "direct.edit"; scope: string; id: string; text: string }
  | { type: "direct.delete"; scope: string; id: string }
  | { type: "server.create"; name: string }
  | { type: "server.rename"; id: string; name: string }
  | { type: "server.delete"; id: string }
  | { type: "server.icon"; id: string; image: string | null }
  | {
      type: "channel.create";
      serverId: string;
      name: string;
      kind: "text" | "voice";
    }
  | { type: "channel.rename"; id: string; name: string }
  | { type: "channel.delete"; id: string }
  | { type: "message"; channelId: string; text: string; image?: string }
  | { type: "message.edit"; id: string; text: string }
  | { type: "message.delete"; id: string }
  | { type: "voice"; channelId: string | null }
  | {
      type: "status";
      muted: boolean;
      deafened: boolean;
      sharing: boolean;
      camera?: boolean;
    }
  | { type: "profile"; name: string; avatar: string; presence?: Presence };
export type DirectMessage = Omit<Message, "channelId"> & {
  recipient: string;
  sequence: number;
};
export type DirectContact = {
  id: string;
  name: string;
  avatar: string;
  directEnabled: boolean;
};
export type DirectSnapshot = {
  contacts: DirectContact[];
  messages: DirectMessage[];
  avatars: Record<string, string>;
};
export type DirectRoom = {
  scope: string;
  name: string;
  contacts: DirectContact[];
  messages: DirectMessage[];
  read: Record<string, number>;
};
export type Inbox = { rooms: DirectRoom[]; activeScope?: string };
export type Reply<T = unknown> =
  { ok: true; value: T } | { ok: false; error: string };
export type NetworkEvent =
  | { type: "inbox-error"; message: string }
  | { type: "open-direct"; scope: string; peer: string }
  | {
      type: "inbox";
      inbox: Inbox;
      incoming?: { scope: string; peer: string; name: string };
    }
  | { type: "saved-rooms" }
  | { type: "remote-update"; state: RemoteUpdateState }
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
export type ReleasePost = ReleaseNotes & {
  date: string;
  features: string[];
  improvements: string[];
  fixes: string[];
};
export type RemoteUpdateState = {
  phase:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error"
    | "up-to-date";
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  message?: string;
};
export type SavedRoom = {
  id: string;
  serverId: string;
  name: string;
  icon: string | null;
  address: string;
  port: number;
  lastAccess: number;
  hosted: boolean;
};
export type RoomAvailability = {
  id: string;
  status: "available" | "unavailable" | "invalid" | "missing" | "full";
};
export interface DesktopAPI {
  inbox(): Promise<Inbox>;
  markDirectRead(scope: string, peer: string, sequence: number): Promise<void>;
  directImage(id: string, scope: string): Promise<string>;
  remoteUpdateState(): Promise<RemoteUpdateState>;
  checkRemoteUpdate(): Promise<void>;
  downloadRemoteUpdate(): Promise<void>;
  installRemoteUpdate(): Promise<void>;
  releaseHistory(): Promise<ReleasePost[]>;
  savedRooms(): Promise<SavedRoom[]>;
  roomAvailability(): Promise<RoomAvailability[]>;
  reconnectRoom(id: string): Promise<{ serverId: string; hostInfo?: HostInfo }>;
  removeRoom(id: string): Promise<void>;
  visitServer(id: string): Promise<void>;
  authorizeCamera(): Promise<void>;
  releaseNotes(): Promise<ReleaseNotes | null>;
  markReleaseNotes(version: string): Promise<void>;
  updateInfo(): Promise<{ version: string; packaged: boolean }>;
  chooseUpdate(): Promise<UpdatePackage | null>;
  installUpdate(id: string): Promise<void>;
  profile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<Profile>;
  setVolume(id: string, value: number, stream: boolean): Promise<void>;
  setParticipantMuted(id: string, muted: boolean): Promise<void>;
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
