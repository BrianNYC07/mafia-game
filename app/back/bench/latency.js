// Latency benchmark: boots the real server in its own process, fills N
// concurrent rooms with real socket.io clients, and measures round-trip time
// for the request/response path every phase component uses
// (`request_alive_userList` -> `user_alive_list`).
//
// Scope: this measures SERVER-SIDE event handling (seat authz, room state
// lookup, serialization) under concurrency, over loopback. It is not a
// real-world network latency figure. See BENCHMARK.md.
//
// Usage: npm run bench

const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 3910;
const URL = `http://localhost:${PORT}`;
const LEVELS = [1, 10, 25, 50]; // concurrent rooms (5 players each)
const PINGS = 20; // saturated-phase pings per client (fits the 30-token burst)
const PROBE_PINGS = 60; // isolated-phase pings
// The server rate-limits each socket to ~15 events/s sustained (a production
// anti-abuse feature). The isolated probe paces itself under that ceiling so
// it measures handling latency rather than triggering the limiter.
const PROBE_INTERVAL_MS = 75;

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p50: at(50), p95: at(95), p99: at(99), max: s[s.length - 1],
  };
};
const fmt = (s) =>
  `n=${s.n} mean=${s.mean.toFixed(2)} p50=${s.p50.toFixed(2)} p95=${s.p95.toFixed(2)} p99=${s.p99.toFixed(2)} max=${s.max.toFixed(2)}`;

async function waitHealthy(ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${URL}/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server never became healthy");
}

// Record every event with a timestamp: one-shot events (joined, game_start)
// can land between awaits, so we check history before waiting.
function client(room) {
  const s = io(URL, { query: { room }, transports: ["websocket"] });
  s.log = [];
  s.onAny((event, ...args) => s.log.push({ event, args, t: performance.now() }));
  return s;
}

function once(s, event, ms = 20000) {
  const past = s.log.find((r) => r.event === event);
  if (past) return Promise.resolve(past);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), ms);
    s.once(event, (...args) => {
      clearTimeout(timer);
      resolve({ event, args, t: performance.now() });
    });
  });
}

// Listener attached synchronously before the emit — no race window.
function ping(s) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const timer = setTimeout(() => reject(new Error("ping timeout")), 10000);
    s.once("user_alive_list", () => {
      clearTimeout(timer);
      resolve(performance.now() - t0);
    });
    s.emit("request_alive_userList");
  });
}

async function runLevel(roomCount) {
  const joins = [];
  const rooms = await Promise.all(
    Array.from({ length: roomCount }, async (_, i) => {
      const roomId = `bench-${roomCount}-${i}`;
      const clients = [];
      for (let p = 0; p < 5; p++) {
        const s = client(roomId);
        await once(s, "connect");
        const t0 = performance.now();
        s.emit("join_room", { room: roomId, username: `u${p}` });
        joins.push((await once(s, "joined")).t - t0);
        clients.push(s);
      }
      await once(clients[4], "game_start");
      return clients;
    })
  );

  const all = rooms.flat();

  // (a) Saturated: every client pings as fast as it can. At high player
  // counts this measures the BENCHMARK CLIENT's event loop as much as the
  // server's — one Node process driving N sockets is itself a bottleneck.
  const saturated = [];
  await Promise.all(
    all.map(async (s) => {
      for (let k = 0; k < PINGS; k++) saturated.push(await ping(s));
    })
  );

  // (b) Isolated: all N players stay connected (server holds all the room
  // state and sockets), but only ONE client pings at a time. This isolates
  // the server's per-event handling cost from client-side contention, and is
  // the number that actually describes the server.
  const isolated = [];
  const probe = all[0];
  await new Promise((r) => setTimeout(r, 2500)); // let every bucket refill
  for (let k = 0; k < PROBE_PINGS; k++) {
    isolated.push(await ping(probe));
    await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
  }

  for (const s of all) s.disconnect();

  return {
    rooms: roomCount,
    players: roomCount * 5,
    join: stats(joins),
    saturated: stats(saturated),
    isolated: stats(isolated),
  };
}

async function main() {
  const server = spawn(process.execPath, ["index.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), QUIET: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  try {
    await waitHealthy();
    console.log(`Server up on :${PORT}. Levels: ${LEVELS.join(", ")} rooms.\n`);
    const results = [];
    for (const n of LEVELS) {
      const t0 = performance.now();
      const r = await runLevel(n);
      console.log(`${String(n).padStart(2)} rooms / ${String(r.players).padStart(3)} players  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
      console.log(`   join      : ${fmt(r.join)} ms`);
      console.log(`   saturated : ${fmt(r.saturated)} ms  (all clients pinging; includes client-side contention)`);
      console.log(`   isolated  : ${fmt(r.isolated)} ms  (1 client pinging, ${r.players} connected; server cost)\n`);
      results.push(r);
    }
    fs.writeFileSync(
      path.join(__dirname, "results.json"),
      JSON.stringify({ ranAt: new Date().toISOString(), node: process.version, levels: results }, null, 2)
    );
    const peak = results[results.length - 1];
    console.log(`Peak: ${peak.players} concurrent players across ${peak.rooms} rooms, single instance`);
    console.log(`  isolated (server cost) : p50 ${peak.isolated.p50.toFixed(2)}ms / p99 ${peak.isolated.p99.toFixed(2)}ms`);
    console.log(`  saturated (all pinging): p50 ${peak.saturated.p50.toFixed(2)}ms / p99 ${peak.saturated.p99.toFixed(2)}ms`);
  } finally {
    server.kill();
  }
}

main().catch((e) => { console.error("Benchmark failed:", e); process.exit(1); });
