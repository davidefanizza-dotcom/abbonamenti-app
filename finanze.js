"use strict";
/* Finanze (da EasyWallet): conti, movimenti, salvadanaio, trasferimenti, spese fisse.
   Due file nel repo dei dati: finanze.json (conti, spese fisse, preferenze) e
   movimenti.json (tutti i movimenti). Importi sempre positivi, il segno lo dà il tipo. */

MOD.finanze = { file: "finanze.json", vuoto: () => ({ conti: [], fisse: [], stipendio: { attivo: false, giorno: 27 } }), nome: "finanze" };
MOD.movimenti = { file: "movimenti.json", vuoto: () => [], nome: "movimenti" };
for (const k of ["finanze", "movimenti"]) {
  try { dati[k] = JSON.parse(localStorage.getItem("abb_dati_" + k)) ?? MOD[k].vuoto(); } catch { dati[k] = MOD[k].vuoto(); }
  coda[k] = [];
}

/* ---------- Categorie ---------- */
const CAT = {
  "Alimentari": ["🛒", "#16A34A"], "Ristorazione": ["🍽️", "#DC2626"], "Trasporti": ["🚆", "#0EA5E9"], "Carburante": ["⛽", "#D97706"],
  "Abbonamenti": ["📺", "#6366F1"], "Salute": ["💊", "#EC4899"], "Casa & Utenze": ["🏠", "#14B8A6"], "Shopping": ["🛍️", "#8B5CF6"],
  "Svago": ["🎬", "#EC4899"], "Educazione": ["📚", "#D97706"], "Viaggi": ["✈️", "#0EA5E9"], "Prelievo ATM": ["🏧", "#D97706"],
  "Tasse & Tributi": ["📋", "#DC2626"], "Bonifico": ["🏦", "#6366F1"], "Altro": ["📌", "#9CA3AF"],
  "Stipendio": ["💼", "#059669"], "Freelance": ["🧑‍💻", "#059669"], "Rimborso": ["🔄", "#0EA5E9"], "Investimenti": ["📈", "#059669"],
  "Regalo": ["🎁", "#EC4899"], "Entrata": ["💚", "#059669"], "Trasferimento": ["⇄", "#6366F1"],
};
const CAT_USCITA = ["Alimentari", "Ristorazione", "Trasporti", "Carburante", "Abbonamenti", "Salute", "Casa & Utenze", "Shopping", "Svago", "Educazione", "Viaggi", "Prelievo ATM", "Tasse & Tributi", "Bonifico", "Altro"];
const CAT_ENTRATA = ["Stipendio", "Freelance", "Rimborso", "Investimenti", "Regalo", "Entrata"];
const catInfo = (c) => CAT[c] || ["🏷️", "#9CA3AF"];
const TRASF = (c) => c === "Trasferimento" || c === "Trasferito";

// Categoria automatica dalla descrizione (regole di EasyWallet, la prima che combacia vince)
const REGOLE = [
  ["Stipendio", "entrata", ["busta paga", "stipendio", "tredicesima", "pensione"]],
  ["Rimborso", "entrata", ["rimborso", "accredito tramite carta"]],
  ["Entrata", "entrata", ["bonifico sepa", "top-up", "topup", "accredito", "dalla banca", "da una persona"]],
  ["Trasferimento", "uscita", ["giroconto", "bonifico istantaneo da voi", "bonifici in uscita", "revolut"]],
  ["Prelievo ATM", "uscita", ["prelievo", "atm withdrawal"]],
  ["Abbonamenti", "uscita", ["netflix", "spotify", "apple.com", "dazn", "disney", "amazon prime", "playstation", "xbox", "youtube", "google", "icloud", "polizza"]],
  ["Casa & Utenze", "uscita", ["affitto", "condominio", "bolletta", "enel", "eni gas", "hera", "acea", "a2a", "fastweb", "tim ", "vodafone", "wind ", "iliad", "rata mutuo", "canone"]],
  ["Tasse & Tributi", "uscita", ["imposte", "bollo", "tassa", "tributo", "pagopa", "f24", "assicurazione auto"]],
  ["Alimentari", "uscita", ["eurospin", "conad", "carrefour", "lidl", "esselunga", "penny", "despar", "pam ", "iper", "coop", "supermercato", "md "]],
  ["Ristorazione", "uscita", ["pizzeria", "ristorante", "trattoria", "osteria", "bar ", "caffè", "caffe", "gelateria", "just eat", "deliveroo", "glovo", "mcdonald", "burger"]],
  ["Trasporti", "uscita", ["trenitalia", "italo", "ryanair", "easyjet", "wizz", "flixbus", "parcheggio", "parking", "autostrad", "telepass", "uber", "taxi"]],
  ["Carburante", "uscita", ["benzina", "metano", "benzinaio", "q8", "agip", "tamoil", "esso", "eni "]],
  ["Salute", "uscita", ["farmacia", "medic", "clinica", "dentista", "ottico", "ospedale"]],
  ["Shopping", "uscita", ["amazon", "zalando", "shein", "zara", "h&m", "primark", "decathlon", "ikea", "mediaworld", "unieuro"]],
  ["Svago", "uscita", ["cinema", "teatro", "museo", "concerto", "ticketone"]],
];
function categoriaAuto(descr, tipo) {
  const d = " " + String(descr || "").toLowerCase() + " ";
  for (const [cat, t, parole] of REGOLE) if (t === tipo && parole.some((p) => d.includes(p))) return cat;
  return tipo === "entrata" ? "Entrata" : "Altro";
}

