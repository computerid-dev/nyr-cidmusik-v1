import { YouTubeSearch } from "./yt-core.js";

// Pencarian asli + tiga variasi supaya MV, lirik video, cover, dan live ikut muncul.
const VARIAN = ["", "lirik", "cover", "live"];
const BATAS_HASIL = 36;

const POLA_JENIS = [
  ["mv", /\b(mv|music video|official video|video klip|klip resmi|official mv)\b/i],
  ["lirik", /\b(lirik|lyrics?|lyric video|video lirik)\b/i],
  ["cover", /\bcover\b/i],
  ["live", /\b(live|konser|concert|live session|live performance)\b/i],
  ["audio", /\b(official audio|audio only|full audio)\b/i],
];

export function jenisDari(judul) {
  const t = String(judul || "");
  return POLA_JENIS.filter(([, re]) => re.test(t)).map(([nama]) => nama);
}

// Gabungkan beberapa daftar secara bergantian (daftar pertama = pencarian asli didahulukan),
// buang duplikat, lalu potong sampai batas.
export function gabung(daftar, batas = BATAS_HASIL) {
  const lihat = new Set();
  const hasil = [];
  const maks = Math.max(0, ...daftar.map((d) => d.length));
  for (let i = 0; i < maks && hasil.length < batas; i++) {
    for (const d of daftar) {
      const item = d[i];
      if (!item || !item.id || lihat.has(item.id)) continue;
      lihat.add(item.id);
      hasil.push({ ...item, jenis: jenisDari(item.title) });
      if (hasil.length >= batas) break;
    }
  }
  return hasil;
}

export async function cariSemua(q) {
  const jobs = VARIAN.map((v) => new YouTubeSearch().search(v ? `${q} ${v}` : q));
  const selesai = await Promise.allSettled(jobs);
  if (selesai.every((s) => s.status === "rejected")) throw selesai[0].reason;
  const daftar = selesai.map((s) => (s.status === "fulfilled" ? s.value : []));
  return gabung(daftar);
}

// Untuk beranda: ambil hasil teratas dari tiap judul lagu.
export async function teratas(judulList) {
  const selesai = await Promise.allSettled(judulList.map((q) => new YouTubeSearch().search(q)));
  return judulList.map((query, i) => {
    const s = selesai[i];
    if (s.status !== "fulfilled") return { query, hasil: null, error: String(s.reason?.message || "gagal").slice(0, 120) };
    const top = s.value[0];
    return { query, hasil: top ? { ...top, jenis: jenisDari(top.title) } : null };
  });
}
