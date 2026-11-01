import axios from "axios";
import { SavetubeDownloader, Ytmp3IngDownloader } from "./yt-core.js";
import { UA, verifyAudio } from "./net.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------
 * Tiap mesin menerima { id, url, quality } dan mengembalikan
 * { url, title, quality }. Gagal = lempar error.
 * ------------------------------------------------------------------ */

// 1. savetube (dari modul playyoutube) - kualitas mengikuti pilihan (sampai 320)
async function viaSavetube({ url, quality }) {
  const r = await new SavetubeDownloader().download(url, String(quality));
  if (!r.downloadUrl) throw new Error("link kosong dari savetube");
  return { url: r.downloadUrl, title: r.title, quality: `${quality}kbps` };
}

// 2. ytmp3.ing (dari modul playyoutube)
async function viaYtmp3ing({ url }) {
  const r = await new Ytmp3IngDownloader().download(url);
  if (!r.downloadUrl) throw new Error("link kosong dari ytmp3.ing");
  return { url: r.downloadUrl, title: r.title, quality: "128kbps" };
}

// 3. ymcdn / ytmp3.mobi (cadangan di modul ytmp3)
async function viaYmcdn({ id }) {
  const client = axios.create({
    headers: {
      Origin: "https://ytmp3.mobi",
      Referer: "https://ytmp3.mobi/en8/",
      "User-Agent": UA,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      Accept: "*/*",
    },
    timeout: 12000,
  });
  const { data: init } = await client.get(
    `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`
  );
  if (!init?.convertURL) throw new Error("init ymcdn gagal");

  let { data: conv } = await client.get(`${init.convertURL}&v=${id}&f=mp3&_=${Math.random()}`);
  let hops = 0;
  while (conv && conv.redirect > 0 && conv.redirectURL && hops++ < 5) {
    ({ data: conv } = await client.get(`${conv.redirectURL}&v=${id}&f=mp3&_=${Math.random()}`));
  }
  if (!conv || conv.error) throw new Error(`konversi ditolak ymcdn (kode ${conv?.error ?? "?"})`);

  let progress = 0;
  let finalUrl = conv.downloadURL;
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const { data: p } = await client.get(`${conv.progressURL}&_=${Math.random()}`);
    progress = p?.progress ?? 0;
    if (p?.downloadURL) finalUrl = p.downloadURL;
    if (progress === 4) break;
  }
  if (!finalUrl || progress < 3) throw new Error("konversi ymcdn belum selesai");
  return {
    url: finalUrl.startsWith("//") ? `https:${finalUrl}` : finalUrl,
    title: conv.title || "",
    quality: "320kbps",
  };
}

// 4. convert1s (dipakai modul ytmp3 dan ytmp3gg) - dimatikan karena hasil tes pengguna mati
async function viaConvert1s({ url }) {
  const headers = {
    Origin: "https://media.ytmp3.gg",
    Referer: "https://media.ytmp3.gg/",
    "User-Agent": UA,
    "Content-Type": "application/json",
  };
  const { data: conv } = await axios.post(
    "https://hub.convert1s.com/api/download",
    { url, os: "macos", output: { type: "audio", format: "mp3", quality: "" }, audio: { bitrate: "128k" } },
    { headers, timeout: 10000 }
  );
  if (!conv || conv.error || !conv.statusUrl) throw new Error("convert1s menolak permintaan");
  for (let i = 0; i < 15; i++) {
    await sleep(1200);
    const { data: p } = await axios.get(conv.statusUrl, { headers, timeout: 8000 });
    if (p?.status === "completed" && p?.downloadUrl) {
      return { url: p.downloadUrl, title: "", quality: conv.selectedQuality || "128kbps" };
    }
    if (p?.status === "error" || p?.status === "failed") break;
  }
  throw new Error("convert1s gagal atau kehabisan waktu");
}

