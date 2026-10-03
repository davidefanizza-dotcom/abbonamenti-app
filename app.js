"use strict";

const C = window.CONFIG;
const API = `https://api.github.com/repos/${C.owner}/${C.repoDati}`;
const F_ABB = "abbonamenti.json";
const F_DIS = "dispositivi.json";
const LS = { token: "abb_token", cache: "abb_cache", endpoint: "abb_endpoint", nome: "abb_nome_dispositivo", tema: "abb_tema" };

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const FREQ = { mensile: "mensile", annuale: "annuale", settimanale: "settimanale" };
const TABS = ["home", "lista", "calendario", "statistiche", "impostazioni"];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pocoMoto = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const stato = {
  abbonamenti: [], online: false, caricato: false, inModifica: null, tab: null,
  filtro: { q: "", stato: "tutti", ordine: "rinnovo" },
  cal: { anno: 0, mese: 0, giorno: null },
  animare: new Set(TABS),
};

/* ---------- Date ---------- */
const pad = (n) => String(n).padStart(2, "0");
const isoUTC = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const oggiISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const utc = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const giorniDa = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const piuGiorni = (s, n) => isoUTC(utc(s) + n * 864e5);
function piuMesi(s, n, giornoRif) {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const fine = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(giornoRif || d, fine))}`;
}
const fmtData = (s) => { const [, m, d] = s.split("-").map(Number); return `${d} ${MESI[m - 1]}`; };

function quando(g) {
  if (g < 0) return "scaduto";
  if (g === 0) return "oggi";
  if (g === 1) return "domani";
  return `tra ${g} giorni`;
}

/* ---------- Calcoli ---------- */
function quotaMensile(a) {
  if (a.frequenza === "annuale") return a.costo / 12;
  if (a.frequenza === "settimanale") return (a.costo * 52) / 12;
  return a.costo;
}
// Tutte le date di addebito di un abbonamento attivo comprese tra da e a (incluse).
function addebiti(a, da, fino) {
  if (!a.attivo || !a.prossimoRinnovo) return [];
  const out = [];
  for (let k = 0, d = a.prossimoRinnovo; d <= fino && k < 800; k++) {
    if (d >= da) out.push(d);
    d = a.frequenza === "settimanale" ? piuGiorni(a.prossimoRinnovo, 7 * (k + 1))
      : piuMesi(a.prossimoRinnovo, (a.frequenza === "annuale" ? 12 : 1) * (k + 1), a.giornoRiferimento);
  }
  return out;
}
const attivi = () => stato.abbonamenti.filter((a) => a.attivo);
const totaleMese = () => attivi().reduce((s, a) => s + quotaMensile(a), 0);

// Colore stabile per categoria, leggibile in chiaro e scuro.
const PALETTE = ["#3f8f8a", "#d98a1a", "#6a6fd1", "#c4517a", "#4f9a4a", "#b0703c", "#3d7fbf", "#8a62b5"];
const coloreCat = (c) => { let h = 0; for (const ch of String(c || "Altro")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const nomeCat = (a) => a.categoria || "Altro";
function perCategoria() {
  const m = new Map();
  for (const a of attivi()) m.set(nomeCat(a), (m.get(nomeCat(a)) || 0) + quotaMensile(a));
  return [...m].sort((x, y) => y[1] - x[1]);
}

/* ---------- Base64 UTF-8 ---------- */
function b64enc(testo) {
  const byte = new TextEncoder().encode(testo);
  let bin = "";
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode.apply(null, byte.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64dec(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/* ---------- GitHub ---------- */
const token = () => localStorage.getItem(LS.token) || "";

async function gh(percorso, opzioni = {}) {
  const r = await fetch(API + percorso, {
    ...opzioni,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opzioni.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) {
    const e = new Error(messaggioErrore(r.status));
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? null : r.json();
}

function messaggioErrore(status) {
  if (status === 401) return "Il token non è valido o è scaduto. Inseriscine uno nuovo in Impostazioni.";
  if (status === 403) return "Il token non ha i permessi necessari (Contents e Actions in lettura e scrittura).";
  if (status === 404) return "Repo dei dati non trovato: controlla che il token abbia accesso al repo.";
  if (status === 409 || status === 422) return "I dati sono cambiati da un altro dispositivo. Riprova.";
  return `GitHub ha risposto con errore ${status}.`;
}

async function leggi(file) {
  const j = await gh(`/contents/${file}`);
  return { dati: JSON.parse(b64dec(j.content)), sha: j.sha };
}

// Rilegge sempre il file prima di scrivere, così PC e iPhone non si sovrascrivono.
async function modifica(file, cambia, messaggio) {
  for (let tentativo = 0; tentativo < 3; tentativo++) {
    const { dati, sha } = await leggi(file);
    const nuovi = cambia(dati);
    try {
      await gh(`/contents/${file}`, {
        method: "PUT",
        body: JSON.stringify({ message: messaggio, content: b64enc(JSON.stringify(nuovi, null, 2) + "\n"), sha }),
      });
      return nuovi;
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && tentativo < 2) continue;
      throw e;
    }
  }
}

/* ---------- Caricamento ---------- */
function setSync(classe, testo) { const s = $("#sync"); s.className = "sync " + classe; s.querySelector("span").textContent = testo; }

async function carica() {
  const cache = localStorage.getItem(LS.cache);
  if (cache && !stato.caricato) { stato.abbonamenti = JSON.parse(cache); stato.caricato = true; disegna(); }
  if (!token()) {
    stato.online = false; mostraBanner(""); setSync("ko", "Non collegato");
    if (!stato.abbonamenti.length) vai("impostazioni");
    disegna();
    return false;
  }
  setSync("", "Sincronizzo…");
  try {
    const { dati } = await leggi(F_ABB);
    stato.abbonamenti = dati;
    stato.online = true;
    stato.caricato = true;
    localStorage.setItem(LS.cache, JSON.stringify(dati));
    mostraBanner("");
    setSync("live", "Sincronizzato");
  } catch (e) {
    stato.online = false;
    mostraBanner(e.status ? e.message : "Senza connessione: vedi i dati dell'ultima apertura, in sola lettura.");
    setSync("ko", e.status ? "Errore" : "Offline");
  }
  disegna();
  return stato.online;
}

function mostraBanner(testo) {
  const b = $("#banner");
  b.textContent = testo;
  b.hidden = !testo;
}

/* ---------- Disegno ---------- */
function disegna() {
  if (!stato.tab) return;
  const anima = stato.animare.has(stato.tab);
  stato.animare.delete(stato.tab);
  ({ home: disegnaHome, lista: disegnaLista, calendario: disegnaCal, statistiche: disegnaStat, impostazioni: () => {} })[stato.tab](anima);
}

function classeVoce(a, data) {
  if (!a.attivo) return "pausa";
  const g = giorniDa(oggiISO(), data);
  return g <= 0 ? "oggi" : g <= 7 ? "vicino" : "";
}
function voceHTML(a, data = a.prossimoRinnovo, i = 0) {
  const g = giorniDa(oggiISO(), data);
  const [, m, d] = data.split("-").map(Number);
  const cat = [a.categoria, FREQ[a.frequenza]].filter(Boolean).join(" · ");
  return `<li style="--i:${i}" class="${a.id === stato.nuovo ? "nuova" : ""}"><button class="voce ${classeVoce(a, data)}" data-id="${esc(a.id)}"
    aria-label="${esc(a.nome)}, ${eur.format(a.costo)} ${FREQ[a.frequenza]}, ${a.attivo ? "rinnovo " + quando(g) : "in pausa"}">
    <span class="talloncino" aria-hidden="true"><span class="giorno">${d}</span><span class="mese">${MESI[m - 1]}</span></span>
    <span style="min-width:0"><span class="nome">${esc(a.nome)}</span><span class="dettaglio"><i style="--c:${coloreCat(nomeCat(a))}"></i>${esc(cat)}</span></span>
    <span class="prezzo"><span class="importo">${eur.format(a.costo)}</span><span class="stato">${a.attivo ? quando(g) : "in pausa"}</span></span>
  </button></li>`;
}
function collegaVoci(box) {
  box.querySelectorAll(".voce").forEach((b) => b.addEventListener("click", () => apriModulo(stato.abbonamenti.find((x) => x.id === b.dataset.id))));
}

function contaSu(el, a, fmt) {
  const da = Number(el.dataset.v || 0);
  el.dataset.v = a;
  if (pocoMoto() || da === a) { el.textContent = fmt(a); return; }
  const t0 = performance.now(), dur = 800;
  const passo = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(da + (a - da) * e);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

/* ---------- Home ---------- */
function disegnaHome(anima) {
  const ora = new Date().getHours();
  $("#saluto").textContent = ora < 6 ? "Buonanotte" : ora < 13 ? "Buongiorno" : ora < 18 ? "Buon pomeriggio" : "Buonasera";
  const mese = totaleMese();
  contaSu($("#tot-mese"), mese, (v) => eur.format(v));
  contaSu($("#tot-anno"), mese * 12, (v) => eur0.format(v));
  contaSu($("#tot-giorno"), (mese * 12) / 365, (v) => eur.format(v));
  contaSu($("#tot-attivi"), attivi().length, (v) => String(Math.round(v)));

  // prossimo addebito
  const oggi = oggiISO();
  const prossimo = attivi().filter((a) => a.prossimoRinnovo >= oggi).sort((a, b) => a.prossimoRinnovo.localeCompare(b.prossimoRinnovo))[0];
  const nx = $("#next");
  nx.hidden = !prossimo;
  if (prossimo) {
    const g = giorniDa(oggi, prossimo.prossimoRinnovo), [, m, d] = prossimo.prossimoRinnovo.split("-").map(Number);
    nx.className = "card next " + classeVoce(prossimo, prossimo.prossimoRinnovo);
    nx.innerHTML = `<span class="talloncino"><span class="giorno">${d}</span><span class="mese">${MESI[m - 1]}</span></span>
      <div style="min-width:0"><span class="lbl">Prossimo addebito</span><b class="nome">${esc(prossimo.nome)}</b><span class="stato">${eur.format(prossimo.costo)}</span></div>
      <div class="cnt">${g === 0 ? `<b>oggi</b>` : `<b class="num">${g}</b><span>${g === 1 ? "giorno" : "giorni"}</span>`}</div>`;
    nx.onclick = () => apriModulo(prossimo);
  }

  // in arrivo nei prossimi 30 giorni
  const fino = piuGiorni(oggi, 30), arrivo = [];
  for (const a of attivi()) for (const d of addebiti(a, oggi, fino)) arrivo.push({ a, d });
  arrivo.sort((x, y) => x.d.localeCompare(y.d));
  $("#arrivo-info").textContent = arrivo.length ? `30 giorni · ${eur.format(arrivo.reduce((s, x) => s + x.a.costo, 0))}` : "30 giorni";
  const box = $("#arrivo");
  box.classList.toggle("still", !anima);
  box.innerHTML = arrivo.length ? arrivo.slice(0, 6).map((x, i) => voceHTML(x.a, x.d, i)).join("")
    : `<li class="vuoto-s">${stato.abbonamenti.length ? "Nessun addebito nei prossimi 30 giorni." : "Nessun abbonamento ancora: tocca + per aggiungere il primo."}</li>`;
  collegaVoci(box);

  // categorie
  const cats = perCategoria(), max = Math.max(1, ...cats.map((c) => c[1]));
  const cb = $("#cats");
  cb.classList.toggle("still", !anima);
  cb.innerHTML = cats.length ? cats.slice(0, 5).map(([c, v], i) => `<div class="cat" style="--c:${coloreCat(c)}"><b><i></i>${esc(c)}</b><span class="v">${eur.format(v)}</span>
      <div class="bar"><i style="width:${(v / max) * 100}%;animation-delay:${i * 60}ms"></i></div></div>`).join("")
    : `<p class="vuoto-s" style="margin:0;color:var(--muted)">Le categorie compariranno qui.</p>`;
}

/* ---------- Elenco ---------- */
function disegnaLista(anima) {
  const f = stato.filtro, q = f.q.trim().toLowerCase();
  const cerca = stato.abbonamenti.filter((a) => !q || [a.nome, a.categoria, a.nota, FREQ[a.frequenza]].join(" ").toLowerCase().includes(q));
  const conta = { tutti: cerca.length, attivi: cerca.filter((a) => a.attivo).length, pausa: cerca.filter((a) => !a.attivo).length };
  $$("#seg-stato button").forEach((b) => { b.querySelector(".n").textContent = conta[b.dataset.v]; });
  segSync($("#seg-stato"));
  let lista = cerca.filter((a) => f.stato === "tutti" || (f.stato === "attivi" ? a.attivo : !a.attivo));
  lista.sort((a, b) =>
    f.ordine === "costo" ? quotaMensile(b) - quotaMensile(a)
      : f.ordine === "nome" ? a.nome.localeCompare(b.nome, "it")
        : a.attivo !== b.attivo ? (a.attivo ? -1 : 1) : a.prossimoRinnovo.localeCompare(b.prossimoRinnovo));
  const mese = lista.filter((a) => a.attivo).reduce((s, a) => s + quotaMensile(a), 0);
  $("#lista-info").textContent = `${lista.length} ${lista.length === 1 ? "abbonamento" : "abbonamenti"} · ${eur.format(mese)} al mese`;
  const box = $("#lista");
  box.classList.toggle("still", !anima);
  box.innerHTML = lista.map((a, i) => voceHTML(a, a.prossimoRinnovo, i)).join("");
  collegaVoci(box);
  const v = $("#vuoto");
  v.hidden = lista.length > 0;
  if (!lista.length) {
    v.innerHTML = stato.abbonamenti.length
      ? `<h3>Nessun risultato</h3><p>Nessun abbonamento corrisponde alla ricerca.</p><button class="secondario sm" id="azzera">Azzera filtri</button>`
      : `<h3>Ancora vuoto</h3><p>Aggiungi il primo abbonamento per vedere scadenze e totali.</p><button class="primario sm" id="vuoto-add">Aggiungi abbonamento</button>`;
    $("#azzera")?.addEventListener("click", () => { stato.filtro = { ...stato.filtro, q: "", stato: "tutti" }; $("#q").value = ""; $$("#seg-stato button").forEach((b) => b.classList.toggle("on", b.dataset.v === "tutti")); disegnaLista(true); });
    $("#vuoto-add")?.addEventListener("click", aggiungi);
  }
}
let qT;
$("#q").addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(() => { stato.filtro.q = e.target.value; disegnaLista(false); }, 100); });
function legaSeg(sel, fn) {
  $(sel).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $$(sel + " button").forEach((x) => x.classList.toggle("on", x === b));
    segSync($(sel));
    fn(b.dataset.v);
  });
}
legaSeg("#seg-stato", (v) => { stato.filtro.stato = v; disegnaLista(true); });
legaSeg("#seg-ordine", (v) => { stato.filtro.ordine = v; disegnaLista(true); });

/* ---------- Calendario ---------- */
function disegnaCal(anima) {
  const { anno, mese } = stato.cal;
  const primo = new Date(anno, mese, 1);
  $("#cal-titolo").textContent = primo.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const inizio = (primo.getDay() + 6) % 7, giorniMese = new Date(anno, mese + 1, 0).getDate();
  const da = `${anno}-${pad(mese + 1)}-01`, fino = `${anno}-${pad(mese + 1)}-${pad(giorniMese)}`;
  const perGiorno = {};
  for (const a of attivi()) for (const d of addebiti(a, da, fino)) (perGiorno[d] ||= []).push(a);
  const oggi = oggiISO();
  let html = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((w) => `<div class="wd">${w}</div>`).join("");
  const celle = Math.ceil((inizio + giorniMese) / 7) * 7;
  for (let i = 0; i < celle; i++) {
    const dt = new Date(anno, mese, 1 - inizio + i);
    const k = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, lst = perGiorno[k] || [];
    const tot = lst.reduce((s, a) => s + a.costo, 0);
    html += `<button class="day ${dt.getMonth() !== mese ? "altro" : ""} ${k === oggi ? "oggi-d" : ""} ${stato.cal.giorno === k ? "sel" : ""}" data-d="${k}" style="animation-delay:${i * 10}ms" ${dt.getMonth() !== mese ? "tabindex=-1" : ""}>
      <span class="n">${dt.getDate()}</span>
      ${lst.length ? `<span class="tot">${tot >= 100 ? Math.round(tot) : tot.toFixed(0)}€</span><span class="dots">${lst.slice(0, 3).map((a) => `<i style="--c:${coloreCat(nomeCat(a))}"></i>`).join("")}</span>` : `<span class="dots"></span>`}
    </button>`;
  }
  const cal = $("#cal");
  cal.classList.toggle("still", !anima);
  cal.innerHTML = html;
  cal.querySelectorAll(".day:not(.altro)").forEach((b) => b.addEventListener("click", () => { stato.cal.giorno = stato.cal.giorno === b.dataset.d ? null : b.dataset.d; disegnaCal(false); }));

  const tutti = Object.entries(perGiorno).flatMap(([d, l]) => l.map((a) => ({ a, d }))).sort((x, y) => x.d.localeCompare(y.d));
  const totMese = tutti.reduce((s, x) => s + x.a.costo, 0);
  $("#cal-info").textContent = `${tutti.length} addebiti · ${eur.format(totMese)} questo mese`;
  const mostra = stato.cal.giorno ? tutti.filter((x) => x.d === stato.cal.giorno) : tutti;
  $("#cal-lista-t").innerHTML = stato.cal.giorno ? `${fmtData(stato.cal.giorno)} <small>${eur.format(mostra.reduce((s, x) => s + x.a.costo, 0))}</small>`
    : `Addebiti del mese <small>${eur.format(totMese)}</small>`;
  $("#cal-tutto").hidden = !stato.cal.giorno;
  const box = $("#cal-lista");
  box.innerHTML = mostra.length ? mostra.map((x, i) => voceHTML(x.a, x.d, i)).join("") : `<li class="vuoto-s">Nessun addebito.</li>`;
  collegaVoci(box);
}
function calSposta(n) { const d = new Date(stato.cal.anno, stato.cal.mese + n, 1); stato.cal = { anno: d.getFullYear(), mese: d.getMonth(), giorno: null }; disegnaCal(true); }
$("#cal-prev").addEventListener("click", () => calSposta(-1));
$("#cal-next").addEventListener("click", () => calSposta(1));
$("#cal-oggi").addEventListener("click", () => { const d = new Date(); stato.cal = { anno: d.getFullYear(), mese: d.getMonth(), giorno: oggiISO() }; disegnaCal(true); });
$("#cal-tutto").addEventListener("click", () => { stato.cal.giorno = null; disegnaCal(false); });
// swipe orizzontale sul calendario per cambiare mese
(() => {
  let x0 = null;
  $("#cal").addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  $("#cal").addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) calSposta(dx < 0 ? 1 : -1); });
})();

/* ---------- Statistiche ---------- */
function disegnaStat(anima) {
  const att = attivi(), mese = totaleMese();
  const caro = [...att].sort((a, b) => quotaMensile(b) - quotaMensile(a))[0];
  const kp = [
    [eur.format(mese * 12), "spesa all'anno"],
    [eur.format(att.length ? mese / att.length : 0), "media per abbonamento"],
    [eur.format((mese * 12) / 52), "alla settimana"],
    [caro ? esc(caro.nome) : "—", caro ? `il più caro · ${eur.format(quotaMensile(caro))}/mese` : "il più caro"],
  ];
  $("#kpis").innerHTML = kp.map(([v, l]) => `<div class="card kpi ${anima ? "" : "still"}" ${anima ? "" : 'style="animation:none"'}><b>${v}</b><span>${l}</span></div>`).join("");

  // grafico addebiti 12 mesi
  const ora = new Date(), mesi = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(ora.getFullYear(), ora.getMonth() + i, 1);
    const da = i === 0 ? oggiISO() : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    const fino = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())}`;
    let tot = 0, n = 0;
    for (const a of att) { const k = addebiti(a, da, fino).length; tot += k * a.costo; n += k; }
    mesi.push({ lbl: MESI[d.getMonth()], tot, n, anno: d.getFullYear() });
  }
  const totAnno = mesi.reduce((s, m) => s + m.tot, 0);
  $("#chart-tot").textContent = eur.format(totAnno);
  const W = 640, H = 200, pl = 34, pr = 6, pt = 12, pb = 24, mx = Math.max(1, ...mesi.map((m) => m.tot)), media = totAnno / 12;
  const passo = (W - pl - pr) / 12, bw = Math.min(28, passo * 0.56);
  const y = (v) => pt + (H - pb - pt) * (1 - v / mx);
  $("#chart").innerHTML = `<svg class="svgc ${anima ? "" : "still"}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Addebiti per mese">
    ${[0, 0.5, 1].map((f) => `<line class="g" x1="${pl}" x2="${W - pr}" y1="${y(mx * f)}" y2="${y(mx * f)}"/><text class="lb" x="${pl - 6}" y="${y(mx * f) + 4}" text-anchor="end">${Math.round(mx * f)}</text>`).join("")}
    ${mesi.map((m, i) => `<rect class="b ${m.tot > media * 1.4 ? "hot" : ""} ${m.tot ? "" : "dim"}" x="${pl + i * passo + (passo - bw) / 2}" y="${y(m.tot)}" width="${bw}" height="${Math.max(2, H - pb - y(m.tot))}" rx="6" style="animation-delay:${i * 45}ms"/>`).join("")}
    ${mesi.map((m, i) => `<text class="lb" x="${pl + i * passo + passo / 2}" y="${H - 6}" text-anchor="middle">${m.lbl}</text>`).join("")}
    ${mesi.map((m, i) => `<rect class="hit" x="${pl + i * passo}" y="0" width="${passo}" height="${H}" data-i="${i}"/>`).join("")}
  </svg>`;
  const tip = $("#tip"), boxC = $("#chart").parentElement;
  $("#chart").querySelectorAll(".hit").forEach((h) => {
    const mostra = (e) => {
      const m = mesi[h.dataset.i], r = boxC.getBoundingClientRect(), p = e.touches ? e.touches[0] : e;
      tip.innerHTML = `<b>${m.lbl} ${m.anno}</b> · ${m.n} addebit${m.n === 1 ? "o" : "i"} · ${eur.format(m.tot)}`;
      tip.style.left = Math.max(80, Math.min(r.width - 80, p.clientX - r.left)) + "px"; tip.style.top = (p.clientY - r.top) + "px"; tip.classList.add("on");
    };
    h.addEventListener("pointermove", mostra); h.addEventListener("pointerdown", mostra);
    h.addEventListener("pointerleave", () => tip.classList.remove("on"));
  });

  // ciambella categorie
  const cats = perCategoria(), R = 58, circ = 2 * Math.PI * R;
  let acc = 0;
  $("#donut").innerHTML = cats.length ? `<svg viewBox="0 0 150 150" class="${anima ? "" : "still"}">
      <circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--line)" stroke-width="18"/>
      ${cats.map(([c, v]) => { const l = (v / mese) * circ, s = `<circle class="s" cx="75" cy="75" r="${R}" stroke="${coloreCat(c)}" stroke-dasharray="${Math.max(0, l - 2)} ${circ}" stroke-dashoffset="${-acc}"/>`; acc += l; return s; }).join("")}
      <text x="75" y="74" text-anchor="middle" class="ctr"><tspan style="font-family:var(--display);font-weight:300;font-size:20px;fill:var(--text)">${eur0.format(mese)}</tspan></text>
      <text x="75" y="92" text-anchor="middle" style="font-size:10px;fill:var(--muted)">al mese</text>
    </svg>
    <ul class="legend">${cats.map(([c, v], i) => `<li style="--c:${coloreCat(c)};animation-delay:${i * 40}ms"><i></i><span>${esc(c)}</span><span class="v">${Math.round((v / mese) * 100)}%</span></li>`).join("")}</ul>`
    : `<p style="color:var(--muted);margin:0">Nessun abbonamento attivo.</p>`;

  // classifica
  const top = [...att].sort((a, b) => quotaMensile(b) - quotaMensile(a)).slice(0, 5), tmax = Math.max(1, ...top.map(quotaMensile));
  const tb = $("#top");
  tb.classList.toggle("still", !anima);
  tb.innerHTML = top.map((a, i) => `<li data-id="${esc(a.id)}" style="animation-delay:${i * 50}ms;--c:${coloreCat(nomeCat(a))}"><b>${esc(a.nome)}</b><span class="v">${eur.format(quotaMensile(a))}</span>
    <div class="bar"><i style="width:${(quotaMensile(a) / tmax) * 100}%;animation-delay:${i * 60}ms"></i></div></li>`).join("") || `<li style="color:var(--muted)">—</li>`;
  tb.querySelectorAll("li[data-id]").forEach((li) => li.addEventListener("click", () => apriModulo(stato.abbonamenti.find((x) => x.id === li.dataset.id))));
}

