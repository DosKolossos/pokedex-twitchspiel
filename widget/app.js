const view = document.querySelector("#view");
const phone = document.querySelector(".phone");
const topOverlay = document.querySelector("#topOverlay");
const topOverlayContent = document.querySelector("#topOverlayContent");
const helpButton = document.querySelector("#helpButton");
const notificationButton = document.querySelector("#notificationButton");
const params = new URLSearchParams(location.search);
const userId = params.get("userId") || "";
phone.dataset.popout = params.get("popout") === "true";

function getApiBaseUrl() {
  const configuredBaseUrl = params.get("apiBase");
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/$/, "");

  const isLocalHost = ["127.0.0.1", "localhost"].includes(location.hostname);
  const usesLocalOverlayServer = isLocalHost && location.port === "3010";

  // Live Server stellt nur die Widget-Dateien bereit. In diesem Fall kommen
  // die echten Spielerdaten von Hetzner. Auf Hetzner und beim lokalen
  // Overlay-Server bleibt die API dagegen relativ zur aktuellen Seite.
  if (isLocalHost && !usesLocalOverlayServer) {
    return "https://overlay.schiggygang.de";
  }

  return "";
}

const apiBaseUrl = getApiBaseUrl();

let state = null;
let page = "home";
let pcSection = "storage";
let historyFilter = "all";
let openOverlay = null;
let selectedMon = null;
let selectedContext = null;
let emptySlotMenu = null;
const greetings = ["Schön, dich zu sehen", "Bereit für ein neues Abenteuer", "Dein Partner wartet schon", "Willkommen zurück"];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
const monName = (mon) => mon?.displayName || mon?.name || "Unbekannt";
const monKey = (mon) => mon?.dexId != null ? `dex:${mon.dexId}` : `name:${String(monName(mon)).toLowerCase()}`;
const caughtKeys = () => new Set((state?.player?.history?.length ? state.player.history : state?.player?.caught || []).map(monKey));

function heading(title, subtitle, aside = "") {
  return `<div class="hero"><div><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div>${aside}</div>`;
}

const pokemonSprite = (mon) => mon?.spriteUrl || (mon?.dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(mon.dexId)}.png` : "");
const localItemSprites = {
  xp_candy_s: "assets/items/xp-candy-s.svg",
  xp_candy_m: "assets/items/xp-candy-m.svg",
  xp_candy_l: "assets/items/xp-candy-l.svg"
};
const itemSprite = (id) => localItemSprites[id]
  || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${String(id).replaceAll("_", "-")}.png`;
const pokemonImage = (mon, className = "") => {
  const src = pokemonSprite(mon);
  return src ? `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(monName(mon))}" loading="lazy">` : `<div class="stored-placeholder">◓</div>`;
};

function activePartner() {
  const party = state?.player?.party || { activeSlot:0, slots:[] };
  const activeSlot = Number(party.activeSlot || 0);
  return party.slots?.[activeSlot] || party.slots?.find(Boolean) || null;
}

function monLevel(mon) {
  return state?.player?.progress?.[`${userId}:${Number(mon?.caughtAt)}`]?.level || mon?.level || 1;
}

function xpToNextLevel(level) {
  const normalizedLevel = Math.max(1, Number(level) || 1);
  return normalizedLevel >= 100 ? 0 : 40 + normalizedLevel * 20;
}

function rarityClass(rarity) {
  const normalized = String(rarity || "common").trim().toLowerCase();
  return ["common", "uncommon", "rare", "epic", "legendary", "gottheit"].includes(normalized) ? normalized : "common";
}

const typeDetails = {
  normal:"Normal", fire:"Feuer", water:"Wasser", electric:"Elektro",
  grass:"Pflanze", ice:"Eis", fighting:"Kampf", poison:"Gift",
  ground:"Boden", flying:"Flug", psychic:"Psycho", bug:"Käfer",
  rock:"Gestein", ghost:"Geist", dragon:"Drache", dark:"Unlicht",
  steel:"Stahl", fairy:"Fee"
};
const pokemonTypeCache = new Map();

