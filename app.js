"use strict";

const C = window.CONFIG;
const API = `https://api.github.com/repos/${C.owner}/${C.repoDati}`;
const F_ABB = "abbonamenti.json";
const F_DIS = "dispositivi.json";
const LS = { token: "abb_token", cache: "abb_cache", endpoint: "abb_endpoint", nome: "abb_nome_dispositivo" };

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const FREQ = { mensile: "mensile", annuale: "annuale", settimanale: "settimanale" };

const $ = (s) => document.querySelector(s);
const stato = { abbonamenti: [], online: false, inModifica: null, animaLista: true };

/* ---------- Date ---------- */
const pad = (n) => String(n).padStart(2, "0");
const oggiISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const utc = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const giorniDa = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);

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
async function carica() {
  const cache = localStorage.getItem(LS.cache);
  if (cache) { stato.abbonamenti = JSON.parse(cache); disegnaHome(); }
  if (!token()) { stato.online = false; mostraBanner(""); apri("impostazioni"); return; }
  try {
    const { dati } = await leggi(F_ABB);
    stato.abbonamenti = dati;
    stato.online = true;
    localStorage.setItem(LS.cache, JSON.stringify(dati));
    mostraBanner("");
  } catch (e) {
    stato.online = false;
    mostraBanner(e.status ? e.message : "Senza connessione: vedi i dati dell'ultima apertura, in sola lettura.");
  }
  disegnaHome();
}

function mostraBanner(testo) {
  const b = $("#banner");
  b.textContent = testo;
  b.hidden = !testo;
}

/* ---------- Home ---------- */
function disegnaHome() {
  const oggi = oggiISO();
  const attivi = stato.abbonamenti.filter((a) => a.attivo);
  const mese = attivi.reduce((s, a) => s + quotaMensile(a), 0);
  $("#tot-mese").textContent = eur.format(mese);
  $("#tot-anno").textContent = eur.format(mese * 12);

  const ordinati = [...stato.abbonamenti].sort((a, b) =>
    a.attivo !== b.attivo ? (a.attivo ? -1 : 1) : a.prossimoRinnovo.localeCompare(b.prossimoRinnovo)
  );

  const lista = $("#lista");
  lista.innerHTML = "";
  // La cascata d'ingresso parte solo quando si apre la home, non a ogni ridisegno.
  lista.classList.toggle("still", !stato.animaLista);
  stato.animaLista = false;
  for (const [i, a] of ordinati.entries()) {
    const g = giorniDa(oggi, a.prossimoRinnovo);
    const [, m, d] = a.prossimoRinnovo.split("-").map(Number);
    const li = document.createElement("li");
    li.style.setProperty("--i", i);
    const btn = document.createElement("button");
    btn.className = "voce" + (!a.attivo ? " pausa" : g <= 0 ? " oggi" : g <= 7 ? " vicino" : "");
    btn.innerHTML = `
      <span class="talloncino" aria-hidden="true"><span class="giorno">${d}</span><span class="mese">${MESI[m - 1]}</span></span>
      <span><span class="nome"></span><span class="dettaglio"></span></span>
      <span class="prezzo"><span class="importo">${eur.format(a.costo)}</span><span class="quando">${a.attivo ? quando(g) : "in pausa"}</span></span>`;
    btn.querySelector(".nome").textContent = a.nome;
    btn.querySelector(".dettaglio").textContent = [a.categoria, FREQ[a.frequenza]].filter(Boolean).join(", ");
    btn.setAttribute("aria-label", `${a.nome}, ${eur.format(a.costo)} ${FREQ[a.frequenza]}, ${a.attivo ? "rinnovo " + quando(g) : "in pausa"}`);
    btn.addEventListener("click", () => apriModulo(a));
    li.appendChild(btn);
    lista.appendChild(li);
  }
  $("#vuoto").hidden = stato.abbonamenti.length > 0;
  $("#btn-aggiungi").disabled = !stato.online;
}

/* ---------- Navigazione ---------- */
function apri(vista) {
  for (const v of ["home", "modulo", "impostazioni"]) $(`#v-${v}`).hidden = v !== vista;
  window.scrollTo(0, 0);
  if (vista === "impostazioni") preparaImpostazioni();
  if (vista === "home") { stato.animaLista = true; disegnaHome(); }
}
document.querySelectorAll("[data-indietro]").forEach((b) => b.addEventListener("click", () => apri("home")));
$("#btn-impostazioni").addEventListener("click", () => apri("impostazioni"));
$("#btn-aggiungi").addEventListener("click", () => apriModulo(null));

/* ---------- Modulo ---------- */
const form = $("#modulo");

function apriModulo(a) {
  stato.inModifica = a;
  form.reset();
  $("#modulo-errore").hidden = true;
  $("#modulo-titolo").textContent = a ? "Modifica" : "Nuovo abbonamento";
  $("#btn-elimina").hidden = !a;
  const cat = [...new Set(stato.abbonamenti.map((x) => x.categoria).filter(Boolean))];
  $("#categorie").innerHTML = cat.map((c) => `<option value="${c.replace(/"/g, "&quot;")}">`).join("");
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
  apri("modulo");
}

function mostraErrore(t) { const e = $("#modulo-errore"); e.textContent = t; e.hidden = !t; }

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

  $("#btn-salva").disabled = true;
  try {
    stato.abbonamenti = await modifica(F_ABB, (lista) => {
      const i = lista.findIndex((x) => x.id === record.id);
      if (i >= 0) lista[i] = { ...lista[i], ...record }; else lista.push(record);
      return lista;
    }, `${vecchio ? "Modifica" : "Aggiunge"} ${nome}`);
    localStorage.setItem(LS.cache, JSON.stringify(stato.abbonamenti));
    apri("home");
  } catch (e) {
    mostraErrore(e.message);
  } finally {
    $("#btn-salva").disabled = false;
  }
});

$("#btn-elimina").addEventListener("click", async () => {
  const a = stato.inModifica;
  if (!a || !confirm(`Eliminare ${a.nome}?`)) return;
  try {
    stato.abbonamenti = await modifica(F_ABB, (lista) => lista.filter((x) => x.id !== a.id), `Elimina ${a.nome}`);
    localStorage.setItem(LS.cache, JSON.stringify(stato.abbonamenti));
    apri("home");
  } catch (e) { mostraErrore(e.message); }
});

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

/* ---------- Avvio ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
document.addEventListener("visibilitychange", () => { if (!document.hidden && $("#v-home").hidden === false) carica(); });
carica();