/* ---------- Calcoli (in centesimi per evitare errori di arrotondamento) ---------- */
const cent = (n) => Math.round(Number(n || 0) * 100);
const segno = (m) => (m.tipo === "entrata" ? 1 : -1);
const somma = (l) => l.reduce((s, m) => s + segno(m) * cent(m.importo), 0) / 100;
const totale = (l, tipo) => l.filter((m) => m.tipo === tipo).reduce((s, m) => s + cent(m.importo), 0) / 100;
const conti = () => [...dati.finanze.conti].sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));
const contoDi = (id) => dati.finanze.conti.find((c) => c.id === id);
const fuoriPiggy = () => dati.movimenti.filter((m) => !m.salvadanaio);
const saldoConto = (id) => somma(fuoriPiggy().filter((m) => m.contoId === id));
const eurS = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + eur.format(Math.abs(n));

// Periodo: mese di calendario oppure da stipendio a stipendio
const fin = { offset: 0, vista: "panoramica", q: "", tipo: "tutti", conto: "", cat: "", tuttoIlPeriodo: false };
function giornoPaga(anno, mese) { const g = Number(dati.finanze.stipendio?.giorno) || 27; return Math.min(g, new Date(anno, mese + 1, 0).getDate()); }
function periodo(off = fin.offset) {
  const ora = new Date(), a = ora.getFullYear(), m = ora.getMonth() + off;
  const iso = (y, mm, d) => { const t = new Date(y, mm, d); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  if (dati.finanze.stipendio?.attivo) {
    // il periodo "di questo mese" va dal giorno dopo lo stipendio scorso allo stipendio di questo mese
    let base = m;
    if (off === 0 && ora.getDate() > giornoPaga(a, ora.getMonth())) base = m + 1;
    const fine = new Date(a, base, 1), ini = new Date(a, base - 1, 1);
    const da = iso(ini.getFullYear(), ini.getMonth(), giornoPaga(ini.getFullYear(), ini.getMonth()) + 1);
    const fino = iso(fine.getFullYear(), fine.getMonth(), giornoPaga(fine.getFullYear(), fine.getMonth()));
    return { da, fino, label: `💼 ${fmtData(da)} → ${fmtData(fino)}` };
  }
  const t = new Date(a, m, 1);
  return { da: iso(t.getFullYear(), t.getMonth(), 1), fino: iso(t.getFullYear(), t.getMonth() + 1, 0), label: t.toLocaleDateString("it-IT", { month: "long", year: "numeric" }) };
}
const nelPeriodo = (l, p) => l.filter((m) => m.data >= p.da && m.data <= p.fino);

/* ---------- Spese fisse: generazione automatica, con recupero dei mesi saltati ---------- */
function generaFisse(forza) {
  if (!stato.online || !dati.finanze.fisse.length) return 0;
  const ora = new Date(), mc = `${ora.getFullYear()}-${pad(ora.getMonth() + 1)}`;
  const nuovi = [], aggiornate = {};
  for (const f of dati.finanze.fisse) {
    if (!f.attiva) continue;
    // si parte dal mese dopo l'ultimo generato (al massimo 12 mesi indietro), altrimenti da questo mese
    let [y, m] = (f.ultimo || mc).split("-").map(Number);
    if (f.ultimo) m += 1;
    let ultimo = f.ultimo;
    for (let n = 0; n < 12; n++) {
      const t = new Date(y, m - 1, 1), chiave = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
      if (chiave > mc) break;
      const giorno = Math.min(Number(f.giorno) || 1, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate());
      const data = `${chiave}-${pad(giorno)}`;
      if (chiave === mc && ora.getDate() < giorno && !forza) break;
      if (!dati.movimenti.some((x) => x.fissa === f.id && x.data === data)) {
        nuovi.push({ id: nuovoId(), contoId: f.contoId, data, descr: f.name, importo: f.amount, tipo: f.type, cat: f.category, salvadanaio: false, nota: "📅 Spesa fissa automatica", fissa: f.id });
      }
      ultimo = chiave; m += 1;
    }
    if (ultimo !== f.ultimo) aggiornate[f.id] = ultimo;
  }
  if (nuovi.length) op("movimenti", (d) => [...d, ...nuovi.filter((x) => !d.some((y) => y.fissa === x.fissa && y.data === x.data))], "Genera spese fisse", false);
  if (Object.keys(aggiornate).length) op("finanze", (d) => ({ ...d, fisse: d.fisse.map((f) => (aggiornate[f.id] ? { ...f, ultimo: aggiornate[f.id] } : f)) }), "Aggiorna spese fisse", false);
  return nuovi.length;
}

/* ---------- Rendering ---------- */
const RIGA_IC = (m) => { const [ic, col] = TRASF(m.cat) ? ["⇄", "#6366F1"] : catInfo(m.cat); return `<span class="m-ic" style="--c:${col}">${ic}</span>`; };
function rigaMov(m, mostraConto = true) {
  const c = contoDi(m.contoId);
  return `<li><button class="mov" data-id="${esc(m.id)}">
    ${RIGA_IC(m)}
    <span class="m-t"><b>${esc(m.descr || m.cat)}</b><small>${esc(m.cat)}${mostraConto && c ? ` · <i style="--c:${c.color}"></i>${esc(c.name)}` : ""}${m.nota ? ` · ${esc(m.nota.slice(0, 28))}` : ""}</small></span>
    <span class="m-v ${m.tipo}">${m.salvadanaio ? "🐷 " : ""}${eurS(segno(m) * Number(m.importo))}</span>
  </button></li>`;
}
function timeline(lista, max = 400) {
  const perGiorno = new Map();
  for (const m of [...lista].sort((a, b) => b.data.localeCompare(a.data) || 0).slice(0, max)) {
    if (!perGiorno.has(m.data)) perGiorno.set(m.data, []);
    perGiorno.get(m.data).push(m);
  }
  const oggi = oggiISO(), ieri = giorniFa(1);
  return [...perGiorno].map(([d, l]) => {
    const tit = d === oggi ? "Oggi" : d === ieri ? "Ieri" : new Date(d + "T12:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "short" });
    const net = somma(l.filter((m) => !m.salvadanaio));
    return `<li class="g-day"><div class="g-h"><span>${tit}</span><span class="${net >= 0 ? "pos" : "neg"}">${eurS(net)}</span></div><ul class="g-l">${l.map((m) => rigaMov(m)).join("")}</ul></li>`;
  }).join("");
}
function collegaMov(box) { box.querySelectorAll(".mov").forEach((b) => b.addEventListener("click", () => apriMov(dati.movimenti.find((m) => m.id === b.dataset.id)))); }

function disegnaFinanze(anima) {
  const p = periodo();
  $("#fin-periodo").textContent = fin.vista === "movimenti" && fin.tuttoIlPeriodo ? "Tutti i movimenti" : p.label;
  $$("#seg-fin button").forEach((b) => b.classList.toggle("on", b.dataset.v === fin.vista));
  segSync($("#seg-fin"));
  $("#fin-mese").hidden = fin.vista === "conti" || fin.vista === "fisse" || fin.vista === "salvadanaio";
  const corpo = $("#fin-corpo");
  corpo.classList.toggle("still", !anima);
  if (!dati.finanze.conti.length && fin.vista !== "conti") {
    corpo.innerHTML = `<div class="card vuoto"><h3>Nessun conto ancora</h3><p>Crea il primo conto (banca, carta, contanti…) e inizia a registrare entrate e uscite.</p><button class="primario sm" id="fin-primo">Crea il primo conto</button></div>`;
    $("#fin-primo").addEventListener("click", () => apriConto(null));
    return;
  }
  ({ panoramica: vistaPanoramica, movimenti: vistaMovimenti, salvadanaio: vistaSalvadanaio, fisse: vistaFisse, conti: vistaConti })[fin.vista](corpo, p);
}

function vistaPanoramica(corpo, p) {
  const tutti = fuoriPiggy(), nelMese = nelPeriodo(tutti, p).filter((m) => !TRASF(m.cat));
  const saldo = somma(tutti), ent = totale(nelMese, "entrata"), usc = totale(nelMese, "uscita"), piggy = dati.movimenti.filter((m) => m.salvadanaio).reduce((s, m) => s + cent(m.importo), 0) / 100;
  // ultimi 6 periodi per il grafico
  const serie6 = Array.from({ length: 6 }, (_, i) => { const q = periodo(fin.offset - 5 + i), l = nelPeriodo(tutti, q).filter((m) => !TRASF(m.cat)); return { e: totale(l, "entrata"), u: totale(l, "uscita"), lbl: new Date(q.fino + "T12:00").toLocaleDateString("it-IT", { month: "short" }) }; });
  const mx = Math.max(1, ...serie6.flatMap((s) => [s.e, s.u]));
  const perCat = new Map();
  for (const m of nelMese.filter((m) => m.tipo === "uscita")) perCat.set(m.cat, (perCat.get(m.cat) || 0) + cent(m.importo));
  const top = [...perCat].sort((a, b) => b[1] - a[1]).slice(0, 6), tmax = Math.max(1, ...top.map((t) => t[1]));
  const recenti = [...dati.movimenti].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 6);
  corpo.innerHTML = `
    <section class="card fin-hero">
      <div><span class="lbl">Saldo totale</span><span class="cifra ${saldo < 0 ? "neg" : ""}">${eur.format(saldo)}</span></div>
      <div class="fin-kpi">
        <div><b class="num pos">${eur.format(ent)}</b><span>entrate</span></div>
        <div><b class="num neg">${eur.format(usc)}</b><span>uscite</span></div>
        <div><b class="num ${ent - usc >= 0 ? "pos" : "neg"}">${eurS(ent - usc)}</b><span>risparmio</span></div>
        <div><b class="num">🐷 ${eur.format(piggy)}</b><span>salvadanaio</span></div>
      </div>
    </section>
    <section class="conti-strip">${conti().map((c, i) => `<button class="card conto-c" data-id="${esc(c.id)}" style="--c:${c.color};--i:${i}"><span class="cc-ic">${esc(c.icon || "🏦")}</span><span class="cc-n">${esc(c.name)}</span><b class="num ${saldoConto(c.id) < 0 ? "neg" : ""}">${eur.format(saldoConto(c.id))}</b></button>`).join("")}<button class="card conto-c nuovo" id="fin-nuovo-conto"><span class="cc-ic">＋</span><span class="cc-n">Nuovo conto</span></button></section>
    <section class="card fin-trend">
      <div class="sec-h"><h2>Andamento <small>ultimi 6 mesi</small></h2><span class="leg"><i class="pos"></i>entrate <i class="neg"></i>uscite</span></div>
      <div class="barre">${serie6.map((s, i) => `<div class="b-col" title="${s.lbl}: +${eur.format(s.e)} / −${eur.format(s.u)}"><div class="b-pair"><i class="pos" style="height:${(s.e / mx) * 100}%;animation-delay:${i * 50}ms"></i><i class="neg" style="height:${(s.u / mx) * 100}%;animation-delay:${i * 50 + 25}ms"></i></div><span>${s.lbl}</span></div>`).join("")}</div>
    </section>
    <section class="card fin-cat">
      <div class="sec-h"><h2>Dove vanno i soldi <small>${esc(p.label)}</small></h2></div>
      ${top.length ? `<div class="cats">${top.map(([c, v], i) => `<div class="cat" style="--c:${catInfo(c)[1]}"><b>${catInfo(c)[0]} ${esc(c)}</b><span class="v">${eur.format(v / 100)}</span><div class="bar"><i style="width:${(v / tmax) * 100}%;animation-delay:${i * 60}ms"></i></div></div>`).join("")}</div>` : `<p class="vuoto-s" style="margin:0;color:var(--muted)">Nessuna uscita in questo periodo.</p>`}
    </section>
    <section class="card fin-rec">
      <div class="sec-h"><h2>Ultimi movimenti</h2><button class="link" id="fin-tutti">Tutti</button></div>
      <ul class="g-l">${recenti.map((m) => rigaMov(m)).join("") || `<li class="vuoto-s">Nessun movimento. Tocca + per aggiungerne uno.</li>`}</ul>
    </section>`;
  corpo.querySelectorAll(".conto-c[data-id]").forEach((b) => b.addEventListener("click", () => { fin.conto = b.dataset.id; fin.vista = "movimenti"; disegnaFinanze(true); }));
  $("#fin-nuovo-conto").addEventListener("click", () => apriConto(null));
  $("#fin-tutti").addEventListener("click", () => { fin.vista = "movimenti"; disegnaFinanze(true); });
  collegaMov(corpo);
}

function vistaMovimenti(corpo, p) {
  const q = fin.q.trim().toLowerCase();
  let l = fin.tuttoIlPeriodo ? dati.movimenti : nelPeriodo(dati.movimenti, p);
  l = l.filter((m) => (!fin.conto || m.contoId === fin.conto) && (fin.tipo === "tutti" || m.tipo === fin.tipo) && (!fin.cat || m.cat === fin.cat)
    && (!q || `${m.descr} ${m.cat} ${m.nota || ""}`.toLowerCase().includes(q)));
  const cats = [...new Set(dati.movimenti.map((m) => m.cat))].sort((a, b) => a.localeCompare(b, "it"));
  const reali = l.filter((m) => !m.salvadanaio);
  corpo.innerHTML = `
    <div class="search lg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="fin-q" placeholder="Cerca descrizione, categoria, nota…" value="${esc(fin.q)}" autocomplete="off"></div>
    <div class="fin-filtri">
      <div class="seg lg mini" id="seg-tipo"><button data-v="tutti">Tutti</button><button data-v="entrata">Entrate</button><button data-v="uscita">Uscite</button></div>
      <select class="fsel lg" id="fin-conto" aria-label="Conto"><option value="">Tutti i conti</option>${conti().map((c) => `<option value="${esc(c.id)}" ${c.id === fin.conto ? "selected" : ""}>${esc(c.icon || "")} ${esc(c.name)}</option>`).join("")}</select>
      <select class="fsel lg" id="fin-cat" aria-label="Categoria"><option value="">Tutte le categorie</option>${cats.map((c) => `<option ${c === fin.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <label class="cx-tog"><input type="checkbox" class="tgm" id="fin-tutto" ${fin.tuttoIlPeriodo ? "checked" : ""}> Tutti i mesi</label>
    </div>
    <div class="fin-tot card">
      <div><span>Saldo</span><b class="num ${somma(reali) < 0 ? "neg" : "pos"}">${eurS(somma(reali))}</b></div>
      <div><span>Entrate</span><b class="num pos">${eur.format(totale(reali, "entrata"))}</b></div>
      <div><span>Uscite</span><b class="num neg">${eur.format(totale(reali, "uscita"))}</b></div>
      <div><span>Movimenti</span><b class="num">${l.length}</b></div>
    </div>
    <ul class="tl-fin">${timeline(l) || `<li class="card vuoto"><h3>Nessun movimento</h3><p>${dati.movimenti.length ? "Niente corrisponde ai filtri." : "Tocca + per registrare la prima entrata o uscita."}</p></li>`}</ul>`;
  $$("#seg-tipo button").forEach((b) => b.classList.toggle("on", b.dataset.v === fin.tipo));
  requestAnimationFrame(() => segSync($("#seg-tipo"), true));
  legaSeg("#seg-tipo", (v) => { fin.tipo = v; disegnaFinanze(false); });
  let t; $("#fin-q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { fin.q = e.target.value; const pos = e.target.selectionStart; disegnaFinanze(false); const i = $("#fin-q"); i.focus(); i.setSelectionRange(pos, pos); }, 200); });
  $("#fin-conto").addEventListener("change", (e) => { fin.conto = e.target.value; disegnaFinanze(false); });
  $("#fin-cat").addEventListener("change", (e) => { fin.cat = e.target.value; disegnaFinanze(false); });
  $("#fin-tutto").addEventListener("change", (e) => { fin.tuttoIlPeriodo = e.target.checked; disegnaFinanze(false); });
  collegaMov(corpo);
}

function vistaSalvadanaio(corpo) {
  const l = dati.movimenti.filter((m) => m.salvadanaio), tot = l.reduce((s, m) => s + cent(m.importo), 0) / 100;
  corpo.innerHTML = `
    <section class="card piggy"><span class="pg-ic">🐷</span><div><span class="lbl">Totale accantonato</span><span class="cifra">${eur.format(tot)}</span><small>${plurale(l.length, "accantonamento", "accantonamenti")}</small></div></section>
    <p class="spiega" style="padding:0 4px">I movimenti segnati "salvadanaio" non contano nei saldi e nei totali del mese: restano solo qui.</p>
    <ul class="tl-fin">${timeline(l) || `<li class="card vuoto"><h3>Salvadanaio vuoto</h3><p>Quando registri un movimento attiva "Metti nel salvadanaio".</p></li>`}</ul>`;
  collegaMov(corpo);
}

function vistaFisse(corpo) {
  const l = [...dati.finanze.fisse].sort((a, b) => a.giorno - b.giorno);
  const mese = l.filter((f) => f.attiva).reduce((s, f) => s + (f.type === "uscita" ? -1 : 1) * cent(f.amount), 0) / 100;
  corpo.innerHTML = `
    <div class="fin-azioni"><span class="spiega">${l.length ? `${plurale(l.filter((f) => f.attiva).length, "attiva", "attive")} · ${eurS(mese)} al mese` : "Affitto, rate, bollette: vengono registrate da sole ogni mese."}</span><span class="spacer"></span>
      <button class="secondario sm" id="fisse-genera" ${l.length ? "" : "hidden"}>⚡ Genera ora</button><button class="primario sm" id="fisse-nuova">+ Spesa fissa</button></div>
    <ul class="fisse-l">${l.map((f, i) => { const c = contoDi(f.contoId); return `<li class="card fissa ${f.attiva ? "" : "off"}" data-id="${esc(f.id)}" style="--i:${i}">
      <span class="m-ic" style="--c:${catInfo(f.category)[1]}">${catInfo(f.category)[0]}</span>
      <span class="m-t"><b>${esc(f.name)}</b><small>giorno ${f.giorno} · ${esc(f.category)}${c ? ` · ${esc(c.name)}` : ""} · ${f.ultimo ? `ultima ${f.ultimo}` : "mai generata"}</small></span>
      <span class="m-v ${f.type}">${eurS((f.type === "uscita" ? -1 : 1) * Number(f.amount))}</span>
      <input type="checkbox" class="tgm" ${f.attiva ? "checked" : ""} aria-label="Attiva">
    </li>`; }).join("") || ""}</ul>`;
  $("#fisse-nuova").addEventListener("click", () => apriFissa(null));
  $("#fisse-genera").addEventListener("click", () => { const n = generaFisse(true); disegnaFinanze(false); toast(n ? `${plurale(n, "movimento creato", "movimenti creati")}` : "Niente da generare: è tutto già registrato."); });
  corpo.querySelectorAll(".fissa").forEach((li) => {
    const id = li.dataset.id;
    li.querySelector(".tgm").addEventListener("click", (e) => e.stopPropagation());
    li.querySelector(".tgm").addEventListener("change", (e) => { op("finanze", (d) => ({ ...d, fisse: d.fisse.map((f) => f.id === id ? { ...f, attiva: e.target.checked } : f) }), "Attiva/sospende spesa fissa", false); li.classList.toggle("off", !e.target.checked); });
    li.addEventListener("click", () => apriFissa(dati.finanze.fisse.find((f) => f.id === id)));
  });
}

function vistaConti(corpo) {
  const l = conti();
  corpo.innerHTML = `
    <div class="fin-azioni"><span class="spiega">${plurale(l.length, "conto", "conti")} · saldo totale ${eur.format(somma(fuoriPiggy()))}</span><span class="spacer"></span><button class="primario sm" id="conti-nuovo">+ Nuovo conto</button></div>
    <ul class="conti-l">${l.map((c, i) => { const n = dati.movimenti.filter((m) => m.contoId === c.id).length; return `<li class="card conto-r" data-id="${esc(c.id)}" style="--c:${c.color};--i:${i}">
      <span class="cc-ic">${esc(c.icon || "🏦")}</span>
      <span class="m-t"><b>${esc(c.name)}</b><small>${plurale(n, "movimento", "movimenti")}</small></span>
      <b class="num ${saldoConto(c.id) < 0 ? "neg" : ""}">${eur.format(saldoConto(c.id))}</b>
      <span class="ord"><button class="x su" aria-label="Sposta su" ${i ? "" : "disabled"}>▲</button><button class="x giu" aria-label="Sposta giù" ${i < l.length - 1 ? "" : "disabled"}>▼</button></span>
    </li>`; }).join("")}</ul>
    <section class="card blocco">
      <h2>Ciclo stipendio</h2>
      <p class="spiega">Se attivo, il "mese" va da uno stipendio al successivo invece che dal primo all'ultimo giorno.</p>
      <div class="set-row"><span>Usa il ciclo stipendio</span><input type="checkbox" class="tgm" id="stip-on" ${dati.finanze.stipendio?.attivo ? "checked" : ""}></div>
      <div class="set-row"><span>Giorno dello stipendio</span><input type="number" min="1" max="31" class="mini-in" id="stip-g" value="${Number(dati.finanze.stipendio?.giorno) || 27}"></div>
    </section>`;
  $("#conti-nuovo").addEventListener("click", () => apriConto(null));
  corpo.querySelectorAll(".conto-r").forEach((li) => {
    const id = li.dataset.id;
    li.addEventListener("click", (e) => { if (e.target.closest(".ord")) return; apriConto(contoDi(id)); });
    const sposta = (dir) => op("finanze", (d) => {
      const ord = [...d.conti].sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)), i = ord.findIndex((c) => c.id === id), j = i + dir;
      if (j < 0 || j >= ord.length) return d;
      [ord[i], ord[j]] = [ord[j], ord[i]];
      return { ...d, conti: ord.map((c, k) => ({ ...c, ordine: k * 10 })) };
    }, "Riordina conti");
    li.querySelector(".su").addEventListener("click", () => sposta(-1));
    li.querySelector(".giu").addEventListener("click", () => sposta(1));
  });
  $("#stip-on").addEventListener("change", (e) => op("finanze", (d) => ({ ...d, stipendio: { ...d.stipendio, attivo: e.target.checked } }), "Ciclo stipendio"));
  $("#stip-g").addEventListener("change", (e) => { const g = Math.min(31, Math.max(1, Number(e.target.value) || 27)); op("finanze", (d) => ({ ...d, stipendio: { ...d.stipendio, giorno: g } }), "Giorno stipendio"); });
}

/* ---------- Pannelli dal basso per movimenti, conti e spese fisse ---------- */
const fsheet = $("#sheet-fin");
function apriFin(titolo, html, onSalva, onElimina) {
  $("#fin-titolo").textContent = titolo;
  const f = $("#fin-form");
  f.innerHTML = html + `<p class="errore" id="fin-err" hidden></p><button class="primario">Salva</button>${onElimina ? `<button type="button" class="pericolo" id="fin-elimina">Elimina</button>` : ""}`;
  f.onsubmit = (e) => { e.preventDefault(); const err = onSalva(f); if (err) { const p = $("#fin-err"); p.textContent = err; p.hidden = false; p.style.animation = "none"; void p.offsetWidth; p.style.animation = ""; } else chiudiFin(); };
  if (onElimina) $("#fin-elimina").addEventListener("click", () => { if (onElimina() !== false) chiudiFin(); });
  bloccaSfondo(true);
  fsheet.style.removeProperty("--dy"); fsheet.classList.add("on"); fsheet.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("on"); document.body.classList.add("dim");
  fsheet.scrollTop = 0;
}
function chiudiFin() {
  if (!fsheet.classList.contains("on")) return;
  document.activeElement?.blur?.();
  fsheet.classList.remove("on"); fsheet.setAttribute("aria-hidden", "true");
  $("#scrim").classList.remove("on"); document.body.classList.remove("dim");
  bloccaSfondo(false);
}
$("#fin-chiudi").addEventListener("click", chiudiFin);
$("#scrim").addEventListener("click", chiudiFin);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && fsheet.classList.contains("on")) chiudiFin(); });

const optConti = (sel) => conti().map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? "selected" : ""}>${esc(c.icon || "")} ${esc(c.name)}</option>`).join("");
const numero = (v) => { const s = String(v || "").trim().replace(/\s|€/g, ""); return Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".")); };

