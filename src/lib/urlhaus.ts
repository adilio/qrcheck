export type UrlhausHosts = { updatedAt: string; count: number; hosts: string[] };
export async function loadUrlhausHosts(): Promise<UrlhausHosts> {
  const { fetchWithLocalCache } = await import("./cache");
  return fetchWithLocalCache<UrlhausHosts>("/urlhaus/hosts.json", "urlhaus_hosts");
}