"use strict";
/* Sezioni personali: attività, abitudini, obiettivi, note ed eventi del calendario.
   Ogni sezione è un file JSON nel repo dei dati. Le modifiche si vedono subito sul
   dispositivo e partono verso GitHub raggruppate, così una raffica di spunte non
   diventa una raffica di salvataggi. */

const MOD = {
  attivita: { file: "attivita.json", vuoto: () => [], nome: "attività" },
  abitudini: { file: "abitudini.json", vuoto: () => [], nome: "abitudini" },
  obiettivi: { file: "obiettivi.json", vuoto: () => [], nome: "obiettivi" },
  note: { file: "note.json", vuoto: () => [], nome: "note" },
  eventi: { file: "eventi.json", vuoto: () => ({}), nome: "eventi" },
};
const dati = {}, coda = {}, timerInvio = {};
for (const k in MOD) {
  try { dati[k] = JSON.parse(localStorage.getItem("abb_dati_" + k)) ?? MOD[k].vuoto(); } catch { dati[k] = MOD[k].vuoto(); }
  coda[k] = [];
}
const salvaCache = (k) => { try { localStorage.setItem("abb_dati_" + k, JSON.stringify(dati[k])); } catch {} };
const nuovoId = () => crypto.randomUUID().slice(0, 8);

async function caricaModuli() {
  await Promise.all(Object.keys(MOD).map(async (k) => {
    try {
      const { dati: d } = await leggiOVuoto(MOD[k].file, MOD[k].vuoto);
      if (!coda[k].length) { dati[k] = d; salvaCache(k); }
    } catch (e) { console.warn(k, e); }
  }));
}

// Applica subito la modifica in locale e la mette in coda per GitHub.
function op(k, fn, messaggio, ridisegna = true) {
  if (!stato.online) {
    toast(token() ? "Senza connessione: la modifica non è stata salvata." : "Collega GitHub in Impostazioni per salvare.");
    return false;
  }
  dati[k] = fn(structuredClone(dati[k]));
  salvaCache(k);
  coda[k].push(fn);
  if (ridisegna) disegna();
  clearTimeout(timerInvio[k]);
  timerInvio[k] = setTimeout(() => invia(k, messaggio), 700);
  return true;
}
async function invia(k, messaggio) {
  const ops = coda[k].splice(0);
  if (!ops.length) return;
  setSync("", "Salvo…");
  try {
    const nuovi = await modifica(MOD[k].file, (d) => ops.reduce((x, f) => f(x), d), messaggio || `Aggiorna ${MOD[k].nome}`, MOD[k].vuoto);
    if (!coda[k].length) { dati[k] = nuovi; salvaCache(k); }
    setSync("live", "Sincronizzato");
  } catch (e) {
    coda[k].unshift(...ops);
    setSync("ko", "Non salvato");
    toast(e.message || "Salvataggio non riuscito, riprovo tra poco.");
    clearTimeout(timerInvio[k]);
    timerInvio[k] = setTimeout(() => invia(k, messaggio), 8000);
  }
}
// Prima di chiudere l'app prova a spedire quello che è ancora in coda.
document.addEventListener("visibilitychange", () => { if (document.hidden) for (const k in MOD) if (coda[k].length) { clearTimeout(timerInvio[k]); invia(k); } });

const CHECK = `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 9.5l3.2 3.2L14 5.8"/></svg>`;
const X_IC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const giorniFa = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const plurale = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;