function apriMov(m) {
  if (!stato.online) return toast(token() ? "Senza connessione non puoi modificare." : "Collega GitHub in Impostazioni per salvare.");
  if (!dati.finanze.conti.length) return apriConto(null);
  const trasf = m?.trasf ? dati.movimenti.filter((x) => x.trasf === m.trasf) : null;
  const tipo0 = trasf ? "trasferimento" : m?.tipo || "uscita";
  const da = trasf ? trasf.find((x) => x.tipo === "uscita") : m, a = trasf ? trasf.find((x) => x.tipo === "entrata") : null;
  const cat0 = m?.cat || "";
  apriFin(m ? "Modifica movimento" : "Nuovo movimento", `
    <div class="seg lg tipo-seg" id="mv-tipo"><button type="button" data-v="uscita">Uscita</button><button type="button" data-v="entrata">Entrata</button>${dati.finanze.conti.length > 1 ? `<button type="button" data-v="trasferimento">Trasferimento</button>` : ""}</div>
    <label class="imp-big">Importo<input name="importo" inputmode="decimal" placeholder="0,00" value="${m ? String(Number(m.importo).toFixed(2)).replace(".", ",") : ""}" required></label>
    <div class="riga2"><label>Data<input name="data" type="date" value="${m?.data || oggiISO()}" required></label>
      <label><span id="mv-lbl-conto">Conto</span><select name="conto">${optConti(da?.contoId || fin.conto || conti()[0].id)}</select></label></div>
    <label class="solo-trasf">Verso il conto<select name="verso">${optConti(a?.contoId || conti().find((c) => c.id !== (da?.contoId || conti()[0].id))?.id)}</select></label>
    <label>Descrizione<input name="descr" maxlength="200" autocomplete="off" placeholder="es. Spesa Esselunga" value="${esc(trasf ? (da.descr || "").replace(/ → .*$/, "") : m?.descr || "")}"></label>
    <label class="no-trasf">Categoria<input name="cat" list="dl-cat" autocomplete="off" placeholder="Scegli o scrivi" value="${esc(cat0)}"><datalist id="dl-cat"></datalist></label>
    <label>Nota<input name="nota" maxlength="300" autocomplete="off" placeholder="Facoltativa" value="${esc(m?.nota || "")}"></label>
    <label class="interruttore no-trasf"><input name="piggy" type="checkbox" ${m?.salvadanaio ? "checked" : ""}><span>Metti nel salvadanaio 🐷</span><small>Non conta nei saldi e nei totali del mese.</small></label>`,
  (f) => {
    const v = (n) => f.elements[n].value.trim(), tipo = $("#mv-tipo button.on").dataset.v, imp = Math.round(numero(v("importo")) * 100) / 100;
    if (!(imp > 0)) return "Inserisci un importo maggiore di zero.";
    if (!v("data")) return "Inserisci la data.";
    if (tipo === "trasferimento") {
      if (v("conto") === v("verso")) return "Scegli due conti diversi.";
      const id = m?.trasf || nuovoId(), ds = v("descr") || "Trasferimento", nDa = contoDi(v("conto")).name, nA = contoDi(v("verso")).name;
      const coppia = [
        { id: da?.id || nuovoId(), contoId: v("conto"), data: v("data"), descr: `${ds} → ${nA}`, importo: imp, tipo: "uscita", cat: "Trasferimento", salvadanaio: false, nota: v("nota"), trasf: id },
        { id: a?.id || nuovoId(), contoId: v("verso"), data: v("data"), descr: `${ds} ← ${nDa}`, importo: imp, tipo: "entrata", cat: "Trasferimento", salvadanaio: false, nota: v("nota"), trasf: id },
      ];
      const vecchi = new Set([m?.id, ...(trasf || []).map((x) => x.id)].filter(Boolean));
      op("movimenti", (d) => [...d.filter((x) => !vecchi.has(x.id)), ...coppia], m ? "Modifica trasferimento" : "Nuovo trasferimento");
      toast(`Trasferiti ${eur.format(imp)}`);
      return;
    }
    const cat = v("cat") || categoriaAuto(v("descr"), tipo);
    const nuovo = { ...(m && !trasf ? m : {}), id: m && !trasf ? m.id : nuovoId(), contoId: v("conto"), data: v("data"), descr: v("descr"), importo: imp, tipo, cat, salvadanaio: f.elements.piggy.checked, nota: v("nota") };
    delete nuovo.trasf;
    const vecchi = new Set([m?.id, ...(trasf || []).map((x) => x.id)].filter(Boolean));
    stato.nuovo = nuovo.id;
    op("movimenti", (d) => [...d.filter((x) => !vecchi.has(x.id)), nuovo], m ? "Modifica movimento" : "Nuovo movimento");
    stato.nuovo = null;
    toast(m ? "Movimento aggiornato" : `${tipo === "entrata" ? "Entrata" : "Uscita"} di ${eur.format(imp)} registrata`);
  },
  m ? () => {
    if (!confirm(trasf ? "Eliminare il trasferimento (entrambi i movimenti)?" : `Eliminare "${m.descr || m.cat}"?`)) return false;
    const via = new Set(trasf ? trasf.map((x) => x.id) : [m.id]);
    op("movimenti", (d) => d.filter((x) => !via.has(x.id)), "Elimina movimento");
    toast("Movimento eliminato");
  } : null);
  const f = $("#fin-form");
  const impostaTipo = (t) => {
    $$("#mv-tipo button").forEach((b) => b.classList.toggle("on", b.dataset.v === t));
    segSync($("#mv-tipo"));
    f.classList.toggle("e-trasf", t === "trasferimento");
    $("#mv-lbl-conto").textContent = t === "trasferimento" ? "Dal conto" : "Conto";
    $("#dl-cat").innerHTML = (t === "entrata" ? CAT_ENTRATA : CAT_USCITA).map((c) => `<option value="${esc(c)}">${catInfo(c)[0]} ${esc(c)}</option>`).join("");
  };
  $("#mv-tipo").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) impostaTipo(b.dataset.v); });
  impostaTipo(tipo0);
  requestAnimationFrame(() => segSync($("#mv-tipo"), true));
  // suggerisce la categoria mentre scrivi la descrizione, se non l'hai scelta tu
  let catToccata = !!cat0;
  f.elements.cat.addEventListener("input", () => { catToccata = true; });
  f.elements.descr.addEventListener("input", () => { if (catToccata) return; const t = $("#mv-tipo button.on").dataset.v; if (t !== "trasferimento") f.elements.cat.placeholder = categoriaAuto(f.elements.descr.value, t) + " (automatica)"; });
  if (!m && matchMedia("(hover: hover)").matches) setTimeout(() => f.elements.importo.focus(), 250);
}