/* ---------- Tab e navigazione ---------- */
let navT = null;
function vai(tab, storia = true) {
  if (!TABS.includes(tab)) tab = "home";
  if (tab === stato.tab) { window.scrollTo({ top: 0, behavior: pocoMoto() ? "auto" : "smooth" }); return; }
  const avanti = stato.tab ? TABS.indexOf(tab) > TABS.indexOf(stato.tab) : true;
  const prima = stato.tab ? $(`#p-${stato.tab}`) : null;
  stato.tab = tab;
  stato.animare.add(tab);
  $$("#tabbar button").forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
  muoviThumb(true);
  $("#btn-aggiungi").classList.toggle("via", tab === "impostazioni");
  try { history[storia ? "pushState" : "replaceState"](null, "", "#" + tab); } catch {}

  // la pagina attuale scivola via, poi entra la nuova con gli elementi a cascata
  const mostra = () => {
    navT = null;
    $$(".page").forEach((x) => x.classList.remove("on", "in-r", "in-l", "out-r", "out-l"));
    const p = $(`#p-${tab}`);
    p.classList.add("on");
    if (prima && !pocoMoto()) { void p.offsetWidth; p.classList.add(avanti ? "in-r" : "in-l"); }
    window.scrollTo(0, 0);
    if (tab === "impostazioni") preparaImpostazioni();
    disegna();
    requestAnimationFrame(() => $$(".seg").forEach((s) => segSync(s, true)));
  };
  clearTimeout(navT);
  if (prima && prima.classList.contains("on") && !pocoMoto()) {
    $$(".page").forEach((x) => { if (x !== prima) x.classList.remove("on"); });
    prima.classList.remove("in-r", "in-l", "out-r", "out-l");
    void prima.offsetWidth;
    prima.classList.add(avanti ? "out-l" : "out-r");
    navT = setTimeout(mostra, 170);
  } else mostra();
}
$$("#tabbar button").forEach((b) => b.addEventListener("click", () => vai(b.dataset.tab)));
$$("[data-vai]").forEach((b) => b.addEventListener("click", () => vai(b.dataset.vai)));
window.addEventListener("popstate", () => vai(location.hash.slice(1), false));

