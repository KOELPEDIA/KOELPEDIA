/* ===== GOSUPPLY PATCH v1 =====
   Pasang SETELAH script utama, tepat sebelum </body>:
   <script src="gosupply-patch.js"></script>
   (atau tempel isinya di dalam <script>…</script> baru)                       */
(()=>{
/* ---------- PENGATURAN ---------- */
const API_URL="";          // URL Web App Google Apps Script (berakhiran /exec). Kosong = mode lokal saja
const OCR_ON=true;         // baca nominal dari screenshot bukti bayar
const STRICT_BLOCK=true;   // true = pesanan DITOLAK bila nominal terbaca tapi tidak sama dengan total
/* -------------------------------- */

const SY=new Set(store.get("gs_synced",[]));
const sortO=l=>l.sort((a,b)=>new Date(b.date)-new Date(a.date));
const saveSY=()=>{try{localStorage.setItem("gs_synced",JSON.stringify([...SY]))}catch(e){}};
const rsz=(f,mx,q)=>new Promise(r=>resize(f,r,mx,q));
let db=null,ready=false,fl=false;

/* ===== 1. Penyimpanan permanen (IndexedDB + localStorage) ===== */
const idbOpen=()=>new Promise(res=>{try{const r=indexedDB.open("gosupply",1);
  r.onupgradeneeded=()=>r.result.createObjectStore("orders",{keyPath:"code"});
  r.onsuccess=()=>{db=r.result;res(1)};r.onerror=()=>res(0)}catch(e){res(0)}});
const idbAll=()=>new Promise(res=>{if(!db)return res([]);
  const q=db.transaction("orders").objectStore("orders").getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>res([])});
const _set=store.set;
store.set=(k,v)=>{
  if(k!=="gs_orders")return _set(k,v);
  if(db&&ready){try{const s=db.transaction("orders","readwrite").objectStore("orders");v.forEach(o=>s.put(o))}catch(e){}}
  const ok=_set(k,v.map(o=>({...o,proof:db&&/^data:/.test(o.proof||"")?"idb":o.proof})));
  if(!ok)_set(k,v.map(o=>({...o,proof:null})));
  setTimeout(flush,0);return 1};

/* gabungkan daftar pesanan (dari IndexedDB / server) ke daftar lokal */
function merge(list,remote){
  const m=new Map(orders.map(o=>[o.code,o]));
  list.forEach(r=>{
    if(remote){r.proof=r.proof||r.proofUrl||null;r.price=+r.price;SY.add(r.code)}
    const l=m.get(r.code);
    if(!l){m.set(r.code,r);return}
    if(remote)l.status=r.status;
    ["proof","ocr","phash","proofUrl"].forEach(k=>{if((!l[k]||l[k]==="idb")&&r[k])l[k]=r[k]});
  });
  orders=sortO([...m.values()]);orders.forEach(o=>{if(o.proof==="idb")o.proof=null});
  saveSY();store.set("gs_orders",orders);
}

/* ===== 2. Sinkron ke server (Google Sheets lewat Apps Script) ===== */
const rpc=async b=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),20000);
  try{const r=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(b),signal:c.signal});return await r.json()}
  finally{clearTimeout(t)}};
async function flush(){ // kirim pesanan baru yang belum tersimpan di server
  if(!API_URL||fl)return;fl=true;
  try{let ch=0;
    for(const o of orders.filter(o=>!SY.has(o.code))){
      const r=await rpc({action:"save",order:{...o,proof:/^data:/.test(o.proof||"")?o.proof:""}});
      if(r.ok){SY.add(o.code);if(r.proofUrl)o.proofUrl=r.proofUrl;if(r.status)o.status=r.status;ch=1}
    }
    saveSY();if(ch)store.set("gs_orders",orders);
  }catch(e){}
  fl=false}