const COL_CONTI = ["#6366F1", "#059669", "#DC2626", "#D97706", "#0EA5E9", "#EC4899", "#8B5CF6", "#14B8A6", "#F97316", "#64748B"];
const IC_CONTI = ["🏦", "💳", "💰", "🔄", "📱", "🏠", "✈️", "💼", "📈", "🎓", "🛒", "🎮"];
function apriConto(c) {
  if (!stato.online) return toast(token() ? "Senza connessione non puoi modificare." : "Collega GitHub in Impostazioni per salvare.");
  let col = c?.color || COL_CONTI[dati.finanze.conti.length % COL_CONTI.length], ic = c?.icon || "🏦";
  apriFin(c ? "Modifica conto" : "Nuovo conto", `
    <label>Nome<input name="nome" maxlength="40" required autocomplete="off" placeholder="es. BancoPosta, Revolut, Contanti" value="${esc(c?.name || "")}"></label>
    <label>Colore<div class="swatches" id="cc-col">${COL_CONTI.map((x) => `<button type="button" class="sw ${x === col ? "on" : ""}" style="--c:${x}" data-c="${x}"></button>`).join("")}</div></label>
    <label>Icona<div class="emoji-g" id="cc-ic">${IC_CONTI.map((x) => `<button type="button" class="${x === ic ? "on" : ""}" data-i="${x}">${x}</button>`).join("")}</div></label>
    ${c ? "" : `<label>Saldo iniziale (facoltativo)<input name="iniziale" inputmode="decimal" placeholder="0,00"></label>`}`,
  (f) => {
    const n = f.elements.nome.value.trim();
    if (!n) return "Dai un nome al conto.";
    if (c) { op("finanze", (d) => ({ ...d, conti: d.conti.map((x) => x.id === c.id ? { ...x, name: n, color: col, icon: ic } : x) }), "Modifica conto"); toast("Conto aggiornato"); return; }
    const id = nuovoId(), ini = numero(f.elements.iniziale.value);
    op("finanze", (d) => ({ ...d, conti: [...d.conti, { id, name: n, color: col, icon: ic, ordine: d.conti.length * 10 }] }), "Nuovo conto");
    if (ini) op("movimenti", (d) => [...d, { id: nuovoId(), contoId: id, data: oggiISO(), descr: "Saldo iniziale", importo: Math.abs(ini), tipo: ini > 0 ? "entrata" : "uscita", cat: ini > 0 ? "Entrata" : "Altro", salvadanaio: false, nota: "" }], "Saldo iniziale");
    toast(`Conto ${n} creato`);
  },
  c ? () => {
    const n = dati.movimenti.filter((m) => m.contoId === c.id).length;
    if (!confirm(`Eliminare il conto "${c.name}"${n ? ` e i suoi ${n} movimenti` : ""}? Non si può annullare.`)) return false;
    op("finanze", (d) => ({ ...d, conti: d.conti.filter((x) => x.id !== c.id), fisse: d.fisse.filter((f) => f.contoId !== c.id) }), "Elimina conto");
    op("movimenti", (d) => d.filter((m) => m.contoId !== c.id), "Elimina movimenti del conto");
    if (fin.conto === c.id) fin.conto = "";
    toast("Conto eliminato");
  } : null);
  $$("#cc-col .sw").forEach((b) => b.addEventListener("click", () => { col = b.dataset.c; $$("#cc-col .sw").forEach((x) => x.classList.toggle("on", x === b)); }));
  $$("#cc-ic button").forEach((b) => b.addEventListener("click", () => { ic = b.dataset.i; $$("#cc-ic button").forEach((x) => x.classList.toggle("on", x === b)); }));
}

