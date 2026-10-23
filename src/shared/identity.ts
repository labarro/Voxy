import type { Profile, RoomState } from "./types";
export function memberRoles(
  room: RoomState,
  serverId: string,
  memberId: string,
) {
  const assigned = new Set(
    (room.memberRoles || [])
      .filter((r) => r.serverId === serverId && r.memberId === memberId)
      .map((r) => r.roleId),
  );
  return (room.roles || [])
    .filter((r) => r.serverId === serverId && assigned.has(r.id))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}
export function nicknameColor(
  room: RoomState,
  serverId: string,
  profile: Pick<Profile, "id" | "nicknameColor">,
) {
  return (
    memberRoles(room, serverId, profile.id)[0]?.color ||
    profile.nicknameColor ||
    undefined
  );
}
