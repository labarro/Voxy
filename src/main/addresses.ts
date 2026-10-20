import type { NetworkInterfaceInfo } from "node:os";
import { privateIPv4, radminIPv4 } from "../shared/validation";
export function roomAddresses(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
) {
  const preferred: string[] = [],
    other: string[] = [];
  for (const [name, entries] of Object.entries(interfaces))
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4") continue;
      if (/radmin/i.test(name) && radminIPv4(entry.address))
        preferred.push(entry.address);
      else if (privateIPv4(entry.address)) other.push(entry.address);
    }
  return [...new Set([...preferred, "127.0.0.1", ...other])];
}
