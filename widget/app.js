const view = document.querySelector("#view");
const phone = document.querySelector(".phone");
const params = new URLSearchParams(location.search);
const userId = params.get("userId") || "";
phone.dataset.popout = params.get("popout") === "true";

let state = null;
let page = "dex";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
const monName = (mon) => mon?.displayName || mon?.name || "Unbekannt";
const monKey = (mon) => mon?.dexId != null ? `dex:${mon.dexId}` : `name:${String(monName(mon)).toLowerCase()}`;
const caughtKeys = () => new Set((state?.player?.history?.length ? state.player.history : state?.player?.caught || []).map(monKey));

function heading(title, subtitle, aside = "") {
  return `<div class="hero"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${aside}</div>`;
}

function renderDex() {
  const owned = caughtKeys();
  const dex = state.dex || [];
  view.innerHTML = heading("Pokédex", "Einmal gefangen, für immer entdeckt", `<div class="meter">${owned.size}/${dex.length}</div>`) +
    `<div class="grid">${dex.map((mon) => { const found = owned.has(monKey(mon)); return `<article class="card mon ${found ? "" : "missing"}">${mon.spriteUrl ? `<img src="${escapeHtml(mon.spriteUrl)}" alt="">` : "<div>◓</div>"}<strong>${found ? escapeHtml(monName(mon)) : "???"}</strong><small>#${escapeHtml(mon.dexId || "—")}</small></article>`; }).join("")}</div>`;
}

function renderTeam() {
  const party = state.player.party || { activeSlot:0, slots:[] };
  const slots = Array.from({ length:6 }, (_, i) => party.slots?.[i] || null);
  view.innerHTML = heading("Team & PC", "Dein aktiver Begleiter ist markiert") +
    `<div class="party">${slots.map((mon, i) => `<article class="card slot ${mon && Number(party.activeSlot) === i ? "active" : ""}">${mon ? `${Number(party.activeSlot) === i ? '<span class="star">★</span>' : ""}<strong>${escapeHtml(monName(mon))}</strong><p class="muted">Lv. ${escapeHtml(mon.level || 1)}</p><small>Slot ${i + 1}</small>` : `<div class="empty">Slot ${i + 1}<br>leer</div>`}</article>`).join("")}</div>` +
    `<p class="muted">Hinzufügen, Entfernen und Aktivsetzen werden als geschützte Widget-Aktionen ergänzt.</p>`;
}

function renderItems() {
  const labels = { fire_stone:"🔥 Feuerstein", water_stone:"💧 Wasserstein", thunder_stone:"⚡ Donnerstein", leaf_stone:"🌿 Blattstein", moon_stone:"🌙 Mondstein", xp_candy_s:"🍬 XP-Bonbon S", xp_candy_m:"🍬 XP-Bonbon M", xp_candy_l:"🍬 XP-Bonbon L" };
  view.innerHTML = heading("Items", "Inventar und Anwendungen") + `<div class="list">${Object.entries(labels).map(([id, label]) => `<article class="card row"><strong>${label}</strong><span class="amount">${Number(state.player.items?.[id] || 0)}×</span></article>`).join("")}</div>`;
}

function renderMulti() {
  const raid = state.multiplayer?.raid;
  view.innerHTML = heading("Multiplayer", "Gemeinsam sammeln und kämpfen") + `<div class="action-grid"><button class="card action"><span>🔄</span><strong>Tausch</strong><p class="muted">${state.multiplayer?.trades?.length || 0} offene Vorgänge</p></button><button class="card action"><span>🐲</span><strong>Raid</strong><p class="muted">${raid ? "Ein Raid ist aktiv" : "Aktuell kein Raid"}</p></button><button class="card action" disabled><span>⚔️</span><strong>PvP</strong><p class="muted">Kommt später</p></button></div>`;
}

function renderRanks() {
  const unique = caughtKeys().size;
  const catches = state.player.caught?.length || 0;
  view.innerHTML = heading("Ranks", "Deine bisherigen Erfolge") + `<div class="list"><article class="card row"><strong>Entdeckte Pokémon</strong><span class="amount">${unique}</span></article><article class="card row"><strong>Pokémon im Besitz</strong><span class="amount">${catches}</span></article><article class="card row"><strong>Teamstärke</strong><span class="amount">${(state.player.party?.slots || []).filter(Boolean).length}/6</span></article></div>`;
}

function renderNotifications() {
  const notifications = state.notifications || [];
  view.innerHTML = heading("Benachrichtigungen", "Tausch- und Kampfanfragen") + (notifications.length ? `<div class="list">${notifications.map(() => `<article class="card">🔄 Neue Tauschanfrage</article>`).join("")}</div>` : `<div class="empty">Alles ruhig – keine neuen Anfragen.</div>`);
}

function renderHelp() {
  view.innerHTML = heading("Hilfe", "So funktioniert dein PokéDex") + `<div class="list"><article class="card"><strong>♥ Pokédex</strong><p class="muted">Zeigt alle entdeckten Pokémon.</p></article><article class="card"><strong>👥 Team & PC</strong><p class="muted">Verwalte dein Team und deinen aktiven Begleiter.</p></article><article class="card"><strong>⚔ Multiplayer</strong><p class="muted">Tauschen, Raids und später PvP.</p></article></div>`;
}

function render() {
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  ({ dex:renderDex, team:renderTeam, items:renderItems, multi:renderMulti, ranks:renderRanks }[page] || renderDex)();
}

async function load() {
  if (!userId) { view.innerHTML = `<div class="empty"><strong>Entwicklungsansicht</strong><p>Öffne das Widget mit <code>?userId=TWITCH_ID</code>.</p></div>`; return; }
  try {
    const response = await fetch(`/api/widget/player?userId=${encodeURIComponent(userId)}`, { cache:"no-store" });
    state = await response.json();
    if (!response.ok || !state.ok) throw new Error(state.error || "Laden fehlgeschlagen");
    document.querySelector("#trainerName").textContent = state.player.display;
    const count = state.notifications?.length || 0;
    const badge = document.querySelector("#notificationBadge");
    badge.hidden = !count;
    badge.textContent = count;
    document.querySelector("#notificationButton").classList.toggle("alert", count > 0);
    render();
  } catch (error) {
    view.innerHTML = `<div class="empty"><strong>Widget konnte nicht geladen werden.</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => { page = button.dataset.page; render(); }));
document.querySelector("#notificationButton").addEventListener("click", () => state && renderNotifications());
document.querySelector("#helpButton").addEventListener("click", () => state && renderHelp());
load();
setInterval(load, 15000);