function normalizedTypes(mon) {
  const raw = Array.isArray(mon?.types) ? mon.types : [];
  return raw.map((entry) => String(entry?.type?.name || entry?.name || entry).toLowerCase()).filter(Boolean);
}

async function ensurePokemonTypes(mon) {
  if (!mon?.dexId || normalizedTypes(mon).length) return;
  const dexId = Number(mon.dexId);
  if (!pokemonTypeCache.has(dexId)) {
    pokemonTypeCache.set(dexId, fetch(`https://pokeapi.co/api/v2/pokemon/${dexId}`, { cache:"force-cache" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Typen nicht verfügbar")))
      .then((pokemon) => pokemon.types.map((entry) => entry.type.name))
      .catch(() => []));
  }
  mon.types = await pokemonTypeCache.get(dexId);
}

function typeMarkup(mon) {
  const types = normalizedTypes(mon);
  if (!types.length) return `<div class="pokemon-types"><span class="type-chip type-unknown"><span aria-hidden="true">?</span>Typen nicht verfügbar</span></div>`;
  return `<div class="pokemon-types">${types.map((type) => {
    const label = typeDetails[type] || type;
    const icon = typeDetails[type]
      ? `<img class="type-icon" src="assets/pokemon-type-icons/${encodeURIComponent(type)}.png" alt="" aria-hidden="true">`
      : `<span class="type-icon type-icon-fallback" aria-hidden="true">?</span>`;
    return `<span class="type-chip type-${escapeHtml(type)}">${icon}${escapeHtml(label)}</span>`;
  }).join("")}</div>`;
}

function moveLevel(move) {
  return Math.max(1, Number(move?.level ?? move?.levelLearnedAt ?? move?.learnedAt ?? 1) || 1);
}

function moveName(move) {
  return typeof move === "string" ? move : move?.displayName || move?.name || "Unbekannte Attacke";
}

function ownedMon(caughtAt) {
  return (state?.player?.caught || []).find((mon) => Number(mon?.caughtAt) === Number(caughtAt)) ||
    (state?.player?.party?.slots || []).find((mon) => Number(mon?.caughtAt) === Number(caughtAt));
}

function dialog(markup) {
  closeEmptySlotMenu();
  document.querySelector("#actionDialog")?.remove();
  const layer = document.createElement("div");
  layer.id = "actionDialog";
  layer.className = "dialog-layer";
  layer.innerHTML = `<div class="dialog-card" role="dialog" aria-modal="true">${markup}</div>`;
  phone.append(layer);
  layer.addEventListener("click", (event) => { if (event.target === layer || event.target.closest("[data-dialog-close]")) layer.remove(); });
  return layer;
}

function closeEmptySlotMenu() {
  emptySlotMenu?.remove();
  emptySlotMenu = null;
}

function showEmptySlotMenu(button) {
  closeEmptySlotMenu();
  const menu = document.createElement("div");
  menu.className = "slot-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button type="button" role="menuitem" data-add-pokemon><span aria-hidden="true">＋</span>Pokémon hinzufügen</button>`;
  document.body.append(menu);
  menu.anchorButton = button;

  const buttonRect = button.getBoundingClientRect();
  const navigationTop = phone.querySelector(".tabs")?.getBoundingClientRect().top;
  const lowerBoundary = Number.isFinite(navigationTop) ? navigationTop - 8 : window.innerHeight - 8;
  const menuHeight = menu.offsetHeight;
  const fitsBelow = buttonRect.bottom + 5 + menuHeight <= lowerBoundary;
  const top = fitsBelow
    ? buttonRect.bottom + 5
    : Math.max(8, buttonRect.top - menuHeight - 5);

  menu.style.left = `${buttonRect.left + 12}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${Math.max(0, buttonRect.width - 24)}px`;
  emptySlotMenu = menu;
  menu.querySelector("[data-add-pokemon]").addEventListener("click", (event) => {
    event.stopPropagation();
    const slotIndex = Number(button.dataset.emptySlot);
    closeEmptySlotMenu();
    showPcPokemonPicker(slotIndex);
  });
}

function showPcPokemonPicker(slotIndex) {
  const teamKeys = new Set((state.player.party?.slots || []).filter(Boolean).map(monKey));
  const available = (state.player.caught || []).filter((mon) => !teamKeys.has(monKey(mon)));
  const layer = dialog(`<button class="dialog-close" data-dialog-close aria-label="PC schließen">×</button><div class="pc-picker-head"><small>PC · LAGER</small><h2>Pokémon hinzufügen</h2><p>Wähle ein Pokémon für Slot ${slotIndex + 1}.</p></div><div class="pc-picker-grid">${available.map((mon) => `<button type="button" class="pc-picker-mon" data-pc-pokemon="${Number(mon.caughtAt)}">${pokemonImage(mon, "pc-picker-sprite")}<span><strong>${escapeHtml(monName(mon))}</strong><small>Lv. ${escapeHtml(monLevel(mon))}</small></span></button>`).join("") || `<div class="empty pc-picker-empty">Im Lager ist kein weiteres Pokémon verfügbar.</div>`}</div>`);
  layer.querySelectorAll("[data-pc-pokemon]").forEach((button) => button.addEventListener("click", async () => {
    try {
      button.disabled = true;
      await postAction("team_add", button.dataset.pcPokemon, { slotIndex });
      layer.remove();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  }));
}

function reportMarkup(mon) {
  const level = monLevel(mon);
  const progress = state.player.progress?.[`${userId}:${Number(mon.caughtAt)}`] || {};
  const currentXp = level >= 100 ? 0 : Math.max(0, Number(progress.xp ?? mon.xp ?? 0));
  const requiredXp = xpToNextLevel(level);
  const xpPercent = level >= 100 ? 100 : Math.min(100, Math.round(currentXp / requiredXp * 100));
  const learnset = [mon.learnset, mon.availableMoves, mon.moves].find((moves) => Array.isArray(moves) && moves.length) || [];
  const availableMoves = learnset.filter((move) => moveLevel(move) <= level);
  const lockedMoves = learnset.filter((move) => moveLevel(move) > level).sort((a, b) => moveLevel(a) - moveLevel(b));
  const selectedMoveNames = new Set((Array.isArray(mon.moves) ? mon.moves : []).map(moveName));
  const stats = mon.stats || {};
  const moveMenu = availableMoves.length
    ? `<div class="move-list">${availableMoves.map((move) => `<label><input type="checkbox" data-move-choice ${selectedMoveNames.has(moveName(move)) ? "checked" : ""}><span>${escapeHtml(moveName(move))}</span><small>ab Lv. ${moveLevel(move)}</small></label>`).join("")}</div><p class="report-hint">Bis zu vier Attacken auswählbar. Die Speicherung wird mit dem Kampfsystem aktiviert.</p>`
    : `<p>Noch keine Attacken für dieses Pokémon hinterlegt.</p>`;
  const nextMove = lockedMoves[0];
  return `<button class="dialog-close" data-dialog-close aria-label="Schließen">×</button><div class="report-head rarity-${rarityClass(mon.rarity)}">${pokemonImage(mon, "report-sprite")}<div><small>Pokémon-Bericht</small><h2>${escapeHtml(monName(mon))}</h2><span>#${escapeHtml(mon.dexId || "—")} · Level ${level}${mon.isShiny ? " · ✨ Shiny" : ""}</span></div></div><div class="report-summary"><div class="xp-card"><div class="xp-label"><small>Fortschritt</small><strong>${level >= 100 ? "Max. Level" : `${currentXp} / ${requiredXp} XP`}</strong></div><div class="xp-track" role="progressbar" aria-label="Erfahrung bis zum nächsten Level" aria-valuemin="0" aria-valuemax="${requiredXp}" aria-valuenow="${currentXp}"><span style="width:${xpPercent}%"></span></div></div>${typeMarkup(mon)}</div><section class="report-section"><details class="move-menu" open><summary><span>Attacken</span><small>${availableMoves.length} verfügbar</small></summary>${moveMenu}${nextMove ? `<p class="next-move">Nächste Attacke auf Lv. ${moveLevel(nextMove)}: ${escapeHtml(moveName(nextMove))}</p>` : ""}</details></section><section class="report-section"><h3>Statuswerte</h3>${Object.keys(stats).length ? Object.entries(stats).map(([key,value]) => `<div class="stat-line"><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`).join("") : `<p>Feste Maximalwerte werden mit dem Kampfsystem ergänzt.</p>`}</section>`;
}

async function postAction(action, caughtAt, extra = {}) {
  const response = await fetch(`${apiBaseUrl}/api/widget/action`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ userId, action, caughtAt, ...extra }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(({ team_full:"Dein Team ist voll.", slot_occupied:"Dieser Teamslot ist inzwischen belegt. Bitte wähle einen anderen.", already_in_team:"Dieses Pokémon ist bereits im Team.", remove_from_team_first:"Lege das Pokémon zuerst auf dem PC ab.", not_enough_items:"Du hast nicht genug davon.", item_not_supported_yet:"Entwicklungssteine folgen mit dem Evolutions-Dialog." })[result.error] || result.error || "Aktion fehlgeschlagen");
  await load();
}

function showPokemonMenu(mon, context) {
  if (!mon) {
    alert("Dieses Pokémon konnte nicht eindeutig geladen werden. Bitte aktualisiere das Widget.");
    return;
  }
  selectedMon = mon; selectedContext = context;
  const actions = context === "storage"
    ? [["report","Bericht"],["team_add","Ins Team"],["item","Item verwenden"],["release","Freilassen"]]
    : [["report","Bericht"],["team_remove","Auf PC ablegen"],["item","Item verwenden"],["team_active","Aktiv setzen"]];
  const layer = dialog(`<button class="dialog-close" data-dialog-close>×</button><div class="menu-mon">${pokemonImage(mon,"menu-sprite")}<div><strong>${escapeHtml(monName(mon))}</strong><small>Lv. ${monLevel(mon)}</small></div></div><div class="action-menu">${actions.map(([id,label]) => `<button data-mon-action="${id}" class="${id === "release" ? "danger" : ""}">${label}</button>`).join("")}</div>`);
  layer.querySelectorAll("[data-mon-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.monAction;
    if (action === "report") {
      await ensurePokemonTypes(mon);
      layer.querySelector(".dialog-card").innerHTML = reportMarkup(mon);
      layer.querySelectorAll("[data-move-choice]").forEach((choice) => choice.addEventListener("change", () => {
        const checked = layer.querySelectorAll("[data-move-choice]:checked");
        if (checked.length > 4) {
          choice.checked = false;
          alert("Ein Pokémon kann höchstens vier Attacken gleichzeitig einsetzen.");
        }
      }));
      return;
    }
    if (action === "item") { layer.remove(); showItemPicker(mon); return; }
    if (action === "release" && !confirm(`${monName(mon)} wirklich freilassen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    try { button.disabled = true; await postAction(action, mon.caughtAt); layer.remove(); } catch (error) { alert(error.message); button.disabled = false; }
  }));
}

function showItemPicker(mon, preselectedItem = "") {
  const items = Object.entries(state.player.items || {}).filter(([,amount]) => Number(amount) > 0);
  const layer = dialog(`<button class="dialog-close" data-dialog-close>×</button><h2>Auf ${escapeHtml(monName(mon))} anwenden</h2><div class="item-picker">${items.map(([id,amount]) => `<button data-pick-item="${id}" ${preselectedItem && id !== preselectedItem ? "hidden" : ""}><span class="item-icon"><img src="${itemSprite(id)}" alt=""></span><strong>${escapeHtml(({xp_candy_s:"XP-Bonbon S",xp_candy_m:"XP-Bonbon M",xp_candy_l:"XP-Bonbon L"})[id] || id.replaceAll("_"," "))}</strong><small>${amount}×</small></button>`).join("") || "<p>Keine Items vorhanden.</p>"}</div>`);
  layer.querySelectorAll("[data-pick-item]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.pickItem;
    const isCandy = id.startsWith("xp_candy_");
    const max = Number(state.player.items[id] || 1);
    const amount = isCandy ? Math.max(1, Math.min(max, Number(prompt(`Wie viele möchtest du verwenden? (1–${max})`, "1") || 0))) : 1;
    if (!amount || !confirm(`${amount}× ${button.querySelector("strong").textContent} auf ${monName(mon)} anwenden?`)) return;
    postAction("item_use", mon.caughtAt, { itemId:id, amount }).then(() => layer.remove()).catch((error) => alert(error.message));
  }));
}

function bindPcActions() {
  view.querySelectorAll("[data-mon-menu]").forEach((button) => button.addEventListener("click", () => {
    showPokemonMenu(ownedMon(button.dataset.caughtAt), button.dataset.monMenu);
  }));
  view.querySelectorAll("[data-item-id]").forEach((button) => button.addEventListener("click", () => {
    const team = (state.player.party?.slots || []).filter(Boolean);
    const layer = dialog(`<button class="dialog-close" data-dialog-close>×</button><h2>Auf Pokémon anwenden</h2><div class="target-grid">${team.map((mon) => `<button data-item-target="${Number(mon.caughtAt)}">${pokemonImage(mon,"target-sprite")}<strong>${escapeHtml(monName(mon))}</strong><small>Lv. ${monLevel(mon)}</small></button>`).join("") || "<p>Dein Team ist leer.</p>"}</div>`);
    layer.querySelectorAll("[data-item-target]").forEach((target) => target.addEventListener("click", () => { layer.remove(); showItemPicker(ownedMon(target.dataset.itemTarget), button.dataset.itemId); }));
  }));
  view.querySelectorAll("[data-empty-slot]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (emptySlotMenu?.anchorButton === button) {
      closeEmptySlotMenu();
      return;
    }
    showEmptySlotMenu(button);
  }));
}

function renderHome() {
  const partner = activePartner();
  const caught = state.player.caught?.length || 0;
  const discovered = caughtKeys().size;

  const greeting = greetings[new Date().getDate() % greetings.length];
  const ranks = state.ranks || {};
  const rankCard = (label, data) => `<article class="rank-card"><small>${label}</small><strong>${data?.rank ? `#${data.rank}` : "—"}</strong><span>${Number(data?.value || 0)} · von ${Number(data?.total || 0)}</span></article>`;
  view.innerHTML = heading("Willkommen!", `${greeting}, ${state.player.display}!`) +
    (partner ? `<article class="partner-card">
      <span class="partner-label">DEIN PARTNER-POKÉMON</span>
      <div class="partner-visual">${partner.spriteUrl ? `<img src="${escapeHtml(partner.spriteUrl)}" alt="${escapeHtml(monName(partner))}">` : `<div class="partner-placeholder">◓</div>`}</div>
      <div class="partner-info"><div><strong>${escapeHtml(monName(partner))}</strong><small>${partner.isShiny ? "✨ Shiny · " : ""}Aktiver Begleiter</small></div><b>Lv. ${escapeHtml(partner.level || 1)}</b></div>
    </article>` : `<article class="card partner-empty"><div class="partner-placeholder">◓</div><strong>Noch kein Partner gewählt</strong><p class="muted">Wähle im Team einen aktiven Begleiter aus.</p></article>`) +
    `<div class="home-stats"><article class="card"><strong>${discovered}</strong><small>entdeckt</small></article><article class="card"><strong>${caught}</strong><small>im Besitz</small></article><article class="card"><strong>${(state.player.party?.slots || []).filter(Boolean).length}/6</strong><small>im Team</small></article></div><section class="rank-section"><h2>Deine Ränge</h2><div class="rank-grid">${rankCard("Fänge", ranks.catches)}${rankCard("Verschiedene", ranks.distinct)}${rankCard("PvP-Kämpfe", ranks.battles)}</div></section>`;
}

function renderDex() {
  const owned = caughtKeys();
  const dex = state.dex || [];
  view.innerHTML = heading("Pokédex", "", `<div class="meter">${owned.size}/${dex.length}</div>`) +
    `<div class="grid">${dex.map((mon) => { const found = owned.has(monKey(mon)); return `<article class="card mon ${found ? "" : "missing"}">${found ? pokemonImage(mon) : `<img class="unknown-pokemon" src="assets/unknown-pokemon.png" alt="Unbekanntes Pokémon">`}<strong>${found ? escapeHtml(monName(mon)) : "???"}</strong><small>#${escapeHtml(mon.dexId || "—")}</small></article>`; }).join("")}</div>`;
}

function pcNavigation() {
  const sections = [
    ["storage", "▦", "Lager"],
    ["team", "👥", "Team"],
    ["items", "🎒", "Items"]
  ];
  return `<div class="pc-tabs" role="tablist" aria-label="PC-Bereiche">${sections.map(([id, icon, label]) =>
    `<button type="button" role="tab" data-pc-section="${id}" aria-selected="${pcSection === id}" class="${pcSection === id ? "active" : ""}"><span>${icon}</span>${label}</button>`
  ).join("")}</div>`;
}

function renderStorage() {
  const caught = [...(state.player.caught || [])].sort((a, b) => eventTimestamp(b) - eventTimestamp(a));
  return caught.length
    ? `<div class="storage-grid">${caught.map((mon) => `<button class="card stored-mon mon-button" data-mon-menu="storage" data-caught-at="${Number(mon.caughtAt)}">${pokemonImage(mon)}<div><strong>${escapeHtml(monName(mon))}</strong><small>Lv. ${escapeHtml(monLevel(mon))}${mon.isShiny ? " · ✨ Shiny" : ""}</small></div></button>`).join("")}</div>`
    : `<div class="empty">Dein Lager ist noch leer.</div>`;
}

function renderTeamSection() {
  const party = state.player.party || { activeSlot:0, slots:[] };
  const slots = Array.from({ length:6 }, (_, i) => party.slots?.[i] || null);
  return `<div class="party">${slots.map((mon, i) => mon ? `<button class="card slot mon-button ${Number(party.activeSlot) === i ? "active" : ""}" data-mon-menu="team" data-caught-at="${Number(mon.caughtAt)}">${Number(party.activeSlot) === i ? '<span class="star" title="Partner-Pokémon">★</span>' : ""}${pokemonImage(mon, "team-sprite")}<p class="level">Lv. ${escapeHtml(mon.level || 1)}</p><strong>${escapeHtml(monName(mon))}</strong></button>` : `<button type="button" class="card slot empty-slot" data-empty-slot="${i}" aria-haspopup="menu"><span>Slot ${i + 1} leer</span></button>`).join("")}</div>`;
}

function renderItemsSection() {
  const labels = { fire_stone:"Feuerstein", water_stone:"Wasserstein", thunder_stone:"Donnerstein", leaf_stone:"Blattstein", moon_stone:"Mondstein", xp_candy_s:"XP-Bonbon S", xp_candy_m:"XP-Bonbon M", xp_candy_l:"XP-Bonbon L" };
  return `<div class="list">${Object.entries(labels).map(([id, label]) => `<button class="card row item-row item-button" data-item-id="${id}" ${Number(state.player.items?.[id] || 0) < 1 ? "disabled" : ""}><span class="item-icon"><img src="${itemSprite(id)}" alt="" loading="lazy" onerror="this.hidden=true;this.parentElement.classList.add('fallback')"></span><strong>${label}</strong><span class="amount">${Number(state.player.items?.[id] || 0)}×</span></button>`).join("")}</div>`;
}

function renderPc() {
  const content = { storage:renderStorage, team:renderTeamSection, items:renderItemsSection }[pcSection]();
  view.innerHTML = pcNavigation() + `<section class="pc-content">${content}</section>`;
  view.querySelectorAll("[data-pc-section]").forEach((button) => button.addEventListener("click", () => {
    pcSection = button.dataset.pcSection;
    renderPc();
  }));
  bindPcActions();
}

function renderMulti() {
  const raid = state.multiplayer?.raid;
  const players = state.multiplayer?.availablePlayers || [];
  view.innerHTML = heading("Multiplayer", "Nur mit Personen aus dem aktuellen Chat") + `<div class="action-grid"><button class="card action"><span>🔄</span><strong>Tausch</strong><p class="muted">${state.multiplayer?.trades?.length || 0} offene Vorgänge</p></button><button class="card action"><span>🐲</span><strong>Raid</strong><p class="muted">${raid ? "Ein Raid ist aktiv" : "Aktuell kein Raid"}</p></button><button class="card action" disabled><span>⚔️</span><strong>PvP</strong><p class="muted">Kommt später</p></button></div><section class="chat-players"><h2>Im Chat verfügbar</h2>${players.length ? players.map((player) => `<span>@${escapeHtml(player.display)}</span>`).join("") : `<p>Aktuell wurde niemand Weiteres im Chat gesehen.</p>`}</section>`;
}

function renderRanks() {
  const unique = caughtKeys().size;
  const catches = state.player.caught?.length || 0;
  view.innerHTML = heading("Ranks", "Deine bisherigen Erfolge") + `<div class="list"><article class="card row"><strong>Entdeckte Pokémon</strong><span class="amount">${unique}</span></article><article class="card row"><strong>Pokémon im Besitz</strong><span class="amount">${catches}</span></article><article class="card row"><strong>Teamstärke</strong><span class="amount">${(state.player.party?.slots || []).filter(Boolean).length}/6</span></article></div>`;
}

function eventTimestamp(event) {
  return Number(event?.caughtAt || event?.firstOwnedAt || event?.createdAt || event?.timestamp || event?.at || 0);
}

function formatEventDate(timestamp) {
  if (!timestamp) return "Datum unbekannt";
  return new Intl.DateTimeFormat("de-DE", { dateStyle:"medium", timeStyle:"short" }).format(new Date(timestamp));
}

function renderHistory() {
  const catches = (state.player.history?.length ? state.player.history : state.player.caught || [])
    .map((mon) => ({ type:"Fang", timestamp:eventTimestamp(mon), mon }))
    .sort((a, b) => b.timestamp - a.timestamp);
  const tabs = [["all", "Alle"], ["catch", "Fänge"], ["trade", "Tausche"], ["battle", "Kämpfe"]];
  const visibleEvents = ["all", "catch"].includes(historyFilter) ? catches : [];

  view.innerHTML = heading("Historie", "") + `<div class="history-tabs" role="tablist">${tabs.map(([id, label]) => `<button data-history-filter="${id}" class="${historyFilter === id ? "active" : ""}">${label}</button>`).join("")}</div>` +
    (visibleEvents.length ? `<div class="list history-list">${visibleEvents.map((event) => `<article class="card history-row"><div class="history-ball" aria-label="Fang"></div>${pokemonImage(event.mon, "history-sprite")}<div><strong>${escapeHtml(monName(event.mon))} gefangen</strong><small>${escapeHtml(formatEventDate(event.timestamp))}</small></div><span class="event-type">Fang</span></article>`).join("")}</div>` : `<div class="empty">In diesem Bereich sind noch keine Ereignisse vorhanden.</div>`) +
    `<p class="history-note">Abgeschlossene Tausche und Kämpfe erscheinen hier, sobald der Bot diese Ereignisse dauerhaft protokolliert.</p>`;
  view.querySelectorAll("[data-history-filter]").forEach((button) => button.addEventListener("click", () => {
    historyFilter = button.dataset.historyFilter;
    renderHistory();
  }));
}

function notificationsMarkup() {
  const notifications = state.notifications || [];
  return heading("Benachrichtigungen", "Tausch- und Kampfanfragen") + (notifications.length ? `<div class="list">${notifications.map(() => `<article class="card">🔄 Neue Tauschanfrage</article>`).join("")}</div>` : `<div class="empty">Alles ruhig – keine neuen Anfragen.</div>`);
}

function helpMarkup() {
  return heading("Hilfe", "So funktioniert dein PokéDex") + `<div class="list"><article class="card"><strong>⌂ Home</strong><p class="muted">Zeigt deinen Partner und deinen Fortschritt.</p></article><article class="card"><strong>◓ Pokédex</strong><p class="muted">Zeigt alle entdeckten Pokémon.</p></article><article class="card"><strong>▣ PC</strong><p class="muted">Öffnet Lager, Team und Items.</p></article><article class="card"><strong>⚔ Multiplayer</strong><p class="muted">Tauschen, Raids und später PvP.</p></article><article class="card"><strong>↺ Historie</strong><p class="muted">Zeigt Fänge und später auch Tausche und Kämpfe.</p></article></div>`;
}

function closeTopOverlay() {
  openOverlay = null;
  topOverlay.hidden = true;
  topOverlayContent.innerHTML = "";
  helpButton.setAttribute("aria-expanded", "false");
  notificationButton.setAttribute("aria-expanded", "false");
}

function toggleTopOverlay(type) {
  if (!state) return;
  if (openOverlay === type) {
    closeTopOverlay();
    return;
  }

  openOverlay = type;
  topOverlayContent.innerHTML = type === "notifications" ? notificationsMarkup() : helpMarkup();
  topOverlay.hidden = false;
  topOverlay.scrollTop = 0;
  helpButton.setAttribute("aria-expanded", String(type === "help"));
  notificationButton.setAttribute("aria-expanded", String(type === "notifications"));
}

function render() {
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  ({ home:renderHome, dex:renderDex, pc:renderPc, multi:renderMulti, history:renderHistory }[page] || renderHome)();
}

async function load() {
  if (!userId) { view.innerHTML = `<div class="empty"><strong>Entwicklungsansicht</strong><p>Öffne das Widget mit <code>?userId=TWITCH_ID</code>.</p></div>`; return; }
  try {
    const response = await fetch(
      `${apiBaseUrl}/api/widget/player?userId=${encodeURIComponent(userId)}`,
      { cache:"no-store" }
    );
    state = await response.json();
    if (!response.ok || !state.ok) throw new Error(state.error || "Laden fehlgeschlagen");
    const metaResponse = await fetch(`${apiBaseUrl}/api/widget/meta?userId=${encodeURIComponent(userId)}`, { cache:"no-store" });
    if (metaResponse.ok) {
      const meta = await metaResponse.json();
      state.ranks = meta.ranks || {};
      state.multiplayer ??= {};
      state.multiplayer.availablePlayers = meta.availablePlayers || [];
    }
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

helpButton.setAttribute("aria-expanded", "false");
helpButton.setAttribute("aria-controls", "topOverlay");
notificationButton.setAttribute("aria-expanded", "false");
notificationButton.setAttribute("aria-controls", "topOverlay");
document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => { closeTopOverlay(); page = button.dataset.page; render(); }));
notificationButton.addEventListener("click", () => toggleTopOverlay("notifications"));
helpButton.addEventListener("click", () => toggleTopOverlay("help"));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && openOverlay) closeTopOverlay(); });
document.addEventListener("click", (event) => {
  if (emptySlotMenu && !event.target.closest("[data-empty-slot]")) closeEmptySlotMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && emptySlotMenu) closeEmptySlotMenu();
});
window.addEventListener("resize", closeEmptySlotMenu);
window.addEventListener("scroll", closeEmptySlotMenu, true);
load();
setInterval(load, 15000000);