/* ---------- Attività ---------- */
const att = { filtro: "tutte", modifica: null };
function disegnaAttivita(anima) {
  const l = dati.attivita, aperte = l.filter((t) => !t.done).length;
  $("#att-info").textContent = l.length ? (aperte ? `${plurale(aperte, "cosa da fare", "cose da fare")} · ${l.length} in totale` : "Tutto fatto ✦") : "Scrivi qui la prima cosa da fare";
  const n = { tutte: l.length, aperte, fatte: l.length - aperte };
  $$("#seg-att button").forEach((b) => { b.querySelector(".n").textContent = n[b.dataset.v]; });
  segSync($("#seg-att"));
  $("#att-pulisci").hidden = !n.fatte;
  const vis = l.filter((t) => att.filtro === "tutte" || (att.filtro === "aperte" ? !t.done : t.done));
  const box = $("#att-lista");
  box.classList.toggle("still", !anima);
  box.innerHTML = vis.map((t, i) => `<li class="td ${t.done ? "fatta" : ""}" data-id="${esc(t.id)}" style="--i:${i}">
      <label class="chk"><input type="checkbox" ${t.done ? "checked" : ""} aria-label="Completata">${CHECK}</label>
      ${att.modifica === t.id ? `<input class="td-edit" value="${esc(t.text)}" aria-label="Modifica attività">` : `<button class="tx" title="Tocca per modificare">${esc(t.text)}</button>`}
      <button class="x" aria-label="Elimina">${X_IC}</button>
    </li>`).join("");
  $("#att-vuoto").hidden = vis.length > 0;
  $("#att-vuoto").innerHTML = l.length ? `<h3>Niente qui</h3><p>Nessuna attività in questo filtro.</p>` : `<h3>Goditi la pausa ✦</h3><p>Non hai niente da fare. Scrivi qui sopra la prossima cosa.</p>`;
  box.querySelectorAll(".td").forEach((li) => {
    const id = li.dataset.id;
    li.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
      const ok = op("attivita", (d) => d.map((t) => t.id === id ? { ...t, done: e.target.checked } : t), e.target.checked ? "Completa attività" : "Riapre attività", false);
      if (!ok) { e.target.checked = !e.target.checked; return; }
      li.classList.toggle("fatta", e.target.checked);
      setTimeout(() => disegnaAttivita(false), att.filtro === "tutte" ? 0 : 450);
      aggiornaContatori();
    });
    li.querySelector(".x").addEventListener("click", () => {
      li.classList.add("via");
      setTimeout(() => op("attivita", (d) => d.filter((t) => t.id !== id), "Elimina attività"), 220);
    });
    li.querySelector(".tx")?.addEventListener("click", () => { att.modifica = id; disegnaAttivita(false); const i = box.querySelector(".td-edit"); i.focus(); i.select(); });
    const ed = li.querySelector(".td-edit");
    if (ed) {
      const salva = () => { const v = ed.value.trim(); att.modifica = null; if (v) op("attivita", (d) => d.map((t) => t.id === id ? { ...t, text: v } : t), "Modifica attività"); else disegnaAttivita(false); };
      ed.addEventListener("keydown", (e) => { if (e.key === "Enter") ed.blur(); if (e.key === "Escape") { att.modifica = null; disegnaAttivita(false); } });
      ed.addEventListener("blur", salva, { once: true });
    }
  });
}
$("#att-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const i = $("#att-in"), v = i.value.trim();
  if (!v) return;
  const t = { id: nuovoId(), text: v, done: false, created: new Date().toISOString() };
  stato.nuovo = t.id;
  if (op("attivita", (d) => [t, ...d], `Aggiunge attività`)) i.value = "";
  stato.nuovo = null;
});
legaSeg("#seg-att", (v) => { att.filtro = v; disegnaAttivita(true); });
$("#att-pulisci").addEventListener("click", () => {
  const n = dati.attivita.filter((t) => t.done).length;
  op("attivita", (d) => d.filter((t) => !t.done), "Rimuove attività completate") && toast(`${plurale(n, "attività rimossa", "attività rimosse")}`);
});

