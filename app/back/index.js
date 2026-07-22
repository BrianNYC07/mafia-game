// Authoritative Mafia game server.
//
// Design notes (see AUDIT.md for the findings this addresses):
// - All game state lives in the per-room registry below (`rooms`). Handlers
//   are synchronous over that state, so there are no read-modify-write races
//   across await points. Nothing secret is ever broadcast: each outbound
//   message is filtered per recipient (C1–C5).
// - The server owns the phase clock, night resolution, vote tally, and win
//   evaluation. Clients only ever *request* actions; the server validates
//   actor identity, role, phase, and liveness for every event.
// - Identity: on first join the server issues a random token. A reconnect
//   presenting the same (room, username, token) rebinds to the existing seat
//   with full private state restored (H4).

const express = require("express");
const http = require("http");
const cors = require("cors");
const crypto = require("crypto");
const { Server } = require("socket.io");
const {
  PHASES,
  ROOM_SIZE,
  NIGHT_ROLES,
  pickRole,
  resolveNight,
  tallyVotes,
  checkWin,
} = require("./game");
const { RoomRegistry } = require("./registry");

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
// Multi-instance mode (M1): set REDIS_URL on every instance behind an nginx
// `hash $arg_room consistent` upstream (see deploy/nginx.conf.example).
// Without REDIS_URL the server runs exactly as before, single-instance.
const REDIS_URL = process.env.REDIS_URL || "";
const INSTANCE_ID = process.env.INSTANCE_ID || `${require("os").hostname()}:${PORT}:${crypto.randomBytes(4).toString("hex")}`;
// How long a disconnected player's seat is held before they are treated as
// gone (removed pre-game, eliminated mid-game).
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 60_000;
// Length of one game-clock tick. Only tests should override this.
const TICK_MS = Number(process.env.TICK_MS) || 1000;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, instance: INSTANCE_ID, rooms: rooms.size });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ["GET", "POST"] },
  // Reject oversized payloads at the transport layer (audit L5/§10).
  maxHttpBufferSize: 4096,
});

///////////////////////////////////////////////////////
// Room registry
///////////////////////////////////////////////////////

// roomId -> room. Single source of truth for all game state on this
// instance. Cross-instance, ownership is tracked in Redis via `registry`.
const rooms = new Map();
const registry = new RoomRegistry(null, INSTANCE_ID);

// Connect Redis and attach the socket.io adapter. Called only when REDIS_URL
// is set; failures are fatal in multi-instance mode (better than split-brain).
async function initRedis() {
  const { createClient } = require("redis");
  const { createAdapter } = require("@socket.io/redis-adapter");
  const pub = createClient({ url: REDIS_URL });
  const sub = pub.duplicate();
  pub.on("error", (err) => console.error(`[redis] ${err.message}`));
  sub.on("error", (err) => console.error(`[redis] ${err.message}`));
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));
  registry.client = pub;
  registry.startHeartbeat();
  console.log(`[redis] connected (${REDIS_URL}), instance=${INSTANCE_ID}`);
}

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      // username -> { username, role, alive, socketId, connected, token, graceTimer }
      players: new Map(),
      started: false,
      gameOver: false,
      phaseIndex: 0,
      timeLeft: PHASES[0].duration,
      interval: null,
      actions: { mafia: null, doctor: null, cop: null }, // this night's picks
      votes: {}, // voterUsername -> targetUsername (this evening)
    };
    rooms.set(roomId, room);
  }
  return room;
}

function destroyRoom(room) {
  if (room.interval) clearInterval(room.interval);
  for (const p of room.players.values()) {
    if (p.graceTimer) clearTimeout(p.graceTimer);
    const s = io.sockets.sockets.get(p.socketId);
    if (s) {
      s.leave(room.id);
      s.data.room = null;
      s.data.username = null;
    }
  }
  rooms.delete(room.id);
  registry.release(room.id); // async, fire-and-forget (no-op single-instance)
  log(room.id, "room destroyed");
}

// Structured-ish logging. Never log roles or night targets (audit M4).
function log(roomId, msg) {
  console.log(`[room=${roomId}] ${msg}`);
}

///////////////////////////////////////////////////////
// Derived views (per-recipient safe: usernames only)
///////////////////////////////////////////////////////

function userList(room) {
  return [...room.players.keys()];
}
function aliveList(room) {
  return [...room.players.values()].filter((p) => p.alive).map((p) => p.username);
}
function spectatingList(room) {
  return [...room.players.values()].filter((p) => !p.alive).map((p) => p.username);
}
function playersForWinCheck(room) {
  return [...room.players.values()].map((p) => ({ role: p.role, alive: p.alive }));
}

