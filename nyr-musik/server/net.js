import axios from "axios";
import dns from "node:dns/promises";
import net from "node:net";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") ||
      v.startsWith("fe80") || v.startsWith("::ffff:");
  }
  return true;
}

// Hanya izinkan https ke alamat publik. Mencegah endpoint stream dipakai membuka alamat internal.
export async function assertPublicHttps(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("URL tidak valid"); }
  if (u.protocol !== "https:") throw new Error("hanya https yang diizinkan");
  if (u.username || u.password) throw new Error("URL berisi kredensial, ditolak");
  const host = u.hostname;
  if (net.isIP(host)) throw new Error("alamat IP langsung ditolak");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("host internal ditolak");
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error("host mengarah ke alamat privat, ditolak");
  }
  return u;
}

// Buka aliran audio dari sumber, ikuti pengalihan manual (maks 3x) dan cek tiap tujuan.
export async function openAudio(url, range, timeout = 20000) {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    const u = await assertPublicHttps(current);
    const res = await axios.get(u.href, {
      responseType: "stream",
      headers: { "User-Agent": UA, ...(range ? { Range: range } : {}) },
      maxRedirects: 0,
      validateStatus: () => true,
      timeout,
    });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      res.data.destroy();
      current = new URL(res.headers.location, u).href;
      continue;
    }
    return res;
  }
  throw new Error("terlalu banyak pengalihan");
}

// Uji cepat: ambil 2 byte pertama lewat server kita (kondisi sama dengan saat streaming).
export async function verifyAudio(url) {
  const res = await openAudio(url, "bytes=0-1", 9000);
  res.data.destroy();
  const ct = String(res.headers["content-type"] || "");
  if (res.status !== 200 && res.status !== 206) throw new Error(`sumber membalas HTTP ${res.status}`);
  if (/text\/html|application\/json/i.test(ct)) throw new Error(`bukan audio (${ct})`);
  return { contentType: ct };
}
