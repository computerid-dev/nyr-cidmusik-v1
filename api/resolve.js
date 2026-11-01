import { withProxyGuard } from "../nyr-musik/proxy/proxy.js";
import { resolveWith } from "../nyr-musik/server/engines.js";

const QUALITIES = ["128", "192", "256", "320"];

export default withProxyGuard(async (req, res) => {
  const sp = new URL(req.url, "http://x").searchParams;
  const engine = String(sp.get("engine") || "");
  const id = String(sp.get("id") || "");
  let quality = String(sp.get("quality") || "320");
  if (!QUALITIES.includes(quality)) quality = "320";
  if (!/^[\w-]{11}$/.test(id)) {
    res.status(400).json({ ok: false, error: "id video tidak valid" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const out = await resolveWith(engine, { id, quality });
    res.status(200).json(out);
  } catch (err) {
    // 200 + ok:false supaya klien bisa lanjut ke mesin berikutnya tanpa dianggap error jaringan
    res.status(err.status || 200).json({ ok: false, engine, error: String(err.message || "gagal").slice(0, 200) });
  }
});