function broadcastLists(room) {
  io.to(room.id).emit("user_list", userList(room));
  io.to(room.id).emit("user_alive_list", aliveList(room));
  io.to(room.id).emit("user_spectating_list", spectatingList(room));
}

///////////////////////////////////////////////////////
// Game lifecycle
///////////////////////////////////////////////////////

function startGame(room) {
  room.started = true;
  room.phaseIndex = 0;
  room.timeLeft = PHASES[0].duration;
  io.to(room.id).emit("game_start");
  io.to(room.id).emit("time_update", { timeLeft: room.timeLeft, phaseIndex: room.phaseIndex });
  room.interval = setInterval(() => tick(room), TICK_MS);
  log(room.id, "game started");
}

function tick(room) {
  room.timeLeft -= 1;
  if (room.timeLeft > 0) {
    io.to(room.id).emit("time_update", { timeLeft: room.timeLeft, phaseIndex: room.phaseIndex });
    return;
  }
  advancePhase(room);
}

function advancePhase(room) {
  const leaving = PHASES[room.phaseIndex].name;

  if (leaving === "Night") resolveNightPhase(room);
  else if (leaving === "Evening") resolveVotePhase(room);
  if (room.gameOver) return;

  room.phaseIndex = (room.phaseIndex + 1) % PHASES.length;
  room.timeLeft = PHASES[room.phaseIndex].duration;

  if (PHASES[room.phaseIndex].name === "Night") {
    // New night: clear per-cycle state.
    room.actions = { mafia: null, doctor: null, cop: null };
    room.votes = {};
    for (const p of room.players.values()) p.pendingInvestigation = null;
  }

  io.to(room.id).emit("time_update", { timeLeft: room.timeLeft, phaseIndex: room.phaseIndex });
}

// Night -> Dawn: apply mafia/doctor actions, deliver the cop's private
// result, then evaluate the win condition.
function resolveNightPhase(room) {
  const { attacked, died } = resolveNight(room.actions);

  if (died && room.players.has(died)) {
    eliminate(room, died);
  }
  // Public outcome only: who was attacked and whether they died. Raw picks
  // (doctor/cop targets) are never sent to anyone.
  io.to(room.id).emit("night_result", { attacked, died: Boolean(died) });

  // Private, cop-only investigation result (C2: never a general role lookup).
  const cop = [...room.players.values()].find((p) => p.role === "cop");
  const target = room.actions.cop;
  if (cop && cop.alive && target && room.players.has(target)) {
    const result = { target, role: room.players.get(target).role };
    const copSocket = io.sockets.sockets.get(cop.socketId);
    if (copSocket && cop.connected) {
      copSocket.emit("investigation_result", result);
    } else {
      cop.pendingInvestigation = result; // deliver on reconnect
    }
  }

  maybeEndGame(room);
}

// Evening -> Dusk: tally votes, condemn, evaluate win (incl. fool).
function resolveVotePhase(room) {
  const condemned = tallyVotes(room.votes);
  let foolCondemned = false;

  if (condemned && room.players.has(condemned)) {
    foolCondemned = room.players.get(condemned).role === "fool";
    eliminate(room, condemned);
  }
  io.to(room.id).emit("return_condemned", condemned || "");

  maybeEndGame(room, { foolCondemned });
}

function eliminate(room, username) {
  const player = room.players.get(username);
  if (!player || !player.alive) return;
  player.alive = false;
  const s = io.sockets.sockets.get(player.socketId);
  if (s) s.emit("you_died");
  broadcastLists(room);
  log(room.id, `a player was eliminated (${userList(room).length} seats, ${aliveList(room).length} alive)`);
}

function maybeEndGame(room, opts = {}) {
  const winner = checkWin(playersForWinCheck(room), opts);
  if (!winner) return;
  room.gameOver = true;
  io.to(room.id).emit("game_over", { winner });
  log(room.id, `game over, winner: ${winner}`);
  destroyRoom(room);
}

///////////////////////////////////////////////////////
// Validation & rate limiting
///////////////////////////////////////////////////////

const NAME_RE = /^[\w -]{1,20}$/; // letters, digits, _, space, hyphen
const ROOM_RE = /^[\w-]{1,16}$/;
const MAX_CHAT_LEN = 300;

function isName(v) {
  return typeof v === "string" && NAME_RE.test(v);
}
function isRoomId(v) {
  return typeof v === "string" && ROOM_RE.test(v);
}