let thumbPronto = false, thumbT = null;
function muoviThumb(liquido) {
  const b = $("#tabbar button.on"), t = $("#tb-thumb");
  if (!b) return;
  const x1 = b.offsetLeft, w1 = b.offsetWidth;
  clearTimeout(thumbT);
  if (!thumbPronto || !liquido || pocoMoto()) {
    t.classList.add("noanim"); t.classList.remove("stretch");
    t.style.width = w1 + "px"; t.style.setProperty("--x", x1 + "px");
    thumbPronto = true;
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.remove("noanim")));
    return;
  }
  // effetto goccia: si allunga fino a coprire la nuova tab, poi si ritira su di essa
  const x0 = parseFloat(t.style.getPropertyValue("--x")) || 0, w0 = t.offsetWidth;
  const sx = Math.min(x0, x1), ex = Math.max(x0 + w0, x1 + w1);
  t.classList.add("stretch");
  t.style.setProperty("--x", sx + "px"); t.style.width = (ex - sx) + "px";
  thumbT = setTimeout(() => {
    t.classList.remove("stretch");
    t.style.setProperty("--x", x1 + "px"); t.style.width = w1 + "px";
  }, 200);
}
window.addEventListener("resize", () => { muoviThumb(false); $$(".seg").forEach((s) => segSync(s, true)); });

