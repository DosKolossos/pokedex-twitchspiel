const fs = require("fs");

function emptyState() {
  return { version: 2, jobs: [] };
}

function normalize(value) {
  if (value?.version === 2 && Array.isArray(value.jobs)) return value;
  // v3.1 stored one last battle directly. Do not replay it after the update.
  return emptyState();
}

function read(filePath, readJsonSafe) {
  return normalize(readJsonSafe(filePath, emptyState()));
}

function write(filePath, state) {
  fs.writeFileSync(filePath, JSON.stringify(normalize(state), null, 2));
}

function enqueue(filePath, readJsonSafe, battle) {
  const state = read(filePath, readJsonSafe);
  state.jobs.push({ ...battle, status: "pending", queuedAt: Date.now(), startedAt: null, completedAt: null, announcedAt: null });
  state.jobs = state.jobs.slice(-50);
  write(filePath, state);
  return battle;
}

function claimNext(filePath, readJsonSafe) {
  const state = read(filePath, readJsonSafe);
  let job = state.jobs.find((entry) => entry.status === "playing");
  if (!job) {
    job = state.jobs.find((entry) => entry.status === "pending");
    if (job) {
      job.status = "playing";
      job.startedAt = Date.now();
      write(filePath, state);
    }
  }
  return job || null;
}

function complete(filePath, readJsonSafe, id) {
  const state = read(filePath, readJsonSafe);
  const job = state.jobs.find((entry) => String(entry.id) === String(id));
  if (!job) return { ok: false, reason: "not_found" };
  if (job.status === "completed") return { ok: true, alreadyCompleted: true, job };
  if (job.status !== "playing") return { ok: false, reason: "not_playing" };
  job.status = "completed";
  job.completedAt = Date.now();
  write(filePath, state);
  return { ok: true, alreadyCompleted: false, job };
}

function clear(filePath) {
  write(filePath, emptyState());
}

module.exports = { emptyState, read, write, enqueue, claimNext, complete, clear };