// Simple token bucket per socket: burst of 30, refill 15/s.
function allowEvent(socket) {
  const now = Date.now();
  const b = socket.data.bucket || (socket.data.bucket = { tokens: 30, last: now });
  b.tokens = Math.min(30, b.tokens + ((now - b.last) / 1000) * 15);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// Resolve the caller's authoritative seat, or null if they have none.
function seatOf(socket) {
  const { room: roomId, username } = socket.data;
  if (!roomId || !username) return null;
  const room = rooms.get(roomId);
  if (!room) return null;
  const player = room.players.get(username);
  if (!player || player.socketId !== socket.id) return null;
  return { room, player };
}

///////////////////////////////////////////////////////
// Socket handlers
///////////////////////////////////////////////////////

io.on("connection", (socket) => {
  socket.use((_packet, next) => {
    if (!allowEvent(socket)) return; // drop flooded events silently
    next();
  });

  // join_room: first join issues a seat + token; a matching token rebinds a
  // disconnected/refreshed player to their existing seat (reconnect).
  socket.on("join_room", (data) => {
    if (typeof data !== "object" || data === null) return;
    const { room: roomId, username, token } = data;
    if (!isRoomId(roomId) || !isName(username)) {
      return socket.emit("join_error", { reason: "Invalid name or room code." });
    }
    if (socket.data.room) {
      return socket.emit("join_error", { reason: "Already in a room." });
    }
    // The balancer hashes on the connection's ?room= query; joining a
    // different room than the one this socket was routed for would defeat
    // room-affinity. (Absent query = direct/single-instance connection.)
    const routedRoom = socket.handshake.query && socket.handshake.query.room;
    if (routedRoom && routedRoom !== roomId) {
      return socket.emit("join_error", { reason: "Connection was routed for a different room. Reconnect and try again." });
    }

    const isNewRoom = !rooms.has(roomId);
    const room = getOrCreateRoom(roomId);
    if (isNewRoom) {
      // Claim ownership in Redis (no-op single-instance). Runs async; with
      // correct consistent-hash routing a conflict can only mean the
      // balancer is misconfigured, so fail the room loudly and cleanly.
      registry.claim(roomId).then((result) => {
        if (result === "conflict" && rooms.get(roomId) === room) {
          log(roomId, `ownership conflict: room is homed on another instance (routing misconfigured?)`);
          io.to(room.id).emit("join_error", { reason: "This room code is hosted elsewhere; routing is misconfigured. Try a different room code." });
          destroyRoom(room);
        }
      });
    }
    const existing = room.players.get(username);

    // Reconnect path: same seat, correct token. Rebind the seat to the new
    // socket BEFORE kicking the old one, so the old socket's disconnect
    // handler fails its socketId guard instead of freeing the seat.
    if (existing && token && existing.token === token) {
      const oldId = existing.socketId;
      existing.socketId = socket.id;
      existing.connected = true;
      if (existing.graceTimer) {
        clearTimeout(existing.graceTimer);
        existing.graceTimer = null;
      }
      const old = io.sockets.sockets.get(oldId);
      if (old && oldId !== socket.id) old.disconnect(true); // one socket per seat
      bindSocket(socket, room, existing);
      log(room.id, "player reconnected");
      return;
    }

    if (existing) {
      return socket.emit("join_error", { reason: "That name is taken in this room." });
    }
    if (room.started) {
      return socket.emit("join_error", { reason: "That game already started." });
    }
    if (room.players.size >= ROOM_SIZE) {
      return socket.emit("join_error", { reason: "Room is full." });
    }

    // Fresh seat. This handler is synchronous from check to insert, so two
    // racing joins cannot both pass the capacity check (H3).
    const player = {
      username,
      role: pickRole([...room.players.values()].map((p) => p.role)),
      alive: true,
      socketId: socket.id,
      connected: true,
      token: crypto.randomBytes(16).toString("hex"),
      graceTimer: null,
    };
    room.players.set(username, player);
    bindSocket(socket, room, player);
    log(room.id, `player joined (${room.players.size}/${ROOM_SIZE})`);

    if (room.players.size === ROOM_SIZE && !room.started) {
      startGame(room);
    }
  });

  function bindSocket(socket, room, player) {
    socket.data.room = room.id;
    socket.data.username = player.username;
    socket.join(room.id);
    // Private self-state only: own role, own token, public phase info.
    socket.emit("joined", {
      room: room.id,
      username: player.username,
      role: player.role,
      token: player.token,
      alive: player.alive,
      started: room.started,
      phaseIndex: room.phaseIndex,
      timeLeft: room.timeLeft,
    });
    if (player.pendingInvestigation) {
      socket.emit("investigation_result", player.pendingInvestigation);
      player.pendingInvestigation = null;
    }
    broadcastLists(room);
  }

  // Night action from mafia/doctor/cop. Actor comes from the server's own
  // record — never from the payload.
  socket.on("night_action", (data) => {
    const seat = seatOf(socket);
    if (!seat) return;
    const { room, player } = seat;
    if (!room.started || PHASES[room.phaseIndex].name !== "Night") return;
    if (!player.alive || !NIGHT_ROLES.includes(player.role)) return;

    const target = data && data.target;
    if (!isName(target)) return;
    const targetPlayer = room.players.get(target);
    if (!targetPlayer || !targetPlayer.alive) return;
    // Only the doctor may self-target.
    if (target === player.username && player.role !== "doctor") return;

    room.actions[player.role] = target; // last selection during Night wins
  });

  // One condemnation vote per living player per Evening; first vote sticks.
  socket.on("cast_vote", (data) => {
    const seat = seatOf(socket);
    if (!seat) return;
    const { room, player } = seat;
    if (!room.started || PHASES[room.phaseIndex].name !== "Evening") return;
    if (!player.alive) return;
    if (room.votes[player.username]) return; // already voted

    const target = data && data.target;
    if (!isName(target)) return;
    const targetPlayer = room.players.get(target);
    if (!targetPlayer || !targetPlayer.alive) return;

    room.votes[player.username] = target;
  });

  // Chat: author/time stamped server-side; dead players cannot talk (H5).
  socket.on("send_message", (data) => {
    const seat = seatOf(socket);
    if (!seat) return;
    const { room, player } = seat;
    if (!player.alive) return;
    const message = data && data.message;
    if (typeof message !== "string" || message.length === 0 || message.length > MAX_CHAT_LEN) return;

    const now = new Date();
    socket.to(room.id).emit("receive_message", {
      author: player.username,
      message,
      time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`,
    });
  });

  // Read-only list requests (scoped to the caller's own room).
  socket.on("request_userList", () => {
    const seat = seatOf(socket);
    if (seat) socket.emit("user_list", userList(seat.room));
  });
  socket.on("request_alive_userList", () => {
    const seat = seatOf(socket);
    if (seat) socket.emit("user_alive_list", aliveList(seat.room));
  });
  socket.on("request_spectating_userList", () => {
    const seat = seatOf(socket);
    if (seat) socket.emit("user_spectating_list", spectatingList(seat.room));
  });

  // Voluntary leave (e.g. Win screen countdown finished).
  socket.on("leave_room", () => {
    const seat = seatOf(socket);
    if (!seat) return;
    removePlayer(seat.room, seat.player, "left");
    socket.leave(seat.room.id);
    socket.data.room = null;
    socket.data.username = null;
  });

  socket.on("disconnect", () => {
    const { room: roomId, username } = socket.data;
    const room = roomId && rooms.get(roomId);
    const player = room && room.players.get(username);
    if (!room || !player || player.socketId !== socket.id) return;

    player.connected = false;
    if (!room.started) {
      // Pre-game: free the seat immediately.
      removePlayer(room, player, "disconnected in lobby");
      return;
    }
    // Mid-game: hold the seat for a grace window, then treat as gone.
    log(room.id, "player disconnected, grace window started");
    player.graceTimer = setTimeout(() => {
      player.graceTimer = null;
      if (!player.connected && rooms.get(room.id) === room) {
        log(room.id, "grace expired, eliminating absent player");
        eliminate(room, player.username);
        maybeEndGame(room);
      }
    }, RECONNECT_GRACE_MS);
  });
});

function removePlayer(room, player, why) {
  if (player.graceTimer) clearTimeout(player.graceTimer);
  room.players.delete(player.username);
  log(room.id, `player removed (${why}), ${room.players.size} remain`);
  if (room.players.size === 0) {
    destroyRoom(room);
    return;
  }
  broadcastLists(room);
  if (room.started && !room.gameOver) maybeEndGame(room);
}

if (require.main === module) {
  (async () => {
    if (REDIS_URL) await initRedis(); // fatal on failure: no silent split-brain
    server.listen(PORT, () => {
      console.log(`Mafia server listening on :${PORT} (CORS origin: ${CORS_ORIGIN})`);
    });
  })().catch((err) => {
    console.error(`Fatal startup error: ${err.message}`);
    process.exit(1);
  });
}

// Exported for the integration tests (white-box assertions + lifecycle).
module.exports = { server, io, rooms, destroyRoom, registry };