/* ---------- Abitudini ---------- */
const COLORI = ["#d98a1a", "#3f8f8a", "#6a6fd1", "#c4517a", "#4f9a4a", "#3d7fbf", "#8a62b5", "#b0703c"];
const LETTERE = ["D", "L", "M", "M", "G", "V", "S"];
let colHab = COLORI[0];
function serie(h) {
  const log = new Set(h.log);
  let s = 0, k = log.has(oggiISO()) ? 0 : 1; // se oggi non è ancora fatta, la serie di ieri resta valida
  while (log.has(giorniFa(k))) { s++; k++; }
  return s;
}
function disegnaAbitudini(anima) {
  const l = dati.abitudini, oggi = oggiISO(), fatte = l.filter((h) => h.log.includes(oggi)).length;
  $("#hab-info").textContent = l.length ? `${fatte}/${l.length} completate oggi` : "Costruisci le tue routine";
  $("#hab-colori").innerHTML = COLORI.map((c) => `<button type="button" class="sw ${c === colHab ? "on" : ""}" style="--c:${c}" data-c="${c}" aria-label="Colore"></button>`).join("");
  $$("#hab-colori .sw").forEach((b) => b.addEventListener("click", () => { colHab = b.dataset.c; $$("#hab-colori .sw").forEach((x) => x.classList.toggle("on", x === b)); }));
  const giorni = Array.from({ length: 7 }, (_, i) => 6 - i).map((n) => { const k = giorniFa(n), d = new Date(k + "T12:00"); return { k, l: LETTERE[d.getDay()], n: d.getDate(), oggi: n === 0 }; });
  const box = $("#hab-lista");
  box.classList.toggle("still", !anima);
  box.innerHTML = l.map((h, i) => {
    const s = serie(h), sett = giorni.filter((g) => h.log.includes(g.k)).length;
    return `<li class="card hab" data-id="${esc(h.id)}" style="--c:${h.color};--i:${i}">
      <div class="hab-h"><b>${esc(h.name)}</b><span class="hab-s ${s ? "su" : ""}">${s ? `🔥 ${plurale(s, "giorno", "giorni")} di fila` : "Inizia oggi"}</span><span class="spacer"></span><span class="hab-w">${sett}/7</span><button class="x" aria-label="Elimina">${X_IC}</button></div>
      <div class="hab-g">${giorni.map((g) => `<button class="hg ${h.log.includes(g.k) ? "on" : ""} ${g.oggi ? "oggi" : ""}" data-k="${g.k}" aria-label="${g.k}"><span>${g.l}</span><b>${g.n}</b></button>`).join("")}</div>
    </li>`;
  }).join("");
  $("#hab-vuoto").hidden = l.length > 0;
  box.querySelectorAll(".hab").forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll(".hg").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.k, on = !b.classList.contains("on");
      if (!op("abitudini", (d) => d.map((h) => h.id !== id ? h : { ...h, log: on ? [...new Set([...h.log, k])] : h.log.filter((x) => x !== k) }), on ? "Segna abitudine" : "Toglie abitudine", false)) return;
      b.classList.toggle("on", on);
      if (on && !pocoMoto()) b.animate([{ transform: "scale(.7)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" });
      const h = dati.abitudini.find((x) => x.id === id), s = serie(h);
      card.querySelector(".hab-s").textContent = s ? `🔥 ${plurale(s, "giorno", "giorni")} di fila` : "Inizia oggi";
      card.querySelector(".hab-s").classList.toggle("su", !!s);
      card.querySelector(".hab-w").textContent = `${giorni.filter((g) => h.log.includes(g.k)).length}/7`;
      const f = dati.abitudini.filter((x) => x.log.includes(oggiISO())).length;
      $("#hab-info").textContent = `${f}/${dati.abitudini.length} completate oggi`;
      aggiornaContatori();
    }));
    card.querySelector(".x").addEventListener("click", () => {
      const h = dati.abitudini.find((x) => x.id === id);
      if (confirm(`Eliminare l'abitudine "${h.name}" e tutto il suo storico?`)) op("abitudini", (d) => d.filter((x) => x.id !== id), "Elimina abitudine");
    });
  });
}
$("#hab-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const i = $("#hab-in"), v = i.value.trim();
  if (!v) return;
  if (op("abitudini", (d) => [...d, { id: nuovoId(), name: v, color: colHab, log: [] }], "Aggiunge abitudine")) i.value = "";
});

