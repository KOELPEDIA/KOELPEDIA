/* ===== GOSUPPLY UI PATCH =====
   Pasang SETELAH gosupply-patch.js, sebelum </body>:
   <script src="gosupply-ui.js"></script>                                   */
(()=>{
/* ---------- 1. Scroll mouse di dashboard & jendela (Lenis memblokir wheel) ---------- */
$$(".ov").forEach(o=>o.setAttribute("data-lenis-prevent",""));

/* ---------- 2. Popup: gambar, aktif/nonaktif, ukuran kecil ---------- */
window.showPop=function(){
  const has=pop.tag||pop.title||pop.text||pop.code;
  if(!pop.img&&!has&&!pop.btn)return;
  boxPop.innerHTML=`${xbtn}
   ${pop.img?`<img class="pimg" id="pimg" src="${esc(pop.img)}" alt="${esc(pop.title||"Promo")}">`:""}
   ${has?`<div class="pbody">${pop.tag?`<span class="tg">${esc(pop.tag)}</span>`:""}${pop.title?`<h3>${esc(pop.title)}</h3>`:""}${pop.text?`<p>${esc(pop.text)}</p>`:""}
   ${pop.code?`<button class="pcode" id="pcode">${esc(pop.code)} <small>· salin</small></button>`:""}</div>`:""}
   ${pop.btn?`<button class="btn" id="pgo">${esc(pop.btn)}</button>`:""}`;
  openOv(ovPop,boxPop);
  const doAct=()=>{closePop();setTimeout(()=>{
    if(pop.act==="wa")open(waLink("Halo admin GOSUPPLY, saya mau pakai promo"+(pop.code?" "+pop.code:"")+"."),"_blank");
    else lenis.scrollTo(pop.act==="studio"?"#polaroid":"#produk")},350)};
  const c=$("#pcode");if(c)c.addEventListener("click",()=>{try{navigator.clipboard.writeText(pop.code)}catch(e){}toast("Kode disalin")});
  const g=$("#pgo");if(g)g.onclick=doAct;
  const im=$("#pimg");if(im){im.style.cursor="pointer";im.onclick=doAct}
};

function pimgUI(){
  const b=$("#pimgBox");if(!b)return;
  b.innerHTML=`<span class="fl">Gambar popup (opsional)</span>
   ${pop.img?`<img src="${esc(pop.img)}" alt="" style="max-width:120px;max-height:120px;object-fit:contain;border-radius:10px;margin:6px 0;display:block">`:""}
   <div class="row"><label class="mini">${pop.img?"Ganti":"Pilih"} gambar<input type="file" accept="image/*" data-pimg="up" hidden></label>
   ${pop.img?`<button type="button" class="mini" data-pimg="del">Hapus gambar</button>`:""}</div>
   <small style="color:var(--mut)">Kosongkan label, judul, isi pesan, dan teks tombol jika ingin popup berupa gambar saja.</small>`;
}
const _a=window.admin;
window.admin=function(){
  _a();
  const on=$('[data-po="on"]',boxH);if(!on)return;
  const lab=on.closest("label");if(lab&&lab.lastChild)lab.lastChild.textContent="Popup aktif";
  on.closest(".prow").querySelector(".ed").insertAdjacentHTML("afterbegin",`<div id="pimgBox"></div>`);
  pimgUI();
};
boxH.addEventListener("change",e=>{const t=e.target;
  if(t.dataset&&t.dataset.pimg==="up"&&t.files[0])
    resize(t.files[0],u=>{const old=pop.img;pop.img=u;
      if(!store.set("gs_popup",pop)){pop.img=old;toast("Penyimpanan penuh, pakai gambar lebih kecil");return}
      pimgUI();toast("Gambar popup disimpan")},720,.8)});
boxH.addEventListener("click",e=>{const t=e.target;
  if(t.dataset&&t.dataset.pimg==="del"){delete pop.img;store.set("gs_popup",pop);pimgUI();toast("Gambar popup dihapus")}});

/* ---------- 3. CSS: popup kecil + responsive semua layar HP ---------- */
const css=document.createElement("style");
css.textContent=`
.box{overscroll-behavior:contain}
.box.pop{width:min(320px,100%);max-height:min(84dvh,600px);padding:14px;text-align:center}
.pop .pimg{display:block;width:100%;height:auto;max-height:min(52dvh,380px);object-fit:contain;border-radius:14px;margin:0 auto}
.pop .pbody{padding:10px 6px 0}
.x+.pbody{padding-top:24px}
.pop .pbody h3{font-size:clamp(1.4rem,6vw,1.8rem);margin:8px 0 4px}
.pop .pbody p{font-size:.88rem;margin:4px 0}
.pop #pgo{width:100%;margin-top:12px}
footer{padding-bottom:calc(84px + env(safe-area-inset-bottom))}
.price{white-space:normal}
@media(max-width:600px){
  .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .card h3{font-size:1.1rem}
  .card .in{padding:10px 12px 14px}
  .thumb{font-size:2.6rem}
  .art{width:110px;font-size:3.2rem;right:-14px;opacity:.35}
  .sl p{font-size:.95rem}
  .box{border-radius:20px}
  .box h3{font-size:1.7rem}
  .row .btn{flex:1}
  .ord select{max-width:100%}
  .stage{padding:12px}
}
@media(max-width:380px){
  .logo{letter-spacing:.08em}
  .nv{gap:6px}
  .nv .btn{padding:.5em .7em;font-size:.74rem}
  .tab{padding:.5em 1em;font-size:.82rem}
  .pmg{grid-template-columns:1fr}
}
@media(max-width:340px){.grid{grid-template-columns:1fr}}
`;
document.head.appendChild(css);
})();
