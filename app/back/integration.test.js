// Multi-client integration test: drives a full game through the real server
// over real sockets, including regression tests for the hidden-information
// leak class (see AUDIT.md C2–C4) and the authorization rules.

process.env.TICK_MS = "100"; // full game in ~5s; logic identical to prod
process.env.RECONNECT_GRACE_MS = "2000";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { io: Client } = require("socket.io-client");
const { server, io, rooms, destroyRoom, registry } = require("./index");

const PHASE_NAMES = ["Night", "Dawn", "Morning", "Evening", "Dusk"];

let port;
const clients = [];

function connect() {
  const c = Client(`http://localhost:${port}`, { transports: ["websocket"] });
  c.recorded = []; // every event this client ever receives
  c.onAny((event, ...args) => c.recorded.push({ event, args }));
  clients.push(c);
  return c;
}

function waitFor(socket, event, predicate = () => true, ms = 8000) {
  if (event === "connect" && socket.connected) return Promise.resolve();
  // Events can arrive before a listener is registered (e.g. game_start right
  // after joined) — the onAny recorder catches those; check history first.
  const past = (socket.recorded || []).find((r) => r.event === event && predicate(r.args[0]));
  if (past) return Promise.resolve(past.args[0]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    const handler = (data) => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

function waitForPhase(socket, phaseName, ms = 8000) {
  return waitFor(socket, "time_update", (d) => PHASE_NAMES[d.phaseIndex] === phaseName, ms);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("full game: server authority, per-recipient filtering, town victory", async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;

  const ROOM = "itest-room";
  const names = ["p1", "p2", "p3", "p4", "p5"];
  const seats = {}; // name -> { client, role, token }

  // --- join 5 players; each learns only their own role -------------------
  const joins = names.map(async (name) => {
    const c = connect();
    await waitFor(c, "connect");
    c.emit("join_room", { room: ROOM, username: name });
    const joined = await waitFor(c, "joined");
    assert.equal(joined.username, name);
    seats[name] = { client: c, role: joined.role, token: joined.token };
  });
  await Promise.all(joins);

  const roleOf = Object.fromEntries(names.map((n) => [n, seats[n].role]));
  const byRole = Object.fromEntries(names.map((n) => [seats[n].role, n]));
  assert.deepEqual(
    Object.keys(byRole).sort(),
    ["cop", "doctor", "fool", "innocent", "mafia"],
    "each role dealt exactly once"
  );

  // Game auto-starts at 5 players (server-owned clock, no client start_timer)
  await Promise.all(names.map((n) => waitFor(seats[n].client, "game_start")));
  const room = rooms.get(ROOM);
  assert.ok(room && room.started, "room started server-side");

  const mafia = byRole["mafia"];
  const cop = byRole["cop"];
  const doctor = byRole["doctor"];
  const fool = byRole["fool"];
  const innocent = byRole["innocent"];

  // --- leak regression: legacy events are gone ---------------------------
  const attacker = seats[innocent].client;
  attacker.emit("get_role", [mafia, ROOM]); // the old fatal leak
  attacker.emit("get_mafia", "");
  attacker.emit("kill_user", [cop, ROOM]); // old client-authoritative kill
  await sleep(300);
  assert.ok(
    !attacker.recorded.some((r) => ["return_role", "recieve_mafia"].includes(r.event)),
    "server no longer answers role/target lookups"
  );
  assert.equal(room.players.get(cop).alive, true, "kill_user is ignored");

  // --- night actions: only real night roles accepted ---------------------
  seats[fool].client.emit("night_action", { target: mafia }); // fool has no night power
  seats[mafia].client.emit("night_action", { target: innocent });
  seats[doctor].client.emit("night_action", { target: doctor }); // self-protect
  seats[cop].client.emit("night_action", { target: mafia });
  await sleep(200);
  assert.deepEqual(room.actions, { mafia: innocent, doctor: doctor, cop: mafia });

  // --- dawn: public outcome + private cop result -------------------------
  const nightResults = await Promise.all(
    names.map((n) => waitFor(seats[n].client, "night_result"))
  );
  for (const nr of nightResults) {
    assert.deepEqual(nr, { attacked: innocent, died: true });
  }
  const copResult = await waitFor(seats[cop].client, "investigation_result");
  assert.deepEqual(copResult, { target: mafia, role: "mafia" });
  await sleep(100);
  for (const n of names) {
    if (n === cop) continue;
    assert.ok(
      !seats[n].client.recorded.some((r) => r.event === "investigation_result"),
      `investigation_result must go only to the cop (leaked to ${n})`
    );
  }
  const victim = seats[innocent];
  await waitFor(victim.client, "you_died", () => true, 100).catch(() => {});
  assert.equal(room.players.get(innocent).alive, false, "victim eliminated server-side");

  // --- morning: dead players cannot chat; author is server-stamped -------
  await waitForPhase(seats[cop].client, "Morning");
  victim.client.emit("send_message", { message: "boo from the grave" });
  seats[doctor].client.emit("send_message", { message: "good morning", author: "spoofed" });
  const chat = await waitFor(seats[cop].client, "receive_message");
  assert.equal(chat.author, doctor, "author stamped from server seat, not payload");
  assert.equal(chat.message, "good morning");
  await sleep(200);
  assert.ok(
    !seats[cop].client.recorded.some(
      (r) => r.event === "receive_message" && r.args[0].message === "boo from the grave"
    ),
    "dead players are muted server-side"
  );

  // --- evening: one vote per living player, first vote sticks ------------
  await waitForPhase(seats[cop].client, "Evening");
  seats[cop].client.emit("cast_vote", { target: mafia });
  seats[cop].client.emit("cast_vote", { target: doctor }); // must not overwrite
  seats[doctor].client.emit("cast_vote", { target: mafia });
  seats[fool].client.emit("cast_vote", { target: mafia });
  victim.client.emit("cast_vote", { target: doctor }); // dead, must be rejected
  seats[mafia].client.emit("cast_vote", { target: cop });
  await sleep(200);
  assert.deepEqual(room.votes, {
    [cop]: mafia,
    [doctor]: mafia,
    [fool]: mafia,
    [mafia]: cop,
  });

  // --- dusk: condemnation + authoritative town win -----------------------
  const condemned = await waitFor(seats[cop].client, "return_condemned");
  assert.equal(condemned, mafia);
  const overs = await Promise.all(names.map((n) => waitFor(seats[n].client, "game_over")));
  for (const o of overs) assert.deepEqual(o, { winner: "town" });
  assert.ok(!rooms.has(ROOM), "room torn down after game over");

  // --- final sweep: nobody ever saw someone else's role ------------------
  for (const n of names) {
    for (const { event, args } of seats[n].client.recorded) {
      if (event === "joined") {
        assert.equal(args[0].role, roleOf[n], "joined carries only own role");
      } else if (event === "investigation_result") {
        assert.equal(n, cop, "only the cop receives investigation results");
      } else {
        const blob = JSON.stringify(args);
        for (const other of names) {
          if (other === n) continue;
          assert.ok(
            !blob.includes(`"${other}","role"`) && !blob.includes(`"role":"${roleOf[other]}","username":"${other}"`),
            `event ${event} leaked ${other}'s role to ${n}`
          );
        }
      }
    }
  }
});

test("reconnect: token rebinds the same seat with the same role", async () => {
  const ROOM = "itest-reconnect";
  const names = ["q1", "q2", "q3", "q4", "q5"];
  const seats = {};
  await Promise.all(
    names.map(async (name) => {
      const c = connect();
      await waitFor(c, "connect");
      c.emit("join_room", { room: ROOM, username: name });
      const joined = await waitFor(c, "joined");
      seats[name] = { client: c, role: joined.role, token: joined.token };
    })
  );
  await Promise.all(names.map((n) => waitFor(seats[n].client, "game_start")));

  // Drop q1 mid-game, then reconnect with the token within the grace window.
  seats["q1"].client.disconnect();
  await sleep(100);
  const room = rooms.get(ROOM);
  assert.equal(room.players.get("q1").connected, false);
  assert.equal(room.players.get("q1").alive, true, "seat held during grace window");

  const again = connect();
  await waitFor(again, "connect");
  again.emit("join_room", { room: ROOM, username: "q1", token: seats["q1"].token });
  const rejoined = await waitFor(again, "joined");
  assert.equal(rejoined.role, seats["q1"].role, "same secret role restored");
  assert.equal(rejoined.started, true);
  assert.equal(room.players.get("q1").connected, true);

  // A token-less impostor cannot take the seat.
  const impostor = connect();
  await waitFor(impostor, "connect");
  impostor.emit("join_room", { room: ROOM, username: "q1" });
  const err = await waitFor(impostor, "join_error");
  assert.match(err.reason, /taken/i);
});

test("misrouted room creation: ownership conflict fails the join cleanly", async () => {
  // Simulate this instance NOT owning the room in Redis: every claim
  // attempt finds another instance's claim.
  registry.client = {
    set: async () => null, // NX claim fails
    get: async () => "some-other-instance",
    del: async () => {},
    expire: async () => 1,
  };
  try {
    const c = connect();
    await waitFor(c, "connect");
    c.emit("join_room", { room: "itest-misrouted", username: "z1" });
    await waitFor(c, "joined"); // local seat is granted first (claim is async)
    const err = await waitFor(c, "join_error");
    assert.match(err.reason, /routing/i);
    assert.ok(!rooms.has("itest-misrouted"), "conflicted room is destroyed");
  } finally {
    registry.client = null; // restore single-instance mode for other tests
  }
});

test("handshake room query must match the joined room", async () => {
  const c = Client(`http://localhost:${port}`, {
    transports: ["websocket"],
    query: { room: "room-A" },
  });
  clients.push(c);
  c.recorded = [];
  c.onAny((event, ...args) => c.recorded.push({ event, args }));
  await waitFor(c, "connect");
  c.emit("join_room", { room: "room-B", username: "z2" });
  const err = await waitFor(c, "join_error");
  assert.match(err.reason, /routed for a different room/i);
  assert.ok(!rooms.has("room-B"));
});

after(async () => {
  for (const c of clients) c.disconnect();
  for (const room of [...rooms.values()]) destroyRoom(room);
  io.close();
  await new Promise((resolve) => server.close(resolve));
});