/* ---------- Obiettivi ---------- */
const numIt = (v) => Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
const fmtNum = (n) => n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
function disegnaObiettivi(anima) {
  const l = dati.obiettivi, finiti = l.filter((g) => g.target > 0 && g.current >= g.target).length;
  $("#obi-info").textContent = l.length ? `${finiti}/${l.length} completati` : "Fissa un traguardo e segui i progressi";
  const box = $("#obi-lista");
  box.classList.toggle("still", !anima);
  box.innerHTML = l.map((g, i) => {
    const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0, ok = pct >= 100;
    const R = 34, C = 2 * Math.PI * R;
    return `<li class="card obi ${ok ? "fatto" : ""}" data-id="${esc(g.id)}" style="--c:${g.color};--i:${i}">
      <svg class="anello" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${R}" class="bg"/><circle cx="42" cy="42" r="${R}" class="fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}" style="--da:${C}"/></svg>
      <span class="pct num">${pct}<small>%</small></span>
      <div class="obi-t"><b>${esc(g.name)}</b><span>${fmtNum(g.current)} / ${fmtNum(g.target)} ${esc(g.unit || "")}</span>${ok ? `<em>✓ Completato</em>` : ""}</div>
      <div class="obi-a">
        <button class="lg round sm-r" data-d="-1" aria-label="Diminuisci">−</button>
        <input class="obi-v" inputmode="decimal" value="${fmtNum(g.current)}" aria-label="Valore attuale">
        <button class="lg round sm-r" data-d="1" aria-label="Aumenta">+</button>
        <button class="x" aria-label="Elimina">${X_IC}</button>
      </div>
    </li>`;
  }).join("");
  $("#obi-vuoto").hidden = l.length > 0;
  box.querySelectorAll(".obi").forEach((card) => {
    const id = card.dataset.id, g = l.find((x) => x.id === id), passo = Math.max(1, Math.round(g.target * 0.05));
    card.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () =>
      op("obiettivi", (d) => d.map((x) => x.id === id ? { ...x, current: Math.max(0, x.current + passo * Number(b.dataset.d)) } : x), "Aggiorna obiettivo")));
    card.querySelector(".obi-v").addEventListener("change", (e) =>
      op("obiettivi", (d) => d.map((x) => x.id === id ? { ...x, current: Math.max(0, numIt(e.target.value)) } : x), "Aggiorna obiettivo"));
    card.querySelector(".x").addEventListener("click", () => { if (confirm(`Eliminare l'obiettivo "${g.name}"?`)) op("obiettivi", (d) => d.filter((x) => x.id !== id), "Elimina obiettivo"); });
  });
}
$("#obi-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = $("#obi-nome").value.trim(), t = numIt($("#obi-target").value), u = $("#obi-unita").value.trim();
  if (!n) return $("#obi-nome").focus();
  if (!(t > 0)) { toast("Indica un traguardo maggiore di zero."); return $("#obi-target").focus(); }
  const g = { id: nuovoId(), name: n, target: t, current: 0, unit: u, color: COLORI[dati.obiettivi.length % COLORI.length] };
  if (op("obiettivi", (d) => [...d, g], "Aggiunge obiettivo")) { $("#obi-nome").value = ""; $("#obi-target").value = ""; $("#obi-unita").value = ""; }
});

/* ---------- Note ---------- */
const nota = { id: null, colore: COLORI[3], q: "" };
function disegnaNote(anima) {
  const l = dati.note, q = nota.q.trim().toLowerCase();
  $("#note-info").textContent = l.length ? plurale(l.length, "nota", "note") : "Appunti veloci, sempre con te";
  $("#note-colori").innerHTML = COLORI.map((c) => `<button type="button" class="sw ${c === nota.colore ? "on" : ""}" style="--c:${c}" data-c="${c}" aria-label="Colore"></button>`).join("");
  $$("#note-colori .sw").forEach((b) => b.addEventListener("click", () => { nota.colore = b.dataset.c; $$("#note-colori .sw").forEach((x) => x.classList.toggle("on", x === b)); $("#note-ed").style.setProperty("--c", nota.colore); }));
  $("#note-ed").style.setProperty("--c", nota.colore);
  $("#note-salva").textContent = nota.id ? "Aggiorna" : "Salva nota";
  $("#note-annulla").hidden = !nota.id;
  const vis = l.filter((n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q));
  const box = $("#note-lista");
  box.classList.toggle("still", !anima);
  box.innerHTML = vis.map((n, i) => `<li class="card nota ${nota.id === n.id ? "sel" : ""}" data-id="${esc(n.id)}" style="--c:${n.color};--i:${i}">
      <b>${esc(n.title || "Senza titolo")}</b>
      ${n.body ? `<p>${esc(n.body)}</p>` : ""}
      <time>${new Date(n.updated || n.created).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}</time>
      <button class="x" aria-label="Elimina">${X_IC}</button>
    </li>`).join("");
  $("#note-vuoto").hidden = vis.length > 0;
  $("#note-vuoto").innerHTML = l.length ? `<h3>Nessun risultato</h3><p>Nessuna nota contiene "${esc(nota.q)}".</p>` : `<h3>Nessuna nota</h3><p>Scrivi qui sopra la prima.</p>`;
  box.querySelectorAll(".nota").forEach((c) => {
    const id = c.dataset.id;
    c.addEventListener("click", (e) => {
      if (e.target.closest(".x")) return;
      const n = dati.note.find((x) => x.id === id);
      nota.id = id; nota.colore = n.color;
      $("#note-tit").value = n.title; $("#note-body").value = n.body;
      disegnaNote(false);
      $("#note-ed").scrollIntoView({ behavior: pocoMoto() ? "auto" : "smooth", block: "center" });
      setTimeout(() => $("#note-body").focus({ preventScroll: true }), 300);
    });
    c.querySelector(".x").addEventListener("click", () => {
      const n = dati.note.find((x) => x.id === id);
      if (!confirm(`Eliminare la nota "${n.title || "Senza titolo"}"?`)) return;
      if (nota.id === id) azzeraNota();
      op("note", (d) => d.filter((x) => x.id !== id), "Elimina nota");
    });
  });
}
function azzeraNota() { nota.id = null; $("#note-tit").value = ""; $("#note-body").value = ""; }
$("#note-ed").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("#note-tit").value.trim(), b = $("#note-body").value.trim(), ora = new Date().toISOString(), id = nota.id, col = nota.colore;
  if (!t && !b) { toast("Scrivi un titolo o un testo."); return $("#note-body").focus(); }
  const ok = id
    ? op("note", (d) => d.map((n) => n.id === id ? { ...n, title: t, body: b, color: col, updated: ora } : n), "Modifica nota")
    : op("note", (d) => [{ id: nuovoId(), title: t, body: b, color: col, created: ora, updated: ora }, ...d], "Aggiunge nota");
  if (ok) { azzeraNota(); disegnaNote(false); toast(id ? "Nota aggiornata" : "Nota salvata"); }
});
$("#note-annulla").addEventListener("click", () => { azzeraNota(); disegnaNote(false); });
$("#note-q").addEventListener("input", (e) => { nota.q = e.target.value; disegnaNote(false); });
// la textarea cresce con il testo
$("#note-body").addEventListener("input", (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(420, e.target.scrollHeight + 2) + "px"; });