// cursore scorrevole dei controlli segmentati
function segSync(seg, senzaAnim) {
  let t = seg.querySelector(":scope > .thumb");
  if (!t) { t = document.createElement("i"); t.className = "thumb noanim"; seg.prepend(t); senzaAnim = true; }
  const b = seg.querySelector("button.on");
  if (!b || !b.offsetWidth) { t.style.opacity = "0"; return; }
  if (senzaAnim) t.classList.add("noanim");
  t.style.opacity = "1";
  t.style.width = b.offsetWidth + "px";
  t.style.setProperty("--x", b.offsetLeft + "px");
  if (senzaAnim) requestAnimationFrame(() => requestAnimationFrame(() => t.classList.remove("noanim")));
}

/* ---------- Pulsante + ---------- */
async function aggiungi() {
  if (stato.online) return apriModulo(null);
  if (!token()) { toast("Prima collega GitHub: incolla il token qui sotto."); vai("impostazioni"); setTimeout(() => $("#in-token").focus(), 300); return; }
  toast("Mi ricollego a GitHub…");
  if (await carica()) apriModulo(null);
  else toast($("#banner").textContent || "Senza connessione non puoi aggiungere abbonamenti.");
}
$("#btn-aggiungi").addEventListener("click", aggiungi);
$("#btn-aggiorna").addEventListener("click", async (e) => {
  const s = e.currentTarget.querySelector("svg");
  if (!pocoMoto()) s.animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
  stato.animare.add(stato.tab);
  if (await carica()) toast("Dati aggiornati");
});

