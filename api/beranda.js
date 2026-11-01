import { withProxyGuard } from "../nyr-musik/proxy/proxy.js";
import { teratas } from "../nyr-musik/server/cari.js";

export default withProxyGuard(async (req, res) => {
  const raw = String(new URL(req.url, "http://x").searchParams.get("lagu") || "");
  const daftar = raw.split("|").map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 100).slice(0, 8);
  if (!daftar.length) {
    res.status(400).json({ ok: false, error: "isi parameter lagu, pisahkan dengan |" });
    return;
  }
  try {
    const lagu = await teratas(daftar);
    const adaHasil = lagu.some((l) => l.hasil);
    res.setHeader("Cache-Control", adaHasil ? "public, s-maxage=900, stale-while-revalidate=900" : "no-store");
    res.status(200).json({ ok: true, lagu });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ ok: false, error: err.message || "gagal memuat beranda" });
  }
});
