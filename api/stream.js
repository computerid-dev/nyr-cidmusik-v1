import { withProxyGuard } from "../nyr-musik/proxy/proxy.js";
import { openAudio } from "../nyr-musik/server/net.js";

const MAX_BYTES = 60 * 1024 * 1024;

function cleanName(raw) {
  const n = String(raw || "lagu")
    .replace(/\.mp3$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 120);
  return n || "lagu";
}

export default withProxyGuard(async (req, res) => {
  try {
    const sp = new URL(req.url, "http://x").searchParams;
    const target = sp.get("u");
    if (!target) {
      res.status(400).json({ error: "parameter u wajib" });
      return;
    }
    const up = await openAudio(target, req.headers.range);
    if (up.status >= 400) {
      up.data.destroy();
      res.status(502).json({ error: `sumber membalas HTTP ${up.status}` });
      return;
    }
    const type = String(up.headers["content-type"] || "");
    if (/text\/html|application\/json/i.test(type)) {
      up.data.destroy();
      res.status(502).json({ error: "sumber tidak mengirim audio" });
      return;
    }
    const len = Number(up.headers["content-length"] || 0);
    if (len > MAX_BYTES) {
      up.data.destroy();
      res.status(413).json({ error: "file terlalu besar (maks 60 MB)" });
      return;
    }

    res.statusCode = up.status;
    res.setHeader("Content-Type", /^audio\//i.test(type) ? type : "audio/mpeg");
    if (len) res.setHeader("Content-Length", String(len));
    for (const h of ["accept-ranges", "content-range"]) {
      if (up.headers[h]) res.setHeader(h, up.headers[h]);
    }
    res.setHeader("Cache-Control", "no-store");
    if (sp.get("dl") === "1") {
      const name = cleanName(sp.get("name"));
      const ascii = name.replace(/[^\x20-\x7e]/g, "_");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${ascii}.mp3"; filename*=UTF-8''${encodeURIComponent(name)}.mp3`
      );
    }
    req.on("close", () => up.data.destroy());
    up.data.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: String(err.message || "stream gagal").slice(0, 200) });
    else res.end();
  }
});