function apriFissa(fx) {
  if (!stato.online) return toast(token() ? "Senza connessione non puoi modificare." : "Collega GitHub in Impostazioni per salvare.");
  if (!dati.finanze.conti.length) return apriConto(null);
  apriFin(fx ? "Modifica spesa fissa" : "Nuova spesa fissa", `
    <div class="seg lg tipo-seg" id="fx-tipo"><button type="button" data-v="uscita" class="${fx?.type !== "entrata" ? "on" : ""}">Uscita</button><button type="button" data-v="entrata" class="${fx?.type === "entrata" ? "on" : ""}">Entrata</button></div>
    <label>Nome<input name="nome" required autocomplete="off" placeholder="es. Affitto" value="${esc(fx?.name || "")}"></label>
    <div class="riga2"><label>Importo (€)<input name="importo" inputmode="decimal" placeholder="650,00" value="${fx ? String(fx.amount).replace(".", ",") : ""}"></label>
      <label>Giorno del mese<input name="giorno" type="number" min="1" max="31" value="${fx?.giorno || 1}"></label></div>
    <div class="riga2"><label>Conto<select name="conto">${optConti(fx?.contoId || conti()[0].id)}</select></label>
      <label>Categoria<input name="cat" list="dl-cat-fx" autocomplete="off" value="${esc(fx?.category || "Casa & Utenze")}"><datalist id="dl-cat-fx">${[...CAT_USCITA, ...CAT_ENTRATA].map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label></div>
    <label class="interruttore"><input name="attiva" type="checkbox" ${fx?.attiva === false ? "" : "checked"}><span>Attiva</span><small>Il movimento viene creato da solo il giorno indicato di ogni mese.</small></label>`,
  (f) => {
    const v = (n) => f.elements[n].value.trim(), imp = Math.round(numero(v("importo")) * 100) / 100, g = Math.min(31, Math.max(1, Number(v("giorno")) || 1));
    if (!v("nome")) return "Dai un nome alla spesa fissa.";
    if (!(imp > 0)) return "Inserisci un importo maggiore di zero.";
    const rec = { ...(fx || {}), id: fx?.id || nuovoId(), contoId: v("conto"), name: v("nome"), amount: imp, type: $("#fx-tipo button.on").dataset.v, category: v("cat") || "Altro", giorno: g, attiva: f.elements.attiva.checked };
    op("finanze", (d) => ({ ...d, fisse: [...d.fisse.filter((x) => x.id !== rec.id), rec] }), fx ? "Modifica spesa fissa" : "Nuova spesa fissa");
    const n = generaFisse(false);
    toast(fx ? "Spesa fissa aggiornata" : `Spesa fissa creata${n ? `, ${plurale(n, "movimento registrato", "movimenti registrati")}` : ""}`);
  },
  fx ? () => {
    if (!confirm(`Eliminare la spesa fissa "${fx.name}"? I movimenti già registrati restano.`)) return false;
    op("finanze", (d) => ({ ...d, fisse: d.fisse.filter((x) => x.id !== fx.id) }), "Elimina spesa fissa");
  } : null);
  $("#fx-tipo").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $$("#fx-tipo button").forEach((x) => x.classList.toggle("on", x === b)); segSync($("#fx-tipo")); });
  requestAnimationFrame(() => segSync($("#fx-tipo"), true));
}

