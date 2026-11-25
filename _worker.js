// GOSUPPLY – backend kecil untuk Cloudflare Pages (letakkan di root folder website, sejajar index.html)
// Binding yang dibutuhkan: KV (KV namespace), ADMIN_PASSWORD (secret), TOKEN_SECRET (secret)

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const safeEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const sha = async (s) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const sign = async (env, data) => {
  const k = await crypto.subtle.importKey("raw", enc.encode(env.TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
};
const makeToken = async (env) => { const exp = String(Date.now() + 7 * 864e5); return exp + "." + (await sign(env, exp)); };
const isAdmin = async (env, req) => {
  const [exp, sig] = (req.headers.get("Authorization") || "").replace(/^Bearer /, "").split(".");
  if (!exp || !sig || +exp < Date.now()) return false;
  return safeEq(sig, await sign(env, exp));
};
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    if (!p.startsWith("/api/") && !p.startsWith("/img/")) return env.ASSETS.fetch(req);
    if (!env.KV || !env.ADMIN_PASSWORD || !env.TOKEN_SECRET) return json({ error: "Binding KV / ADMIN_PASSWORD / TOKEN_SECRET belum diatur" }, 500);

    // Baca pengaturan (publik)
    if (p === "/api/config" && req.method === "GET") {
      return new Response((await env.KV.get("config")) || "{}", { headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
    }
    // Login admin
    if (p === "/api/login" && req.method === "POST") {
      let pw = ""; try { pw = String((await req.json()).password || ""); } catch (e) {}
      if (safeEq(await sha(pw), await sha(env.ADMIN_PASSWORD))) return json({ token: await makeToken(env) });
      await new Promise((r) => setTimeout(r, 800));
      return json({ error: "Password salah" }, 401);
    }
    // Simpan pengaturan (admin)
    if (p === "/api/config" && req.method === "PUT") {
      if (!(await isAdmin(env, req))) return json({ error: "Tidak diizinkan" }, 401);
      const txt = await req.text();
      if (txt.length > 200000) return json({ error: "Terlalu besar" }, 413);
      try { JSON.parse(txt); } catch (e) { return json({ error: "JSON tidak valid" }, 400); }
      await env.KV.put("config", txt);
      return json({ ok: true });
    }
    // Upload gambar (admin)
    if (p === "/api/upload" && req.method === "POST") {
      if (!(await isAdmin(env, req))) return json({ error: "Tidak diizinkan" }, 401);
      const type = (req.headers.get("Content-Type") || "").split(";")[0];
      if (!TYPES[type]) return json({ error: "Hanya jpg/png/webp" }, 415);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 1500000) return json({ error: "Gambar terlalu besar" }, 413);
      const name = crypto.randomUUID() + "." + TYPES[type];
      await env.KV.put("img:" + name, buf, { metadata: { type } });
      return json({ url: "/img/" + name });
    }
    // Tampilkan gambar (publik)
    if (p.startsWith("/img/") && req.method === "GET") {
      const name = p.slice(5);
      if (!/^[\w.-]+$/.test(name)) return new Response("Not found", { status: 404 });
      const { value, metadata } = await env.KV.getWithMetadata("img:" + name, "arrayBuffer");
      if (!value) return new Response("Not found", { status: 404 });
      return new Response(value, { headers: { "Content-Type": metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
    }
    return new Response("Not found", { status: 404 });
  },
};