/* ---------- Eventi nel calendario ---------- */
function eventiTra(da, fino) {
  const out = {};
  for (const [k, l] of Object.entries(dati.eventi)) if (k >= da && k <= fino && l.length) out[k] = l;
  return out;
}
function disegnaEventiCal() {
  const { anno, mese } = stato.cal, g = stato.cal.giorno;
  const da = `${anno}-${pad(mese + 1)}-01`, fino = `${anno}-${pad(mese + 1)}-${pad(new Date(anno, mese + 1, 0).getDate())}`;
  const giorno = g || (oggiISO() >= da && oggiISO() <= fino ? oggiISO() : da);
  const ev = g ? (dati.eventi[g] || []).map((e) => ({ ...e, d: g })) : Object.entries(eventiTra(da, fino)).sort().flatMap(([d, l]) => l.map((e) => ({ ...e, d })));
  $("#cal-eventi").innerHTML = `
    <div class="sec-h ev-h"><h2>${g ? "Eventi" : "Eventi del mese"} <small>${ev.length || ""}</small></h2></div>
    <ul class="ev-l">${ev.map((e) => `<li data-d="${e.d}" data-id="${esc(e.id)}">${g ? "" : `<span class="ev-d">${fmtData(e.d)}</span>`}<span class="ev-t">${esc(e.text)}</span><button class="x" aria-label="Elimina">${X_IC}</button></li>`).join("") || `<li class="vuoto-s">Nessun evento${g ? " in questo giorno" : ""}.</li>`}</ul>
    <form class="riga-add lg" id="ev-form"><input id="ev-in" placeholder="Nuovo evento il ${fmtData(giorno)}…" autocomplete="off" enterkeyhint="done"><button aria-label="Aggiungi evento"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg></button></form>`;
  $("#ev-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#ev-in").value.trim();
    if (!v) return;
    op("eventi", (d) => ({ ...d, [giorno]: [...(d[giorno] || []), { id: nuovoId(), text: v }] }), "Aggiunge evento") && setTimeout(() => $("#ev-in")?.focus(), 50);
  });
  $$("#cal-eventi .ev-l li[data-id]").forEach((li) => li.querySelector(".x").addEventListener("click", () => {
    const d = li.dataset.d, id = li.dataset.id;
    op("eventi", (x) => { const r = { ...x, [d]: (x[d] || []).filter((e) => e.id !== id) }; if (!r[d].length) delete r[d]; return r; }, "Elimina evento");
  }));
}