/* ---------- Collegamenti ---------- */
legaSeg("#seg-fin", (v) => { fin.vista = v; disegnaFinanze(true); });
$("#fin-prev").addEventListener("click", () => { fin.offset--; disegnaFinanze(false); });
$("#fin-next").addEventListener("click", () => { fin.offset++; disegnaFinanze(false); });
$("#fin-periodo").addEventListener("click", () => { fin.offset = 0; disegnaFinanze(false); });

function disegnaFinHome() {
  const box = $("#c-fin"); if (!box) return;
  box.hidden = !dati.finanze.conti.length;
  if (box.hidden) return;
  const p = periodo(0), l = nelPeriodo(fuoriPiggy(), p).filter((m) => !TRASF(m.cat));
  $("#fin-home").innerHTML = `<div class="fh-row"><div><span class="lbl">Saldo totale</span><b class="num">${eur.format(somma(fuoriPiggy()))}</b></div>
    <div><span class="lbl">Entrate</span><b class="num pos">${eur.format(totale(l, "entrata"))}</b></div><div><span class="lbl">Uscite</span><b class="num neg">${eur.format(totale(l, "uscita"))}</b></div></div>`;
}

RENDER.finanze = disegnaFinanze;
DOPO_RENDER.push(() => { if (stato.tab === "home") disegnaFinHome(); });
DOPO_CARICA.push(() => { if (generaFisse(false)) disegna(); });
AGGIUNGI.finanze = () => (fin.vista === "conti" ? apriConto(null) : fin.vista === "fisse" ? apriFissa(null) : apriMov(null));
