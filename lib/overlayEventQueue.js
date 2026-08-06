const fs = require("fs");

function emptyState() {
  return { version: 1, events: [] };
}

function normalize(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.events)) return emptyState();
  return value;
}

function read(filePath, readJson) {
  return normalize(readJson(filePath, emptyState()));
}

function write(filePath, state) {
  const next = normalize(state);
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2));
  fs.renameSync(temp, filePath);
}

function withLock(filePath, task) {
  const lockPath = `${filePath}.lock`;
  const limit = Date.now() + 2000;
  let fd;
  while (fd == null) {
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= limit) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return task(); }
  finally {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function compact(state) {
  const finished = state.events.filter((event) => event.status === "completed").slice(-20);
  const open = state.events.filter((event) => event.status !== "completed");
  state.events = [...finished, ...open];
  return state;
}

function enqueue(filePath, readJson, event) {
  return withLock(filePath, () => {
    const state = read(filePath, readJson);
    const id = String(event.id || `${event.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    if (state.events.some((entry) => entry.id === id && entry.status !== "completed")) {
      return { ok: false, reason: "duplicate", id };
    }
    state.events.push({ ...event, id, status: "pending", queuedAt: Date.now(), startedAt: null, completedAt: null });
    write(filePath, compact(state));
    return { ok: true, id };
  });
}

function head(filePath, readJson) {
  return read(filePath, readJson).events.find((event) => event.status !== "completed") || null;
}

function claimHead(filePath, readJson, type) {
  return withLock(filePath, () => {
    const state = read(filePath, readJson);
    const event = state.events.find((entry) => entry.status !== "completed");
    if (!event || event.type !== type) return null;
    if (event.status === "pending") {
      event.status = "active";
      event.startedAt = Date.now();
      write(filePath, state);
    }
    return event;
  });
}

function complete(filePath, readJson, id) {
  return withLock(filePath, () => {
    const state = read(filePath, readJson);
    const event = state.events.find((entry) => String(entry.id) === String(id));
    if (!event) return { ok: false, reason: "not_found" };
    if (event.status === "completed") return { ok: true, alreadyCompleted: true, event };
    if (event.status !== "active") return { ok: false, reason: "not_active" };
    event.status = "completed";
    event.completedAt = Date.now();
    write(filePath, compact(state));
    return { ok: true, alreadyCompleted: false, event };
  });
}

function hasOpenType(filePath, readJson, type) {
  return read(filePath, readJson).events.some((event) => event.type === type && event.status !== "completed");
}

function clear(filePath) {
  withLock(filePath, () => write(filePath, emptyState()));
}

module.exports = { emptyState, read, write, enqueue, head, claimHead, complete, hasOpenType, clear };