/* ---------- Modulo (pannello dal basso) ---------- */
const form = $("#modulo"), sheet = $("#sheet");

function apriModulo(a) {
  if (!a && !stato.online) return aggiungi();
  stato.inModifica = a || null;
  form.reset();
  $("#modulo-errore").hidden = true;
  $("#modulo-titolo").textContent = a ? "Modifica" : "Nuovo abbonamento";
  $("#btn-elimina").hidden = !a;
  const cat = [...new Set(stato.abbonamenti.map((x) => x.categoria).filter(Boolean))];
  $("#categorie").innerHTML = cat.map((c) => `<option value="${esc(c)}">`).join("");
  if (a) {
    for (const k of ["nome", "categoria", "costo", "frequenza", "prossimoRinnovo", "preavvisoGiorni", "nota"]) form.elements[k].value = a[k] ?? "";
    form.elements.attivo.checked = a.attivo;
  } else {
    form.elements.prossimoRinnovo.value = oggiISO();
    form.elements.preavvisoGiorni.value = 3;
  }
  const solaLettura = !stato.online;
  for (const el of form.elements) el.disabled = solaLettura;
  if (solaLettura) mostraErrore("Senza connessione non puoi modificare.");
  aggiornaEquiv();
  sheet.style.removeProperty("--dy");
  sheet.classList.add("on"); sheet.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("on"); document.body.classList.add("dim");
  sheet.scrollTop = 0;
  if (!a && matchMedia("(hover: hover)").matches) setTimeout(() => form.elements.nome.focus(), 250);
}
function chiudiModulo() {
  sheet.classList.remove("on", "drag"); sheet.setAttribute("aria-hidden", "true"); sheet.style.removeProperty("--dy");
  $("#scrim").classList.remove("on"); document.body.classList.remove("dim");
  document.activeElement?.blur?.();
}
$$("[data-chiudi]").forEach((b) => b.addEventListener("click", chiudiModulo));
$("#scrim").addEventListener("click", chiudiModulo);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.classList.contains("on")) chiudiModulo(); });
// trascina giù per chiudere
(() => {
  let y0 = null;
  const g = $("#grab");
  g.addEventListener("pointerdown", (e) => { y0 = e.clientY; g.setPointerCapture(e.pointerId); sheet.classList.add("drag"); });
  g.addEventListener("pointermove", (e) => { if (y0 == null) return; sheet.style.setProperty("--dy", Math.max(0, e.clientY - y0) + "px"); });
  const fine = (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; sheet.classList.remove("drag"); if (dy > 110) chiudiModulo(); else sheet.style.removeProperty("--dy"); };
  g.addEventListener("pointerup", fine); g.addEventListener("pointercancel", fine);
})();

