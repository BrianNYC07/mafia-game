// Cross-instance room-ownership registry (M1).
//
// With nginx `hash $arg_room consistent` routing, every player of a room
// lands on the same instance, so authoritative room state can stay in that
// instance's memory. This registry is the safety net around that assumption:
// each instance claims the rooms it hosts in Redis (SET NX + TTL heartbeat),
// so a misconfigured balancer produces a loud, clean join failure instead of
// a silent split-brain where two instances both host room "X".
//
// The Redis client is injected so tests can pass a fake; when no client is
// provided (single-instance dev), every operation is a no-op that reports
// success.

const CLAIM_TTL_S = 30;
const HEARTBEAT_MS = 10_000;

class RoomRegistry {
  // client: a connected node-redis v4 client (or compatible fake); may be null.
  constructor(client, instanceId) {
    this.client = client;
    this.instanceId = instanceId;
    this.owned = new Set(); // roomIds this instance currently owns
    this.heartbeat = null;
  }

  key(roomId) {
    return `mafia:room-owner:${roomId}`;
  }

  // Claim a room for this instance. Returns:
  //   "claimed"  — we own it now (or already did)
  //   "conflict" — another live instance owns it (misrouted join)
  //   "error"    — Redis unavailable; caller decides (we fail open)
  async claim(roomId) {
    if (!this.client) return "claimed";
    try {
      const ok = await this.client.set(this.key(roomId), this.instanceId, {
        NX: true,
        EX: CLAIM_TTL_S,
      });
      if (ok) {
        this.owned.add(roomId);
        return "claimed";
      }
      const owner = await this.client.get(this.key(roomId));
      if (owner === this.instanceId) {
        this.owned.add(roomId);
        return "claimed";
      }
      return "conflict";
    } catch (err) {
      console.error(`[registry] claim failed for ${roomId}: ${err.message}`);
      return "error";
    }
  }

  async release(roomId) {
    this.owned.delete(roomId);
    if (!this.client) return;
    try {
      // Only delete our own claim (avoid clobbering a new owner after a
      // TTL-expiry handover).
      const owner = await this.client.get(this.key(roomId));
      if (owner === this.instanceId) await this.client.del(this.key(roomId));
    } catch (err) {
      console.error(`[registry] release failed for ${roomId}: ${err.message}`);
    }
  }

  // Refresh the TTL on every owned room so claims outlive us only briefly.
  startHeartbeat() {
    if (!this.client || this.heartbeat) return;
    this.heartbeat = setInterval(async () => {
      for (const roomId of this.owned) {
        try {
          await this.client.expire(this.key(roomId), CLAIM_TTL_S);
        } catch (err) {
          console.error(`[registry] heartbeat failed for ${roomId}: ${err.message}`);
        }
      }
    }, HEARTBEAT_MS);
    if (this.heartbeat.unref) this.heartbeat.unref();
  }

  stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}

module.exports = { RoomRegistry, CLAIM_TTL_S, HEARTBEAT_MS };
