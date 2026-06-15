import { getRemoteServiceAvailability } from "../../process/index.ts";

export async function shouldRouteMissingServiceToRemote(
  serviceName: string,
  daemonEnabled: boolean,
): Promise<boolean> {
  if (!daemonEnabled) return false;
  const availability = await getRemoteServiceAvailability(serviceName);
  return availability === "hosted";
}