function aggiornaEquiv() {
  const c = Number(String(form.elements.costo.value).replace(",", "."));
  const f = form.elements.frequenza.value;
  if (!(c > 0)) { $("#equiv").textContent = ""; return; }
  const m = quotaMensile({ costo: c, frequenza: f });
  $("#equiv").textContent = f === "mensile" ? `≈ ${eur.format(m * 12)} all'anno` : `≈ ${eur.format(m)} al mese · ${eur.format(m * 12)} all'anno`;
}
form.elements.costo.addEventListener("input", aggiornaEquiv);
form.elements.frequenza.addEventListener("change", aggiornaEquiv);

function mostraErrore(t) {
  const e = $("#modulo-errore");
  e.textContent = t; e.hidden = !t;
  if (t && !pocoMoto()) { e.style.animation = "none"; void e.offsetWidth; e.style.animation = ""; }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = form.elements;
  const nome = f.nome.value.trim();
  const costo = Number(String(f.costo.value).replace(",", "."));
  const data = f.prossimoRinnovo.value;
  const attivo = f.attivo.checked;
  if (!nome) return mostraErrore("Inserisci il nome.");
  if (!(costo >= 0) || f.costo.value === "") return mostraErrore("Inserisci un costo valido.");
  if (!data) return mostraErrore("Inserisci la data del prossimo rinnovo.");
  if (attivo && data < oggiISO()) return mostraErrore("La data è passata: inserisci il prossimo rinnovo.");

  const vecchio = stato.inModifica;
  const record = {
    id: vecchio?.id || crypto.randomUUID().slice(0, 8),
    nome,
    categoria: f.categoria.value.trim(),
    costo: Math.round(costo * 100) / 100,
    frequenza: f.frequenza.value,
    giornoRiferimento: vecchio && vecchio.prossimoRinnovo === data ? vecchio.giornoRiferimento : Number(data.slice(8)),
    prossimoRinnovo: data,
    preavvisoGiorni: Math.max(0, parseInt(f.preavvisoGiorni.value || "0", 10)),
    attivo,
    nota: f.nota.value.trim(),
    ultimoAvvisoPreavviso: vecchio?.ultimoAvvisoPreavviso || null,
    ultimoAvvisoGiorno: vecchio?.ultimoAvvisoGiorno || null,
  };

  const btn = $("#btn-salva");
  btn.disabled = true; btn.textContent = "Salvo…"; $("#btn-salva-h").disabled = true;
  try {
    stato.abbonamenti = await modifica(F_ABB, (lista) => {
      const i = lista.findIndex((x) => x.id === record.id);
      if (i >= 0) lista[i] = { ...lista[i], ...record }; else lista.push(record);
      return lista;
    }, `${vecchio ? "Modifica" : "Aggiunge"} ${nome}`);
    localStorage.setItem(LS.cache, JSON.stringify(stato.abbonamenti));
    chiudiModulo();
    // si anima solo la voce nuova, il resto della lista resta fermo
    stato.nuovo = record.id;
    setTimeout(() => { disegna(); setTimeout(() => { stato.nuovo = null; }, 100); }, 250);
    toast(vecchio ? "Modifiche salvate" : `${nome} aggiunto`);
  } catch (e) {
    mostraErrore(e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Salva"; $("#btn-salva-h").disabled = false;
  }
});

