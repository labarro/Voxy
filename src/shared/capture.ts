// Windows process-loopback exclusion requires build 20348 or newer.
// Never fall back to unrestricted system loopback on older systems.
export function safeSystemAudio(
  platform: string,
  osRelease: string,
  electronVersion: string,
) {
  return (
    platform === "win32" &&
    Number(osRelease.split(".")[2]) >= 20348 &&
    Number(electronVersion.split(".")[0]) >= 44
  );
}
export function shareAudioConstraints(requested: boolean) {
  return requested
    ? {
        restrictOwnAudio: true,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    : false;
}
