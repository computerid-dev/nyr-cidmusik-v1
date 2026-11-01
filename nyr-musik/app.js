(function () {
  "use strict";

  /* ================= util ================= */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const cfg = window.NYR_CONFIG || { lagu: [], artis: [], videoTes: "" };
  const audio = $("#audio");
  const WARNA = ["#FFD93D", "#6BCB77", "#4D96FF", "#FF6B6B", "#FFFFFF"];

  const state = {
    queue: [], index: -1, engines: null, resolveCache: new Map(),
    playToken: 0, blobUrl: null, direct: true, busy: false,
    pipWin: null, pipTimer: null, canvas: null,
  };

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    (kids || []).forEach((c) => c && n.appendChild(c));
    return n;
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3200);
  }

  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } }

  async function fetchJson(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 30000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && !j.error) j.error = "HTTP " + r.status;
      return j;
    } finally { clearTimeout(timer); }
  }

  function cleanName(raw) {
    const n = String(raw || "lagu").replace(/\.mp3$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 120);
    return n || "lagu";
  }
  const proxyUrl = (u) => "/api/stream?u=" + encodeURIComponent(u);
  const coverOf = (t) => t.thumbnail || ("https://i.ytimg.com/vi/" + t.id + "/hqdefault.jpg");

  function extractId(text) {
    const s = String(text || "").trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([\w-]{11})/i);
    return m ? m[1] : null;
  }

  /* ================= IndexedDB (riwayat + lagu offline) ================= */
  function dbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("nyr-musik", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("lagu", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await dbOpen();
    return new Promise((res, rej) => {
      const t = db.transaction("lagu", mode);
      const rq = fn(t.objectStore("lagu"));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const dbPut = (v) => tx("readwrite", (s) => s.put(v));
  const dbDel = (id) => tx("readwrite", (s) => s.delete(id));
  async function dbGet(id) { try { return await tx("readonly", (s) => s.get(id)); } catch { return undefined; } }
  async function dbAll() { try { return (await tx("readonly", (s) => s.getAll())) || []; } catch { return []; } }

  /* ================= tab & offline ================= */
  function showTab(name) {
    if (!navigator.onLine && name !== "unduh") {
      toast("Mode offline: hanya menu Unduh yang bisa dibuka");
      name = "unduh";
    }
    $$(".tab").forEach((s) => { s.hidden = s.id !== "tab-" + name; });
    $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    if (name === "unduh") renderSaved();
    if (name === "tes") renderEngineList();
  }
  function applyNet() {
    const off = !navigator.onLine;
    document.body.classList.toggle("offline", off);
    $("#net-badge").textContent = off ? "OFFLINE" : "ONLINE";
    $("#offline-note").hidden = !off;
    $("#form-unduh").style.display = off ? "none" : "";
    if (off) showTab("unduh");
  }

  /* ================= daftar lagu ================= */
  function renderTracks(list, target) {
    const box = target || $("#results");
    box.replaceChildren();
    if (!list.length) { box.appendChild(el("p", { class: "empty", text: "Tidak ada hasil." })); return; }
    list.forEach((t, i) => {
      const meta = [t.author, t.durasi].filter(Boolean).join(" - ");
      const tags = (t.jenis || []).map((j) => el("span", { class: "tagline", text: j.toUpperCase() }));
      if (t.label) tags.unshift(el("span", { class: "tagline blue", text: t.label.toUpperCase() }));
      box.appendChild(el("div", { class: "item" }, [
        el("img", { src: coverOf(t), alt: "", loading: "lazy", width: "72", height: "54" }),
        el("div", { class: "meta" }, [
          el("strong", { text: t.title || t.id }),
          el("span", { text: meta }),
          tags.length ? el("div", { class: "tags" }, tags) : null,
        ]),
        el("div", { class: "acts" }, [
          el("button", { class: "btn small blue", type: "button", text: "PUTAR", onclick: () => { state.queue = list.slice(); putar(i); } }),
          el("button", { class: "btn small green only-online", type: "button", text: "UNDUH", onclick: () => mulaiUnduh(t) }),
        ]),
      ]));
    });
  }
  const normTrack = (r) => ({ id: r.id, title: r.title, author: r.author, thumbnail: r.thumbnail, durasi: r.durasi || "", jenis: r.jenis || [] });

  const FILTERS = [["semua", "SEMUA"], ["mv", "MV"], ["lirik", "LIRIK"], ["cover", "COVER"], ["live", "LIVE"], ["audio", "AUDIO"]];
  state.hasil = [];
  state.filter = "semua";

  function tampilHasil() {
    const chips = $("#filter-chips");
    chips.replaceChildren();
    const semua = state.hasil;
    FILTERS.forEach(([k, label]) => {
      const n = k === "semua" ? semua.length : semua.filter((t) => t.jenis.includes(k)).length;
      if (k !== "semua" && !n) return;
      chips.appendChild(el("button", {
        class: "chip" + (state.filter === k ? " on" : ""), type: "button", text: label + " (" + n + ")",
        onclick: () => { state.filter = k; tampilHasil(); },
      }));
    });
    chips.hidden = !semua.length;
    renderTracks(state.filter === "semua" ? semua : semua.filter((t) => t.jenis.includes(state.filter)));
  }

  async function cari(q, judul) {
    showTab("cari");
    $("#in-cari").value = q;
    $("#judul-hasil").textContent = judul || ("Hasil: " + q);
    $("#filter-chips").hidden = true;
    const box = $("#results");
    box.replaceChildren(el("p", { class: "empty", text: "Mencari semua versi (MV, lirik, cover, live)..." }));
    try {
      const j = await fetchJson("/api/search?q=" + encodeURIComponent(q), 40000);
      if (!j.ok) throw new Error(j.error || "pencarian gagal");
      state.hasil = j.results.map(normTrack);
      state.filter = "semua";
      tampilHasil();
    } catch (e) {
      box.replaceChildren(el("p", { class: "empty", text: "Gagal mencari: " + (e.name === "AbortError" ? "waktu habis" : e.message) }));
    }
  }

  function renderHome() {
    const ag = $("#artist-grid");
    ag.replaceChildren();
    (cfg.artis || []).forEach((nama, i) => {
      ag.appendChild(el("button", { class: "tile", type: "button", style: "background:" + WARNA[(i + 2) % WARNA.length], onclick: () => cari(nama, "Artis: " + nama) }, [
        el("span", { class: "mono", text: nama.trim().charAt(0).toUpperCase() }),
        el("span", { text: nama }),
      ]));
    });
  }

  async function muatLagu() {
    const box = $("#home-songs");
    const daftar = cfg.lagu || [];
    if (!daftar.length) { box.replaceChildren(); return; }
    box.replaceChildren(el("p", { class: "empty", text: "Memuat lagu pilihan..." }));
    try {
      const j = await fetchJson("/api/beranda?lagu=" + encodeURIComponent(daftar.map((l) => l.cari).join("|")), 40000);
      if (!j.ok) throw new Error(j.error || "gagal memuat");
      const tracks = [];
      const gagal = [];
      j.lagu.forEach((l, i) => {
        if (l.hasil) tracks.push(Object.assign(normTrack(l.hasil), { label: daftar[i].judul }));
        else gagal.push(daftar[i]);
      });
      if (!tracks.length) throw new Error("YouTube tidak memberi hasil");
      renderTracks(tracks, box);
      gagal.forEach((g) => box.appendChild(el("button", { class: "btn small", type: "button", text: "CARI: " + g.judul, onclick: () => cari(g.cari, "Lagu: " + g.judul) })));
    } catch (e) {
      box.replaceChildren(
        el("p", { class: "empty", text: "Lagu pilihan belum bisa dimuat: " + (e.name === "AbortError" ? "waktu habis" : e.message) }),
        el("button", { class: "btn small", type: "button", text: "COBA LAGI", onclick: muatLagu }),
        el("div", { class: "grid" }, daftar.map((l, i) => el("button", {
          class: "tile", type: "button", style: "background:" + WARNA[i % WARNA.length], onclick: () => cari(l.cari, "Lagu: " + l.judul),
        }, [el("span", { class: "mono", text: l.judul.charAt(0).toUpperCase() }), el("span", { text: l.judul })])))
      );
    }
  }

  /* ================= mesin downloader (dicoba satu per satu) ================= */
  async function daftarMesin() {
    if (!state.engines) {
      const j = await fetchJson("/api/engines", 15000);
      if (!j.ok) throw new Error(j.error || "gagal mengambil daftar mesin");
      state.engines = j.engines;
    }
    return state.engines;
  }

  async function ambilLink(t, quality, onStatus) {
    const aktif = (await daftarMesin()).filter((e) => e.enabled);
    const terakhir = lsGet("nyr_mesin_terakhir", "");
    aktif.sort((a, b) => (b.id === terakhir) - (a.id === terakhir));
    const gagal = [];
    for (let i = 0; i < aktif.length; i++) {
      const e = aktif[i];
      if (onStatus) onStatus("Mesin " + (i + 1) + "/" + aktif.length + ": " + e.name + "...");
      try {
        const r = await fetchJson("/api/resolve?engine=" + e.id + "&id=" + t.id + "&quality=" + quality, 52000);
        if (r.ok) { lsSet("nyr_mesin_terakhir", e.id); return r; }
        gagal.push(e.name + ": " + (r.error || "gagal"));
      } catch (err) {
        gagal.push(e.name + ": " + (err.name === "AbortError" ? "waktu habis" : err.message));
      }
    }
    const err = new Error("Semua mesin gagal. " + gagal.join(" | "));
    throw err;
  }

  /* ================= pemutar ================= */
  function updatePlayerUI(t) {
    $("#player").hidden = false;
    $("#p-title").textContent = t.title || t.id;
    $("#p-sub").textContent = t.author || "";
    $("#p-cover").src = coverOf(t);
    setMedia(t);
    updatePipDoc();
  }
  const setSub = (m) => { $("#p-sub").textContent = m; };

  async function sumberAudio(t, onStatus) {
    const saved = await dbGet(t.id);
    if (saved && saved.blob) return { blobUrl: URL.createObjectURL(saved.blob) };
    const c = state.resolveCache.get(t.id);
    if (c && Date.now() - c.t < 10 * 60 * 1000) return c.r;
    if (!navigator.onLine) throw new Error("sedang offline dan lagu belum tersimpan");
    const r = await ambilLink(t, "128", onStatus);
    state.resolveCache.set(t.id, { t: Date.now(), r });
    return r;
  }

  function pasangSumber(src) {
    if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }
    if (src.blobUrl) { state.blobUrl = src.blobUrl; state.direct = false; audio.src = src.blobUrl; return; }
    state.direct = true;
    state.currentRemote = src.url;
    audio.src = src.url;
  }

  async function putar(i) {
    const t = state.queue[i];
    if (!t) return;
    state.index = i;
    const token = ++state.playToken;
    updatePlayerUI(t);
    setSub("Menyiapkan lagu...");
    try {
      const src = await sumberAudio(t, setSub);
      if (token !== state.playToken) return;
      pasangSumber(src);
      setSub(t.author || "");
      await audio.play();
    } catch (e) {
      if (token !== state.playToken) return;
      setSub("gagal memutar");
      toast("Gagal memutar: " + e.message, 6000);
    }
  }

  audio.addEventListener("error", () => {
    if (state.direct && state.currentRemote) {
      state.direct = false;
      const pos = audio.currentTime || 0;
      audio.src = proxyUrl(state.currentRemote);
      audio.currentTime = pos;
      audio.play().catch(() => {});
    } else if (audio.src) {
      toast("Lagu tidak bisa diputar");
    }
  });
  audio.addEventListener("ended", () => {
    if (state.index + 1 < state.queue.length) putar(state.index + 1);
  });
  audio.addEventListener("timeupdate", () => {
    if (audio.duration && !$("#p-seek").matches(":active")) $("#p-seek").value = Math.round((audio.currentTime / audio.duration) * 1000);
  });
  function syncPlayIcon() {
    const playing = !audio.paused;
    $("#ic-play").hidden = playing;
    $("#ic-pause").hidden = !playing;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    updatePipDoc();
  }
  audio.addEventListener("play", syncPlayIcon);
  audio.addEventListener("pause", syncPlayIcon);

  function toggle() {
    if (audio.src && audio.readyState > 0) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
    if (state.queue.length) putar(Math.max(state.index, 0));
  }
  function prev() { if (audio.currentTime > 5 || state.index <= 0) { audio.currentTime = 0; } else putar(state.index - 1); }
  function next() { if (state.index + 1 < state.queue.length) putar(state.index + 1); }
  $("#p-play").addEventListener("click", toggle);
  $("#p-prev").addEventListener("click", prev);
  $("#p-next").addEventListener("click", next);
  $("#p-seek").addEventListener("input", (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });

  function setMedia(t) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || "", artist: t.author || "", album: "NYR Musik",
      artwork: [{ src: coverOf(t), sizes: "480x360", type: "image/jpeg" }],
    });
  }
  if ("mediaSession" in navigator) {
    const h = (n, f) => { try { navigator.mediaSession.setActionHandler(n, f); } catch { /* tidak didukung */ } };
    h("play", () => audio.play().catch(() => {}));
    h("pause", () => audio.pause());
    h("previoustrack", prev);
    h("nexttrack", next);
  }

  /* ================= jendela mengambang ================= */
  function updatePipDoc() {
    const w = state.pipWin;
    if (!w || w.closed) return;
    const t = state.queue[state.index] || {};
    const d = w.document;
    const a = d.getElementById("pt"); if (a) a.textContent = t.title || "-";
    const b = d.getElementById("ps"); if (b) b.textContent = t.author || "";
    const c = d.getElementById("pp"); if (c) c.textContent = audio.paused ? "PUTAR" : "JEDA";
  }

  async function pipDokumen() {
    const win = await window.documentPictureInPicture.requestWindow({ width: 340, height: 170 });
    state.pipWin = win;
    const d = win.document;
    const css = d.createElement("style");
    css.textContent =
      "*{box-sizing:border-box}body{margin:0;padding:10px;background:#FFF8E7;font-family:system-ui,sans-serif;color:#000}" +
      ".box{border:3px solid #000;box-shadow:4px 4px 0 #000;background:#fff;padding:10px}" +
      "#pt{font-weight:900;font-size:14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}" +
      "#ps{font-size:12px;font-weight:700;margin-bottom:10px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}" +
      ".r{display:flex;gap:8px}button{flex:1;padding:10px 0;font:inherit;font-weight:800;background:#FFD93D;border:3px solid #000;box-shadow:3px 3px 0 #000;cursor:pointer}" +
      "button:active{transform:translate(3px,3px);box-shadow:none}";
    d.head.appendChild(css);
    const box = d.createElement("div"); box.className = "box";
    const t = d.createElement("div"); t.id = "pt";
    const s = d.createElement("div"); s.id = "ps";
    const row = d.createElement("div"); row.className = "r";
    [["SEBELUM", prev, "pb"], ["PUTAR", toggle, "pp"], ["BERIKUT", next, "pn"]].forEach(([txt, fn, id]) => {
      const b = d.createElement("button"); b.id = id; b.type = "button"; b.textContent = txt; b.addEventListener("click", fn); row.appendChild(b);
    });
    box.append(t, s, row);
    d.body.appendChild(box);
    win.addEventListener("pagehide", () => { state.pipWin = null; });
    updatePipDoc();
  }

  function gambarKanvas() {
    const cv = state.canvas;
    const g = cv.getContext("2d");
    const t = state.queue[state.index] || {};
    g.fillStyle = "#FFF8E7"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#000"; g.fillRect(22, 22, cv.width - 30, cv.height - 30);
    g.fillStyle = "#FFD93D"; g.fillRect(14, 14, cv.width - 30, cv.height - 30);
    g.strokeStyle = "#000"; g.lineWidth = 6; g.strokeRect(14, 14, cv.width - 30, cv.height - 30);
    g.fillStyle = "#000"; g.font = "bold 14px system-ui, sans-serif";
    g.fillText(audio.paused ? "JEDA" : "SEDANG DIPUTAR", 30, 44);
    g.font = "900 26px system-ui, sans-serif";
    const words = String(t.title || "NYR MUSIK").split(" ");
    let line = "", y = 90, rows = 0;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (g.measureText(test).width > cv.width - 76 && line) {
        g.fillText(line, 30, y); y += 32; rows++; line = w;
        if (rows >= 2) break;
      } else line = test;
    }
    if (rows < 3) g.fillText(line, 30, y);
    g.font = "bold 16px system-ui, sans-serif";
    g.fillText(String(t.author || "").slice(0, 40), 30, cv.height - 62);
    const pct = audio.duration ? audio.currentTime / audio.duration : 0;
    g.fillStyle = "#fff"; g.fillRect(30, cv.height - 46, cv.width - 76, 16);
    g.fillStyle = "#4D96FF"; g.fillRect(30, cv.height - 46, (cv.width - 76) * pct, 16);
    g.strokeRect(30, cv.height - 46, cv.width - 76, 16);
  }

  async function pipKanvas() {
    if (!document.pictureInPictureEnabled) throw new Error("browser ini tidak mendukung jendela mengambang");
    if (!state.canvas) { state.canvas = document.createElement("canvas"); state.canvas.width = 480; state.canvas.height = 270; }
    gambarKanvas();
    const v = $("#pip-video");
    if (!v.srcObject) v.srcObject = state.canvas.captureStream(5);
    v.muted = true;
    await v.play();
    await v.requestPictureInPicture();
    clearInterval(state.pipTimer);
    state.pipTimer = setInterval(gambarKanvas, 1000);
    v.addEventListener("leavepictureinpicture", () => clearInterval(state.pipTimer), { once: true });
  }

  $("#p-float").addEventListener("click", async () => {
    if (!state.queue.length) { toast("Putar lagu dulu"); return; }
    if (state.pipWin && !state.pipWin.closed) { state.pipWin.close(); return; }
    try {
      if ("documentPictureInPicture" in window) { await pipDokumen(); return; }
    } catch { /* lanjut ke cara kanvas */ }
    try { await pipKanvas(); } catch (e) { toast("Jendela mengambang gagal: " + e.message, 5000); }
  });

  /* ================= unduh ================= */
  function setDl(text, pct) {
    const box = $("#dl-status");
    box.hidden = false;
    $("#dl-text").textContent = text;
    $("#dl-bar").style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
  }

  function simpanFile(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = cleanName(name) + ".mp3";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  async function mulaiUnduh(t) {
    if (state.busy) { toast("Masih ada unduhan berjalan"); return; }
    if (!navigator.onLine) { toast("Sedang offline"); return; }
    state.busy = true;
    $("#btn-unduh").disabled = true;
    showTab("unduh");
    const quality = $("#sel-kualitas").value;
    const offline = $("#chk-offline").checked;
    try {
      setDl("Mencari mesin yang aktif...", 3);
      const r = await ambilLink(t, quality, (m) => setDl(m, 10));
      setDl("Mengunduh dari " + r.engine + "...", 25);
      const resp = await fetch(proxyUrl(r.url));
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || "HTTP " + resp.status); }
      const total = Number(resp.headers.get("content-length") || 0);
      const chunks = [];
      let got = 0;
      if (resp.body && resp.body.getReader) {
        const rd = resp.body.getReader();
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          chunks.push(value); got += value.length;
          setDl("Mengunduh " + (got / 1048576).toFixed(1) + " MB" + (total ? " dari " + (total / 1048576).toFixed(1) + " MB" : ""), total ? 25 + (got / total) * 70 : 60);
        }
      } else { chunks.push(new Uint8Array(await resp.arrayBuffer())); }
      const blob = new Blob(chunks, { type: "audio/mpeg" });
      if (blob.size < 20000) throw new Error("file terlalu kecil, kemungkinan bukan lagu");
      const judul = t.title || r.title || t.id;
      simpanFile(blob, judul);
      await dbPut({
        id: t.id, title: judul, author: t.author || "", thumbnail: coverOf(t),
        quality: r.quality || "", engine: r.engine, time: Date.now(), size: blob.size, blob: offline ? blob : null,
      }).catch(() => toast("Tersimpan ke folder unduhan, tapi gagal disimpan di aplikasi"));
      setDl("Selesai: " + judul + ".mp3 (" + (blob.size / 1048576).toFixed(1) + " MB)", 100);
      renderSaved();
    } catch (e) {
      setDl("Gagal: " + e.message, 0);
    } finally {
      state.busy = false;
      $("#btn-unduh").disabled = false;
    }
  }

  $("#form-unduh").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#in-link").value.trim();
    if (!text) { toast("Isi link YouTube dulu"); return; }
    const id = extractId(text);
    if (!id) { toast("Bukan link YouTube, mencari sebagai kata kunci"); cari(text); return; }
    mulaiUnduh({ id, title: "", author: "", thumbnail: "" });
  });

  async function renderSaved() {
    const box = $("#saved");
    const rows = (await dbAll()).sort((a, b) => b.time - a.time);
    box.replaceChildren();
    if (!rows.length) { box.appendChild(el("p", { class: "empty", text: "Belum ada unduhan." })); return; }
    rows.forEach((r, i) => {
      const info = [r.quality, r.engine, r.blob ? "tersimpan offline" : "hanya di folder unduhan"].filter(Boolean).join(" - ");
      const acts = [
        el("button", { class: "btn small blue", type: "button", text: "PUTAR", onclick: () => { state.queue = rows.map((x) => ({ id: x.id, title: x.title, author: x.author, thumbnail: x.thumbnail })); putar(i); } }),
      ];
      if (r.blob) acts.push(el("button", { class: "btn small green", type: "button", text: "SIMPAN LAGI", onclick: () => simpanFile(r.blob, r.title) }));
      acts.push(el("button", { class: "btn small red", type: "button", text: "HAPUS", onclick: async () => { await dbDel(r.id); renderSaved(); } }));
      box.appendChild(el("div", { class: "item" }, [
        el("img", { src: r.thumbnail || coverOf(r), alt: "", width: "72", height: "54" }),
        el("div", { class: "meta" }, [el("strong", { text: r.title }), el("span", { text: info })]),
        el("div", { class: "acts" }, acts),
      ]));
    });
  }

  /* ================= tes mesin ================= */
  async function renderEngineList() {
    const box = $("#engine-list");
    if (box.childElementCount) return;
    try {
      const list = await daftarMesin();
      list.forEach((e) => box.appendChild(engineRow(e, "belum dites", "")));
    } catch (err) {
      box.appendChild(el("p", { class: "empty", text: "Gagal memuat daftar mesin: " + err.message }));
    }
  }
  function engineRow(e, status, cls) {
    return el("div", { class: "item " + cls, id: "eng-" + e.id }, [
      el("div", { class: "meta" }, [
        el("strong", { text: e.name + (e.enabled ? "" : " (nonaktif)") }),
        el("span", { text: e.note || "" }),
        el("span", { class: "est", text: status }),
      ]),
    ]);
  }
  $("#btn-tes").addEventListener("click", async () => {
    const btn = $("#btn-tes");
    const id = ($("#in-tes").value || "").trim();
    if (!/^[\w-]{11}$/.test(id)) { toast("ID video harus 11 karakter"); return; }
    btn.disabled = true;
    const box = $("#engine-list");
    box.replaceChildren();
    let lolos = 0, total = 0;
    try {
      const list = await daftarMesin();
      for (const e of list) {
        total++;
        const row = engineRow(e, "mencoba...", "wait");
        box.appendChild(row);
        const t0 = Date.now();
        let r;
        try { r = await fetchJson("/api/resolve?engine=" + e.id + "&id=" + id + "&quality=" + $("#sel-kualitas").value, 55000); }
        catch (err) { r = { ok: false, error: err.name === "AbortError" ? "waktu habis" : err.message }; }
        const secs = ((Date.now() - t0) / 1000).toFixed(1) + " dtk";
        const fresh = engineRow(e, r.ok ? "LOLOS - " + secs + " - " + (r.quality || "") : "GAGAL - " + secs + " - " + (r.error || ""), r.ok ? "ok" : "fail");
        box.replaceChild(fresh, row);
        if (r.ok) lolos++;
      }
      toast(lolos + " dari " + total + " mesin lolos", 5000);
    } catch (err) { toast("Tes gagal: " + err.message); }
    btn.disabled = false;
  });

  /* ================= pencarian & navigasi ================= */
  $("#form-cari").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#in-cari").value.trim();
    if (q.length < 2) { toast("Kata kunci minimal 2 huruf"); return; }
    cari(q);
  });
  $$(".nav").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  window.addEventListener("online", applyNet);
  window.addEventListener("offline", applyNet);

  /* ================= mulai ================= */
  $("#in-tes").value = cfg.videoTes || "";
  renderHome();
  applyNet();
  if (navigator.onLine) { showTab("home"); muatLagu(); }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => { /* PWA opsional */ });
    });
  }
})();
