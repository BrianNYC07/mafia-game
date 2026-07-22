const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ROLES, pickRole, resolveNight, tallyVotes, checkWin } = require("./game");

test("pickRole deals the one missing role to the last seat", () => {
  const inRoom = ["mafia", "cop", "doctor", "fool"];
  assert.equal(pickRole(inRoom), "innocent");
});

test("pickRole never deals a duplicate role", () => {
  for (let i = 0; i < 200; i++) {
    const inRoom = [];
    for (let seat = 0; seat < 5; seat++) {
      const role = pickRole(inRoom);
      assert.ok(ROLES.includes(role));
      assert.ok(!inRoom.includes(role), `duplicate role ${role}`);
      inRoom.push(role);
    }
  }
});

test("resolveNight: no mafia action means no death", () => {
  assert.deepEqual(resolveNight({ mafia: null, doctor: "a", cop: null }), {
    attacked: null,
    died: null,
  });
});

test("resolveNight: unprotected target dies", () => {
  assert.deepEqual(resolveNight({ mafia: "bob", doctor: "alice", cop: null }), {
    attacked: "bob",
    died: "bob",
  });
});

test("resolveNight: doctor save prevents the death", () => {
  assert.deepEqual(resolveNight({ mafia: "bob", doctor: "bob", cop: "carol" }), {
    attacked: "bob",
    died: null,
  });
});

test("tallyVotes: no votes condemns nobody", () => {
  assert.equal(tallyVotes({}), null);
});

test("tallyVotes: clear plurality wins", () => {
  assert.equal(tallyVotes({ a: "m", b: "m", c: "m", m: "a" }), "m");
});

test("tallyVotes: top-two tie condemns nobody", () => {
  assert.equal(tallyVotes({ a: "b", b: "a", c: "b", d: "a" }), null);
});

test("tallyVotes: a single vote is decisive", () => {
  assert.equal(tallyVotes({ a: "b" }), "b");
});

test("checkWin: fool condemned wins immediately", () => {
  const players = [
    { role: "mafia", alive: true },
    { role: "fool", alive: false },
    { role: "cop", alive: true },
  ];
  assert.equal(checkWin(players, { foolCondemned: true }), "fool");
});

test("checkWin: town wins when no mafia remain alive", () => {
  const players = [
    { role: "mafia", alive: false },
    { role: "cop", alive: true },
    { role: "doctor", alive: true },
  ];
  assert.equal(checkWin(players), "town");
});

test("checkWin: mafia wins at 1v1 parity", () => {
  const players = [
    { role: "mafia", alive: true },
    { role: "cop", alive: true },
    { role: "doctor", alive: false },
    { role: "fool", alive: false },
    { role: "innocent", alive: false },
  ];
  assert.equal(checkWin(players), "mafia");
});

test("checkWin: game continues while town outnumbers mafia", () => {
  const players = [
    { role: "mafia", alive: true },
    { role: "cop", alive: true },
    { role: "doctor", alive: true },
  ];
  assert.equal(checkWin(players), null);
});