$("#btn-elimina").addEventListener("click", async () => {
  const a = stato.inModifica;
  if (!a || !confirm(`Eliminare ${a.nome}?`)) return;
  try {
    stato.abbonamenti = await modifica(F_ABB, (lista) => lista.filter((x) => x.id !== a.id), `Elimina ${a.nome}`);
    localStorage.setItem(LS.cache, JSON.stringify(stato.abbonamenti));
    chiudiModulo();
    disegna();
    toast(`${a.nome} eliminato`);
  } catch (e) { mostraErrore(e.message); }
});

/* ---------- Toast ---------- */
function toast(msg) {
  const box = $("#toasts"), el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 2) box.firstChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 260); }, 2600);
}

/* ---------- Tema ---------- */
function applicaTema(t) {
  if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
  $$("#seg-tema button").forEach((b) => b.classList.toggle("on", b.dataset.v === (t || "")));
  segSync($("#seg-tema"));
}
applicaTema(localStorage.getItem(LS.tema) || "");
legaSeg("#seg-tema", (v) => { v ? localStorage.setItem(LS.tema, v) : localStorage.removeItem(LS.tema); applicaTema(v); });

/* ---------- Impostazioni ---------- */
function esito(id, testo, ok) { const e = $(id); e.textContent = testo; e.className = "esito " + (ok ? "ok" : "ko"); }

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const nomePredefinito = () => (isIOS() ? "iPhone" : /Windows/.test(navigator.userAgent) ? "PC" : "Dispositivo");