async function syncStatus(){ // pelanggan: ambil status terbaru (Lunas/Selesai) dari server
  if(!API_URL||!orders.length)return;
  try{const r=await rpc({action:"status",codes:orders.map(o=>o.code)});if(!r.ok)return;let ch=0;
    orders.forEach(o=>{const s=r.map[o.code];if(s&&s!==o.status){o.status=s;ch=1}});
    if(ch)store.set("gs_orders",orders)}catch(e){}}

/* ===== 3. Baca nominal dari screenshot (OCR) ===== */
let tessP=null;
const loadTess=()=>tessP||(tessP=new Promise((res,rej)=>{const s=document.createElement("script");
  s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  s.onload=()=>res(window.Tesseract);s.onerror=()=>{tessP=null;rej()};document.head.appendChild(s)}));
const AMT=/(?:Rp\.?\s?)?(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|(?<![\d.,])\d{4,9}(?!\d)/gi;
function amounts(txt){
  txt=txt.replace(/(?<=[\d.,])[Oo]|[Oo](?=[\d.,]{2})/g,"0");
  const all=new Set(),withRp=new Set();
  for(const m of txt.matchAll(AMT)){
    let s=m[0];const hasRp=/^rp/i.test(s);s=s.replace(/^rp\.?\s?/i,"");
    if(/^\d{1,3}([.,]\d{3})+[.,]\d{1,2}$/.test(s))s=s.replace(/[.,]\d{1,2}$/,"");
    const n=+s.replace(/\D/g,"");
    if(n>=1000&&n<=99999999){all.add(n);if(hasRp)withRp.add(n)}
  }
  return{all,withRp};
}
function judge(txt,total){
  const{all,withRp}=amounts(txt);
  const state=all.has(total)?"ok":withRp.size?"bad":"unclear";
  return{state,total,found:[...(withRp.size?withRp:all)].slice(0,4),success:/berhasil|sukses|success|selesai|completed|terkirim/i.test(txt)};
}
async function readProof(dataUrl){const T=await loadTess();const{data}=await T.recognize(dataUrl,"eng");return data.text||""}

/* ===== 4. Checkout baru (bukti bayar dicek otomatis) ===== */
window.checkout=function(o){
  let pm=null,proof=null,ocr=null,busy=false;const isU=o.type==="undangan";
  boxP.innerHTML=`${xbtn}<h3>Pembayaran</h3>
   <div class="sum"><span>${esc(o.product)}</span><b>${rp(o.price)}</b></div>
   <p>Bayar lunas <b>tepat ${rp(o.price)}</b>. Nominal di screenshot bukti pembayaran dicocokkan otomatis, lalu admin memverifikasi.</p>
   <label class="fl" for="cn">Nama</label><input id="cn" autocomplete="name">
   <label class="fl" for="cw">Nomor WhatsApp</label><input id="cw" inputmode="tel" placeholder="08xxxxxxxxxx" autocomplete="tel">
   ${isU?`<label class="fl" for="cr">Request desain / tema</label><input id="cr" placeholder="Contoh: pernikahan, tema hijau sage">`:""}
   <span class="fl">Metode pembayaran</span>
   <div class="pmg" id="pmg">${PAYMENTS.map(m=>`<button type="button" class="pmc" data-m="${m.id}">${icoHTML(m)}<b>${m.n}</b></button>`).join("")}</div>
   <div id="pmi" class="pmi" style="display:none"></div>
   <label class="fl" for="cp">Bukti pembayaran (screenshot)</label><input id="cp" type="file" accept="image/*">
   <p id="ocrs" class="ocrs" aria-live="polite"></p>
   <button class="btn wa" id="cgo" style="width:100%;margin-top:16px" disabled>Kirim pesanan via WA</button>
   <p id="chint" style="font-size:.85rem"></p>`;
  const say=(t,c)=>{const e=$("#ocrs");e.textContent=t;e.style.color=c||"inherit"};
  const blocked=()=>STRICT_BLOCK&&ocr&&ocr.state==="bad";
  const val=()=>{const ok=$("#cn").value.trim().length>1&&$("#cw").value.replace(/\D/g,"").length>=9&&(!isU||$("#cr").value.trim())&&pm&&proof&&!busy&&!blocked();
    $("#cgo").disabled=!ok;
    $("#chint").textContent=ok?"":busy?"Sedang membaca bukti pembayaran…":blocked()?"Nominal bukti tidak sesuai total. Unggah bukti yang benar.":"Lengkapi nama, nomor WA, metode, dan bukti pembayaran.";return ok};
  boxP.oninput=val;val();
  $("#pmg").onclick=e=>{const b=e.target.closest(".pmc");if(!b)return;
    pm=PAYMENTS.find(m=>m.id===b.dataset.m);$$(".pmc",boxP).forEach(c=>c.classList.toggle("on",c===b));
    const i=$("#pmi");i.style.display="block";
    i.innerHTML=`<b>${pm.n}</b><br>${esc(pm.info)}${pm.qr?`<br><img src="${pm.qr}" alt="QR ${pm.n}" style="width:min(220px,100%);margin-top:8px;border-radius:10px">`:""}<br><b style="color:var(--ink)">Total: ${rp(o.price)}</b>`;
    gsap.from(i,{y:10,opacity:0,duration:.3});val()};
  $("#cp").onchange=async e=>{
    const f=e.target.files[0];proof=null;ocr=null;say("");
    if(!f){val();return}
    busy=true;val();say("Membaca bukti pembayaran…");
    try{
      proof=await rsz(f,900,.72);
      if(OCR_ON){
        const big=await rsz(f,1500,.9);
        try{ocr=judge(await readProof(big),o.price)}catch(err){ocr={state:"unclear",total:o.price,found:[]}}
      }else ocr={state:"unclear",total:o.price,found:[]};
    }catch(err){proof=null;say("Gambar tidak bisa dibaca. Coba screenshot lain.","#c43044")}
    busy=false;
    if(proof){
      if(ocr.state==="ok")say("✓ Nominal "+rp(o.price)+" terbaca dan sesuai total.","#13823f");
      else if(ocr.state==="bad")say((STRICT_BLOCK?"✗ ":"⚠ ")+"Nominal di bukti ("+ocr.found.map(rp).join(", ")+") tidak sama dengan total "+rp(o.price)+(STRICT_BLOCK?". Unggah bukti yang sesuai.":". Admin akan memeriksa manual."),"#c43044");
      else say("Nominal belum terbaca otomatis. Pesanan tetap bisa dikirim dan akan dicek manual oleh admin.","#9a7414");
    }
    val()};
  $("#cgo").onclick=()=>{if(!val())return;
    newOrder(o,{name:$("#cn").value.trim(),phone:$("#cw").value.trim(),note:isU?$("#cr").value.trim():"",pm,proof,ocr});closeOv(ovP,boxP)};
  openOv(ovP,boxP);
};

window.newOrder=function(o,c){
  const d=new Date(),code=`${o.pre}-${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}-${Math.random().toString(36).slice(2,6).toUpperCase()}${o.suf}`;
  const rec={code,pid:o.pid,product:o.product,type:o.type,price:o.price,buyer:c.name,phone:c.phone,note:c.note,pay:c.pm.n,
    proof:c.proof,phash:c.proof?String(hash(c.proof)):"",ocr:c.ocr,date:d.toISOString(),status:"Menunggu"};
  orders.unshift(rec);store.set("gs_orders",orders);
  toast("Invoice "+code+" dibuat");
  open(waLink(`Halo admin GOSUPPLY, saya sudah membayar:\nInvoice: ${code}\nProduk: ${o.product}\nTotal dibayar: ${rp(o.price)}\nMetode: ${c.pm.n}\nNama: ${c.name}\nWA: ${c.phone}`+(c.note?`\nRequest: ${c.note}`:"")+"\n\nBukti pembayaran saya lampirkan di chat ini."),"_blank");
};

/* ===== 5. Tampilan admin & riwayat ===== */
const bdg=o=>{const k=o.ocr;
  const b=!k?"":k.state==="ok"?`<span class="badge s-tersedia">Nominal cocok</span>`
    :k.state==="bad"?`<span class="badge s-habis">Nominal beda: ${esc((k.found||[]).map(rp).join(", "))}</span>`
    :`<span class="badge s-segera">Nominal tak terbaca</span>`;
  const dup=o.phash&&orders.some(x=>x.code!==o.code&&x.phash===o.phash);
  return b+(dup?` <span class="badge s-habis">Bukti sama dengan pesanan lain</span>`:"")};
const _row=window.orderRow;
window.orderRow=(o,a)=>{const h=_row(o,a);return a?h.replace("</code>","</code> "+bdg(o)):h};

const _adm=window.admin;
window.admin=function(){
  _adm();
  $("p",boxH).insertAdjacentHTML("afterend",`<p id="syn" style="font-size:.85rem"></p>`);
  const say=t=>{const e=$("#syn");if(e)e.innerHTML=t};
  if(!API_URL){say("Mode lokal: riwayat hanya ada di perangkat ini. Isi API_URL pada gosupply-patch.js agar pesanan semua pelanggan masuk ke sini.");return}
  say("Memuat riwayat dari server…");
  rpc({action:"list",key:PIN}).then(r=>{if(!r.ok)throw 0;merge(r.orders,true);
    say(`Tersinkron: ${orders.length} pesanan. <button class="mini" id="resync">Muat ulang</button>`);$("#q").oninput()})
   .catch(()=>say("Gagal terhubung ke server. Menampilkan data di perangkat ini."));
};
boxH.addEventListener("click",e=>{
  if(e.target.id==="resync")window.admin();
  if(e.target.dataset&&e.target.dataset.del){e.stopImmediatePropagation();toast("Pesanan tidak dihapus agar riwayat aman. Ubah status ke Batal.")}
},true);
boxH.addEventListener("change",e=>{const t=e.target;
  if(API_URL&&t.dataset&&t.dataset.c)
    rpc({action:"set_status",key:PIN,code:t.dataset.c,status:t.value}).then(r=>{if(!r.ok)throw 0})
     .catch(()=>toast("Gagal sinkron ke server. Status hanya tersimpan di perangkat ini."))
},true);

const _hist=$("#openHist").onclick;
$("#openHist").onclick=()=>{
  _hist();
  if(API_URL){
    $("#list").insertAdjacentHTML("beforebegin",`<details style="margin:10px 0"><summary style="cursor:pointer;font-weight:700">Pesanan tidak muncul? Pulihkan</summary>
      <input id="rc" placeholder="Kode invoice" style="margin:8px 0"><input id="rw" placeholder="Nomor WA saat memesan">
      <button class="btn sm" id="rgo" style="margin-top:8px">Pulihkan</button><p id="rm"></p></details>`);
    $("#rgo").onclick=async()=>{const m=$("#rm");m.textContent="Mencari…";
      try{const r=await rpc({action:"find",code:$("#rc").value.trim().toUpperCase(),phone:$("#rw").value});
        if(!r.ok){m.textContent="Tidak ditemukan. Cek kode invoice dan nomor WA.";return}
        merge([r.order],true);m.textContent="Pesanan dipulihkan.";$("#q").oninput()}
      catch(e){m.textContent="Gagal terhubung ke server."}};
    syncStatus().then(()=>{const q=$("#q");if(q&&q.oninput)q.oninput()});
  }
};

const css=document.createElement("style");
css.textContent=".ocrs{font-size:.88rem;font-weight:700;min-height:1.3em;margin:6px 0 0}[data-del]{display:none!important}";
document.head.appendChild(css);

/* ===== 6. Mulai: pulihkan dari IndexedDB, minta penyimpanan permanen, sinkron ===== */
(async()=>{
  await idbOpen();
  if(db)merge(await idbAll(),false);
  ready=true;store.set("gs_orders",orders);
  try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}
  flush();syncStatus();
  addEventListener("online",()=>{flush();syncStatus()});
})();
})();
