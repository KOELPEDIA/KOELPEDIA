/* GOSUPPLY – sinkron pengaturan admin ke Cloudflare (via _worker.js + KV)
   Pasang SETELAH gosupply-patch.js dan gosupply-ui.js. */
(function () {
  const _set = store.set;
  const CLOUD_KEYS = { gs_status: 1, gs_media: 1, gs_pay: 1, gs_disc: 1, gs_popup: 1 };

  /* ---------- Token admin ---------- */
  const getTok = () => { try { const t = localStorage.getItem("gs_tok"); return t && +t.split(".")[0] > Date.now() ? t : null; } catch (e) { return null; } };
  const setTok = (t) => { try { t ? localStorage.setItem("gs_tok", t) : localStorage.removeItem("gs_tok"); } catch (e) {} };
  const auth = () => ({ Authorization: "Bearer " + getTok() });

  /* ---------- Muat pengaturan dari server (semua pengunjung) ---------- */
  const swap = (target, src) => { Object.keys(target).forEach(k => delete target[k]); Object.assign(target, src || {}); };
  function applyCloud(d) {
    swap(st, d.status); swap(dsc, d.disc); swap(media, d.media); swap(pay, d.pay);
    PRODUCTS.forEach(p => {
      if (st[p.id]) p.status = st[p.id];
      if (p.id in dsc) p.disc = dsc[p.id];
      const m = media[p.id];
      if (m) { if (m.img) p.img = m.img; if (m.bg) p.bg = m.bg; }
    });
    PAYMENTS.forEach(m => Object.assign(m, pay[m.id] || {}));
    if (d.popup) pop = Object.assign({}, POPDEF, d.popup);
    render($(".tab.on").dataset.k, false);
    renderPays();
    chips();
  }
  (async () => {
    try {
      const r = await fetch("/api/config", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      if (d && Object.keys(d).length) applyCloud(d);
    } catch (e) { console.warn("Gagal memuat pengaturan server:", e.message || e); }
  })();

  /* ---------- Simpan ke server (hanya admin yang login) ---------- */
  async function uploadDataUrls(obj) {
    for (const id in obj) for (const f in obj[id]) {
      const v = obj[id][f];
      if (typeof v === "string" && v.startsWith("data:image")) {
        const blob = await (await fetch(v)).blob();
        const r = await fetch("/api/upload", { method: "POST", headers: { ...auth(), "Content-Type": blob.type }, body: blob });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Upload gagal (" + r.status + ")");
        obj[id][f] = (await r.json()).url;   // ganti base64 -> URL /img/...
      }
    }
  }
  let chain = Promise.resolve();
  const saveCloud = () => (chain = chain.then(async () => {
    try {
      if (!getTok()) throw new Error("Sesi admin habis, masuk admin lagi");
      await uploadDataUrls(media); await uploadDataUrls(pay);
      _set("gs_media", media); _set("gs_pay", pay);
      const r = await fetch("/api/config", { method: "PUT", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ status: st, media, pay, disc: dsc, popup: pop }) });
      if (!r.ok) { if (r.status === 401) setTok(null); throw new Error((await r.json().catch(() => ({}))).error || r.status); }
      toast("Tersimpan di server ✓");
    } catch (e) { toast("Gagal simpan ke server: " + (e.message || e)); console.error(e); }
  }));

  // Setiap admin menyimpan sesuatu, ikut kirim ke server
  store.set = (k, v) => { const ok = _set(k, v); if (CLOUD_KEYS[k]) saveCloud(); return ok; };

  // Tombol Reset: tunggu simpan selesai dulu baru reload
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-rst],[data-prst]"); if (!b) return;
    e.stopPropagation(); e.preventDefault();
    const d = b.dataset;
    if (d.rst) { delete media[d.rst]; _set("gs_media", media); }
    if (d.prst) { delete pay[d.prst]; _set("gs_pay", pay); }
    await saveCloud(); location.reload();
  }, true);

  /* ---------- Login admin (ganti PIN di dalam JS) ---------- */
  $("#openAdmin").onclick = () => {
    boxH.onclick = boxH.onchange = null;
    const showAdmin = () => {
      admin();
      boxH.insertAdjacentHTML("beforeend", '<p style="margin-top:24px"><button class="mini" id="aOut">Keluar admin</button></p>');
      $("#aOut").onclick = () => { setTok(null); closeOv(ovH, boxH); toast("Keluar dari admin"); };
    };
    if (getTok()) { openOv(ovH, boxH); showAdmin(); return; }
    boxH.innerHTML = `${xbtn}<h3>Masuk admin</h3><p>Masukkan password admin.</p>
      <input id="ap" type="password" autocomplete="current-password" placeholder="Password admin" style="margin:10px 0">
      <button class="btn" id="aGo" style="width:100%">Masuk</button><p id="aErr" style="color:#c43044;min-height:1.4em"></p>`;
    openOv(ovH, boxH); setTimeout(() => $("#ap").focus(), 300);
    const go = async () => {
      $("#aErr").textContent = "";
      try {
        const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#ap").value }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { $("#aErr").textContent = d.error || "Gagal masuk."; $("#ap").value = ""; return; }
        setTok(d.token); showAdmin();
      } catch (e) { $("#aErr").textContent = "Tidak bisa menghubungi server."; }
    };
    $("#aGo").onclick = go; $("#ap").onkeydown = e => { if (e.key === "Enter") go(); };
  };
})();
