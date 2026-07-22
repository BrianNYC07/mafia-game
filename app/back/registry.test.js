const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RoomRegistry } = require("./registry");

// Minimal in-memory stand-in for the node-redis v4 surface the registry uses.
function fakeRedis(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async set(key, value, opts = {}) {
      if (opts.NX && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async del(key) {
      store.delete(key);
    },
    async expire() {
      return 1;
    },
  };
}

test("claim: first claim wins and is idempotent for the same instance", async () => {
  const redis = fakeRedis();
  const reg = new RoomRegistry(redis, "inst-a");
  assert.equal(await reg.claim("r1"), "claimed");
  assert.equal(await reg.claim("r1"), "claimed"); // already ours
  assert.ok(reg.owned.has("r1"));
  assert.equal(redis.store.get("mafia:room-owner:r1"), "inst-a");
});

test("claim: conflicts when another instance owns the room", async () => {
  const redis = fakeRedis({ "mafia:room-owner:r1": "inst-b" });
  const reg = new RoomRegistry(redis, "inst-a");
  assert.equal(await reg.claim("r1"), "conflict");
  assert.ok(!reg.owned.has("r1"));
});

test("release: deletes own claim but never another instance's", async () => {
  const redis = fakeRedis({
    "mafia:room-owner:mine": "inst-a",
    "mafia:room-owner:theirs": "inst-b",
  });
  const reg = new RoomRegistry(redis, "inst-a");
  reg.owned.add("mine");
  await reg.release("mine");
  assert.ok(!redis.store.has("mafia:room-owner:mine"));
  await reg.release("theirs");
  assert.equal(redis.store.get("mafia:room-owner:theirs"), "inst-b");
});

test("no client (single-instance): claim succeeds, release is a no-op", async () => {
  const reg = new RoomRegistry(null, "inst-a");
  assert.equal(await reg.claim("r1"), "claimed");
  await reg.release("r1"); // must not throw
});

test("redis failure fails open with 'error'", async () => {
  const reg = new RoomRegistry(
    { set: async () => { throw new Error("down"); } },
    "inst-a"
  );
  assert.equal(await reg.claim("r1"), "error");
});
