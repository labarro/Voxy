import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { ShortcutDetails } from "electron";
export const APP_NAME = "Voxy";
export const APP_ID = "dev.voxy.desktop";
export function desktopIdentity(
  packaged: boolean,
  appData: string,
  appPath: string,
  resourcesPath: string,
) {
  return {
    name: packaged ? APP_NAME : "Voxy Desenvolvimento",
    appId: packaged ? APP_ID : APP_ID + ".development",
    // Never let a display-name change move profiles, DPAPI identities or rooms.
    userData: join(
      appData,
      packaged ? "voxy-desktop" : "voxy-desktop-development",
    ),
    icon: packaged
      ? join(resourcesPath, "icon.ico")
      : join(appPath, "build", "icon.ico"),
  };
}
export function startHidden(args: string[]) {
  return args.includes("--start-minimized") && !args.includes("--updated");
}
export function repairShortcut(
  path: string,
  target: string,
  icon: string,
  write: (
    path: string,
    operation: "create" | "update",
    details: ShortcutDetails,
  ) => boolean,
) {
  mkdirSync(dirname(path), { recursive: true });
  return write(path, existsSync(path) ? "update" : "create", {
    target,
    cwd: dirname(target),
    args: "",
    description: APP_NAME,
    icon,
    iconIndex: 0,
    appUserModelId: APP_ID,
  });
}