async function preparaImpostazioni() {
  $("#in-token").value = token();
  $("#in-dispositivo").value = localStorage.getItem(LS.nome) || nomePredefinito();
  $("#esito-token").textContent = "";
  $("#esito-notifiche").textContent = "";
  const pushOk = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !standalone()) {
    $("#spiega-notifiche").textContent = "Su iPhone le notifiche funzionano solo dall'app installata: in Safari tocca Condividi, poi Aggiungi a Home, e apri l'app da lì.";
  } else if (!pushOk) {
    $("#spiega-notifiche").textContent = "Questo browser non supporta le notifiche push.";
  }
  $("#btn-notifiche").disabled = !pushOk || !token();
  $("#btn-prova").disabled = !token();
  await disegnaDispositivi();
}

$("#btn-token").addEventListener("click", async () => {
  const t = $("#in-token").value.trim();
  if (!t) return esito("#esito-token", "Incolla il token.", false);
  localStorage.setItem(LS.token, t);
  try {
    await leggi(F_ABB);
    esito("#esito-token", "Collegato al repo dei dati.", true);
    $("#btn-notifiche").disabled = !("PushManager" in window);
    $("#btn-prova").disabled = false;
    carica();
    disegnaDispositivi();
  } catch (e) {
    esito("#esito-token", e.message || "Connessione non riuscita.", false);
  }
});

function chiaveVapid(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

$("#btn-notifiche").addEventListener("click", async () => {
  const btn = $("#btn-notifiche");
  btn.disabled = true;
  try {
    const permesso = await Notification.requestPermission();
    if (permesso !== "granted") throw new Error("Notifiche bloccate. Consentile nelle impostazioni del browser o di iOS.");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiaveVapid(C.vapidPublicKey) });
    const j = sub.toJSON();
    const nome = $("#in-dispositivo").value.trim() || nomePredefinito();
    localStorage.setItem(LS.nome, nome);
    await modifica(F_DIS, (lista) => {
      const i = lista.findIndex((d) => d.subscription?.endpoint === j.endpoint);
      const rec = { id: i >= 0 ? lista[i].id : crypto.randomUUID().slice(0, 8), nome, subscription: j, aggiunto: i >= 0 ? lista[i].aggiunto : oggiISO() };
      if (i >= 0) lista[i] = rec; else lista.push(rec);
      return lista;
    }, `Registra dispositivo ${nome}`);
    localStorage.setItem(LS.endpoint, j.endpoint);
    esito("#esito-notifiche", "Notifiche attive su questo dispositivo.", true);
    disegnaDispositivi();
  } catch (e) {
    esito("#esito-notifiche", e.message || "Attivazione non riuscita.", false);
  } finally {
    btn.disabled = false;
  }
});

$("#btn-prova").addEventListener("click", async () => {
  const btn = $("#btn-prova");
  btn.disabled = true;
  try {
    await gh(`/actions/workflows/${C.workflow}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: "main", inputs: { prova: "true" } }),
    });
    esito("#esito-notifiche", "Richiesta inviata: la notifica arriva su tutti i dispositivi entro un paio di minuti.", true);
  } catch (e) {
    esito("#esito-notifiche", e.message, false);
  } finally {
    setTimeout(() => (btn.disabled = false), 5000);
  }
});

async function disegnaDispositivi() {
  const ul = $("#dispositivi");
  ul.innerHTML = "";
  if (!token()) return;
  try {
    const { dati } = await leggi(F_DIS);
    const mio = localStorage.getItem(LS.endpoint);
    if (!dati.length) { ul.innerHTML = `<li><small>Nessun dispositivo registrato.</small></li>`; return; }
    for (const d of dati) {
      const li = document.createElement("li");
      li.innerHTML = `<span><span class="n"></span><small></small></span><button>Rimuovi</button>`;
      li.querySelector(".n").textContent = d.nome + (d.subscription?.endpoint === mio ? " (questo)" : "");
      li.querySelector("small").textContent = `Aggiunto il ${d.aggiunto}`;
      li.querySelector("button").addEventListener("click", async () => {
        if (!confirm(`Rimuovere ${d.nome}? Non riceverà più notifiche.`)) return;
        await modifica(F_DIS, (lista) => lista.filter((x) => x.id !== d.id), `Rimuove dispositivo ${d.nome}`);
        disegnaDispositivi();
      });
      ul.appendChild(li);
    }
  } catch { ul.innerHTML = `<li><small>Elenco non disponibile.</small></li>`; }
}

$("#btn-csv").addEventListener("click", () => {
  const q = (v) => { v = String(v ?? ""); return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const righe = [["Nome", "Categoria", "Costo", "Frequenza", "Quota mensile", "Prossimo rinnovo", "Attivo", "Nota"].join(";"),
    ...stato.abbonamenti.map((a) => [a.nome, a.categoria, String(a.costo).replace(".", ","), a.frequenza, quotaMensile(a).toFixed(2).replace(".", ","), a.prossimoRinnovo, a.attivo ? "sì" : "no", a.nota].map(q).join(";"))];
  const url = URL.createObjectURL(new Blob(["﻿" + righe.join("\n")], { type: "text/csv" }));
  const link = document.createElement("a"); link.href = url; link.download = `abbonamenti-${oggiISO()}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- Avvio ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
document.addEventListener("visibilitychange", () => { if (!document.hidden && !sheet.classList.contains("on")) carica(); });
{
  const d = new Date();
  stato.cal = { anno: d.getFullYear(), mese: d.getMonth(), giorno: null };
}
vai(location.hash.slice(1) || "home", false);
document.fonts?.ready.then(() => { muoviThumb(false); $$(".seg").forEach((s) => segSync(s, true)); });
carica();
