import { withProxyGuard } from "../nyr-musik/proxy/proxy.js";
import { cariSemua } from "../nyr-musik/server/cari.js";

export default withProxyGuard(async (req, res) => {
  try {
    const q = String(new URL(req.url, "http://x").searchParams.get("q") || "").trim();
    if (q.length < 2 || q.length > 100) {
      res.status(400).json({ error: "kata kunci 2 sampai 100 karakter" });
      return;
    }
    const results = await cariSemua(q);
    // cache singkat hanya kalau ada hasil, supaya kegagalan sesaat tidak ikut tersimpan
    res.setHeader("Cache-Control", results.length ? "public, s-maxage=300, stale-while-revalidate=300" : "no-store");
    res.status(200).json({ ok: true, results });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ ok: false, error: err.message || "pencarian gagal" });
  }
});
