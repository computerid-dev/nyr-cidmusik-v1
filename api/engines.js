import { withProxyGuard } from "../nyr-musik/proxy/proxy.js";
import { listEngines } from "../nyr-musik/server/engines.js";

export default withProxyGuard(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, engines: listEngines() });
});