/* ---------- Riepilogo "Oggi" nella Home e contatori ---------- */
function disegnaOggi() {
  const box = $("#oggi-box"); if (!box) return;
  const aperte = dati.attivita.filter((t) => !t.done), oggi = oggiISO(), hab = dati.abitudini, ev = dati.eventi[oggi] || [];
  const vuoto = !aperte.length && !hab.length && !ev.length;
  $("#c-oggi").hidden = vuoto && !stato.online;
  box.innerHTML = vuoto
    ? `<p class="vuoto-s" style="margin:0">Niente in programma. Aggiungi <button class="link" data-vai="attivita">attività</button> o <button class="link" data-vai="abitudini">abitudini</button>.</p>`
    : `${ev.length ? `<ul class="ev-l mini">${ev.map((e) => `<li><span class="ev-d">oggi</span><span class="ev-t">${esc(e.text)}</span></li>`).join("")}</ul>` : ""}
      ${hab.length ? `<div class="oggi-hab">${hab.map((h) => `<button class="oh ${h.log.includes(oggi) ? "on" : ""}" data-id="${esc(h.id)}" style="--c:${h.color}"><i>${CHECK}</i>${esc(h.name)}</button>`).join("")}</div>` : ""}
      ${aperte.length ? `<ul class="todo-mini">${aperte.slice(0, 4).map((t) => `<li data-id="${esc(t.id)}"><label class="chk"><input type="checkbox" aria-label="Completata">${CHECK}</label><span>${esc(t.text)}</span></li>`).join("")}${aperte.length > 4 ? `<li class="altre"><button class="link" data-vai="attivita">altre ${aperte.length - 4}</button></li>` : ""}</ul>` : ""}`;
  box.querySelectorAll("[data-vai]").forEach((b) => b.addEventListener("click", () => vai(b.dataset.vai)));
  box.querySelectorAll(".oh").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.id, on = !b.classList.contains("on");
    if (op("abitudini", (d) => d.map((h) => h.id !== id ? h : { ...h, log: on ? [...new Set([...h.log, oggi])] : h.log.filter((x) => x !== oggi) }), "Segna abitudine", false)) { b.classList.toggle("on", on); aggiornaContatori(); }
  }));
  box.querySelectorAll(".todo-mini li[data-id] input").forEach((cb) => cb.addEventListener("change", () => {
    const li = cb.closest("li"), id = li.dataset.id;
    if (!op("attivita", (d) => d.map((t) => t.id === id ? { ...t, done: true } : t), "Completa attività", false)) { cb.checked = false; return; }
    li.classList.add("fatta");
    setTimeout(() => { disegnaOggi(); aggiornaContatori(); }, 600);
  }));
  const fatte = hab.filter((h) => h.log.includes(oggi)).length;
  $("#oggi-info").textContent = [aperte.length ? plurale(aperte.length, "attività", "attività") : "", hab.length ? `abitudini ${fatte}/${hab.length}` : ""].filter(Boolean).join(" · ");
}
function aggiornaContatori() {
  const oggi = oggiISO();
  const c = {
    attivita: dati.attivita.filter((t) => !t.done).length,
    abitudini: dati.abitudini.length ? `${dati.abitudini.filter((h) => h.log.includes(oggi)).length}/${dati.abitudini.length}` : "",
    obiettivi: dati.obiettivi.length ? `${dati.obiettivi.filter((g) => g.current >= g.target).length}/${dati.obiettivi.length}` : "",
    note: dati.note.length,
  };
  for (const [k, v] of Object.entries(c)) $$(`[data-cnt="${k}"]`).forEach((e) => { e.textContent = v || ""; });
}

RENDER.attivita = disegnaAttivita;
RENDER.abitudini = disegnaAbitudini;
RENDER.obiettivi = disegnaObiettivi;
RENDER.note = disegnaNote;
DOPO_RENDER.push(aggiornaContatori);
// il + cambia significato in base alla sezione
AGGIUNGI.attivita = () => $("#att-in").focus();
AGGIUNGI.abitudini = () => $("#hab-in").focus();
AGGIUNGI.obiettivi = () => $("#obi-nome").focus();
AGGIUNGI.note = () => { azzeraNota(); disegnaNote(false); $("#note-tit").focus(); };
AGGIUNGI.calendario = () => $("#ev-in")?.focus();
