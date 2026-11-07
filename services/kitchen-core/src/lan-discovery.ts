import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { timingSafeEqual } from "node:crypto";
const ipv4 = (s: string) => s.split(".").reduce((n, x) => (n << 8) | Number(x), 0) >>> 0;
export async function startLanDiscovery(options: {
  port: number; discoveryPort?: number;
  sign: (id: string, message: string) => string | null;
  addressFor?: (peer: string) => string | undefined;
}) {
  const socket = createSocket("udp4");
  const addressFor = options.addressFor ?? ((peer: string) => Object.values(networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal && ((ipv4(n.address) & ipv4(n.netmask)) === (ipv4(peer) & ipv4(n.netmask))))?.address);
  const recent = new Map<string, number>();
  socket.on("message", (packet, peer) => {
    if (packet.length > 300) return;
    const fields = packet.toString("ascii").split("|");
    if (fields.length !== 4 || fields[0] !== "HS_DISCOVER_V1" || !/^[a-z0-9-]{1,64}$/.test(fields[1]) || !/^[a-f0-9]{32}$/.test(fields[2]) || !/^[a-f0-9]{64}$/.test(fields[3])) return;
    const now = Date.now();
    if (now - (recent.get(peer.address) ?? 0) < 500) return;
    if (recent.size >= 128) recent.clear();
    recent.set(peer.address, now);
    const query = fields.slice(0, 3).join("|");
    const expected = options.sign(fields[1], query);
    if (!expected || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(fields[3], "hex"))) return;
    const address = addressFor(peer.address);
    if (!address) return;
    const body = `HS_CORE_V1|${fields[1]}|${fields[2]}|${address}|${options.port}`;
    const mac = options.sign(fields[1], body);
    if (mac) socket.send(`${body}|${mac}`, peer.port, peer.address);
  });
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.bind(options.discoveryPort ?? 3102, "0.0.0.0", () => {socket.off("error", reject);resolve();}); });
  socket.on("error", () => console.warn("局域网服务发现暂不可用"));
  return socket;
}