// 5. oceansaver (EKSPERIMEN, ditulis dari ingatan, belum terverifikasi)
async function viaOceansaver({ url }) {
  const api = "dfcb6d76f2f6a9894gjkege8a4ab232222";
  const headers = { "User-Agent": UA, Referer: "https://p.oceansaver.in/" };
  const { data: start } = await axios.get("https://p.oceansaver.in/ajax/download.php", {
    params: { format: "mp3", url, api },
    headers,
    timeout: 15000,
  });
  if (!start?.id) throw new Error("oceansaver tidak memberi id");
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const { data: p } = await axios.get("https://p.oceansaver.in/ajax/progress.php", {
      params: { id: start.id },
      headers,
      timeout: 10000,
    });
    if (p?.download_url) return { url: p.download_url, title: start.title || "", quality: "128kbps" };
  }
  throw new Error("oceansaver kehabisan waktu");
}

/* ---- REST API komunitas (EKSPERIMEN): cari link audio di JSON apa pun bentuknya ---- */
const BAD_URL = /thumb|image|cover|poster|ytimg|youtube\.com|youtu\.be/i;
const URL_KEY = /^(dl|download|downloadurl|download_url|url|link|mp3)$/i;

function findInJson(root, keyRegex, valueTest) {
  let found = "";
  (function walk(o, key) {
    if (found || o == null) return;
    if (typeof o === "string") {
      if (keyRegex.test(key || "") && valueTest(o)) found = o;
      return;
    }
    if (typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, k);
  })(root, "");
  return found;
}

function restEngine(buildUrl) {
  return async ({ url, quality }) => {
    const { data } = await axios.get(buildUrl(encodeURIComponent(url), quality), {
      headers: { "User-Agent": UA },
      timeout: 28000,
    });
    const link = findInJson(data, URL_KEY, (v) => /^https?:\/\//i.test(v) && !BAD_URL.test(v));
    if (!link) throw new Error("link tidak ditemukan di respons");
    const title = findInJson(data, /^title$/i, () => true);
    return { url: link, title, quality: "?" };
  };
}

export const ENGINES = [
  { id: "savetube", name: "savetube", enabled: true, note: "dari playyoutube, bisa sampai 320kbps", run: viaSavetube },
  { id: "ytmp3ing", name: "ytmp3.ing", enabled: true, note: "cadangan playyoutube", run: viaYtmp3ing },
  { id: "ymcdn", name: "ymcdn (ytmp3.mobi)", enabled: true, note: "cadangan modul ytmp3", run: viaYmcdn },
  { id: "oceansaver", name: "oceansaver", enabled: true, note: "eksperimen, belum terverifikasi", run: viaOceansaver },
  {
    id: "siputzx", name: "api siputzx", enabled: true, note: "eksperimen, belum terverifikasi",
    run: restEngine((u) => `https://api.siputzx.my.id/api/d/ytmp3?url=${u}`),
  },
  {
    id: "vreden", name: "api vreden", enabled: true, note: "eksperimen, belum terverifikasi",
    run: restEngine((u) => `https://api.vreden.my.id/api/ytmp3?url=${u}`),
  },
  {
    id: "ryzumi", name: "api ryzumi", enabled: true, note: "eksperimen, belum terverifikasi",
    run: restEngine((u) => `https://api.ryzumi.vip/api/downloader/ytmp3?url=${u}`),
  },
  { id: "convert1s", name: "convert1s", enabled: false, note: "dipakai ytmp3 dan ytmp3gg, mati menurut tes", run: viaConvert1s },
];

export function listEngines() {
  return ENGINES.map(({ id, name, enabled, note }) => ({ id, name, enabled, note }));
}

export async function resolveWith(engineId, { id, quality }) {
  const eng = ENGINES.find((e) => e.id === engineId);
  if (!eng) {
    const err = new Error("mesin tidak dikenal");
    err.status = 404;
    throw err;
  }
  const t0 = Date.now();
  const out = await eng.run({ id, url: `https://www.youtube.com/watch?v=${id}`, quality });
  if (!out?.url) throw new Error("mesin tidak memberi link");
  await verifyAudio(out.url);
  return {
    ok: true,
    engine: eng.id,
    url: out.url,
    title: out.title || "",
    quality: out.quality || "",
    ms: Date.now() - t0,
  };
}
