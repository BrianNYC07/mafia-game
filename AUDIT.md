# Production-Readiness Audit — Multiplayer Mafia

> Phase 1 deliverable per `spec.md`. Audit date: 2026-07-18.

## Remediation status (Phase 2, 2026-07-18)

Implemented in the working tree (uncommitted, per request):

| Status | Findings | How |
|--------|----------|-----|
| ✅ Fixed | C1, C2, C3, C4, C5 | Server rewrite: per-room in-memory state registry, per-event authz against the socket's server-side seat, server-resolved nights/votes/wins, per-recipient message filtering (cop results private). Legacy leaky events (`get_role`, `get_mafia/doctor/cop`, `kill_user`, `update_condemnCnt`, `start_timer`, …) removed. |
| ✅ Fixed | H1, H2, H3, H4, H5, H6 | Server-side win checks after every elimination; server-owned auto-starting phase clock; synchronous (race-free) joins; token-based reconnect with 60s grace window; server-stamped chat with dead-player mute; broken `force_disconnect`/`get_user_id` replaced by `leave_room`. |
| ✅ Fixed | M2, M3, M4, M5, M6, M7 | No more unguarded DB access (SQLite removed from runtime — see note); server-side one-vote rule; secret-free logging; PORT/CORS_ORIGIN/REACT_APP_SERVER_URL env config + `/healthz`; room lifecycle cleanup; Win.js timer fixed. |
| ✅ Fixed | L1, L3 | 15 tests: unit coverage of roles/night/votes/win + a 5-client integration test incl. hidden-info leak regressions and reconnect; stray `react`/`sqlite3` deps removed from backend. |
| ⚠️ Partial | L5 | Per-socket rate limiting (token bucket) + payload validation + 4KB transport cap. No per-IP connection caps yet. |
| ✅ Fixed | M1 | Multi-instance via room-affinity routing: client connects with `?room=` and nginx `hash $arg_room consistent` pins each room to one instance (`deploy/nginx.conf.example`); Redis provides the socket.io adapter plus a room-ownership registry (SET NX + 30s TTL + 10s heartbeat, `app/back/registry.js`) that turns balancer misconfiguration into a clean join error instead of split-brain. `REDIS_URL` unset → single-instance, unchanged. See `deploy/README.md`. |
| ⏸ Deferred | L2, L4 | Orphaned `public/*.html` prototype pages (incl. dead `/auth` login form) left in place pending a product decision on accounts; duplicated styles across phase components untouched. |

**Re-architecture note:** authoritative state moved from SQLite+globals to per-room in-memory objects. Handlers are synchronous over room state, so join/vote/kill races are impossible by construction. Tradeoff: in-flight games do not survive a server restart (accepted); a future accounts/history feature would add a DB at the edge, not in the game loop. Rule change: mafia now wins at parity (mafia ≥ other living players) instead of "1 player left".

---

## 1. System map

**Stack**
- **Frontend:** React 19 via `react-scripts` (CRA), `socket.io-client`. Dev server on `:3000`. Also some static `public/*.html` pages (login/register/game) that appear to be an earlier, unused prototype.
- **Backend:** Node.js + Express + Socket.IO 4.8 on `:3001` (`app/back/index.js`). Express is used **only** to attach CORS — there are no HTTP routes.
- **Persistence:** SQLite (`sqlite3`), single file `database.db`, single table `rooms`.
- **Deploy target:** `brianl.tech` is referenced in the README; everything in code is hardcoded to `localhost`.

**State ownership**
- Per-player state lives in SQLite: one row per player — `user_id` (= ephemeral `socket.id`), `room_id`, `role`, `username`, `spectating`, `condemnCnt`, `phase` (`index.js:305`).
- **Night actions live in four module-level global variables** — `mafiaSelect`, `doctorSelect`, `copSelect`, `condemned` (`index.js:10-13`). These are **process-global, not per-room.**
- **Rooms** are just user-typed strings from a text box (`JoinRoom.js:12-16`). No codes are generated, no privacy, no validation. Fixed at exactly 5 players.

**Data flow of one game**
1. Client emits `join_room [room, username]`. Server counts rows in room; if `< 5`, calls `pick_role` and inserts a row, emits `set_role` back to that one socket.
2. WaitingRoom polls `request_userList`; when it sees exactly 5, renders `Game`.
3. `Game` mounts → **every client** emits `start_timer`, which starts a server `setInterval` that advances `phase` on a fixed cycle Night→Dawn→Morning→Evening→Dusk and broadcasts `time_update`.
4. Night: role clients emit `set_mafia`/`set_doctor`/`set_cop` (writing the globals). Dawn: **every client** emits `get_mafia`/`get_doctor`/`get_cop`, then **computes the kill on the client** and emits `kill_user`. Cop client emits `get_role`.
5. Evening: clients emit `update_condemnCnt`. Dusk: server (or `get_condemned`) picks highest vote, sets that player spectating.
6. Win is decided **on the client** (alive count / mafia count) and renders `Win`, which after 5s emits `force_disconnect`.

**Headline:** The single most load-bearing decision — putting night actions in process globals — means the server **cannot host two games at once**; a second room silently overwrites the first room's mafia/doctor/cop/condemned targets. Combined with the fact that kills, win-checks, and role reveals are all client-driven and unauthenticated, this cannot be publicly hosted in its current form.

---

## 2. Findings

### CRITICAL

#### C1 — Night actions stored in process-global variables; rooms clobber each other
- **Category:** Concurrency / Real-time architecture
- **Location:** `app/back/index.js:10-13`; handlers `set_mafia`/`set_doctor`/`set_cop`/`set_condemned` `index.js:133-151`; readers `index.js:153-163`
- **Problem:** `mafiaSelect`, `doctorSelect`, `copSelect`, `condemned` are declared once at module scope and shared by every socket in every room. Two concurrent games write the same four variables. Room B's mafia pick overwrites Room A's; A's Dawn then resolves a kill using B's target. This is not an edge case — it happens with the *second* room, always.
- **Evidence:** `var mafiaSelect = "";` at module top; `socket.on("set_mafia", (data) => { mafiaSelect = data; })` — no room keying anywhere.
- **Fix:** Re-architecture (small but structural). Move per-room game state into a per-room object (keyed by room id) or into the DB row set for that room. This is the anchor fix that several others depend on.

#### C2 — `get_role` lets any client read any player's secret role
- **Category:** Hidden-information integrity
- **Location:** `app/back/index.js:191-197`; intended caller `app/front/src/Dawn.js:189-193`
- **Problem:** The handler returns the role of any `[username, room]` to whoever asked, with no check that the requester is the cop (or even in the room). Any player opens devtools and runs `socket.emit("get_role", ["victim","room"])`, listens for `return_role`, and learns every role. This is the classic fatal Mafia leak.
- **Evidence:** `socket.on("get_role", (data) => { socket.emit("return_role", await get_role(data[0], data[1])) })` — no authorization.
- **Fix:** Patch + server authority: only honor a role query when the server's record says this socket is the cop, it's the right phase, the cop is alive, and hasn't already checked this night. Store the result server-side; never expose a generic role-lookup event.

#### C3 — Kill resolution is client-authoritative via `kill_user`
- **Category:** Hidden-information integrity / server authority
- **Location:** `app/back/index.js:180-189`; driven by `app/front/src/Dawn.js:214-224`
- **Problem:** The client computes whether the mafia's target survives (compares mafia vs doctor target) and emits `kill_user [target, room]`. The server blindly sets that player spectating. Any client can emit `kill_user` for **any** player at any time and eliminate them instantly — including the whole town.
- **Evidence:** Client: `socket.emit("kill_user", [mafiaTarget, room])`. Server: `set_spectator(data[0], data[1])` with no checks.
- **Fix:** Re-architecture. The **server** must resolve night outcomes: at Night→Dawn transition, read the room's stored mafia/doctor targets, apply protection, mark the death, broadcast the result. Remove `kill_user` as a client-callable event.

#### C4 — `get_mafia`/`get_doctor`/`get_cop` broadcast the night targets to anyone
- **Category:** Hidden-information integrity
- **Location:** `app/back/index.js:153-163`; called by all clients in `app/front/src/Dawn.js:154-160`
- **Problem:** Any client can ask for and receive who the mafia targeted, who the doctor saved, who the cop investigated. Even without cheating, every client is *told* these to compute the kill. The mafia's target is knowable to the town before dawn.
- **Evidence:** `socket.on("get_mafia", () => socket.emit("recieve_mafia", mafiaSelect))`.
- **Fix:** Re-architecture (folds into C3). Resolve on the server; emit only the *public* outcome ("X died" / "nobody died"). Never send raw role-action targets to clients.

#### C5 — No authentication or per-event authorization anywhere
- **Category:** Authentication & authorization
- **Location:** entire socket layer; login/register pages `app/front/public/login.html` post to `/auth`, which **does not exist** in the backend.
- **Problem:** Sockets are identified only by ephemeral `socket.id`. No event verifies the caller's identity, role, room membership, phase, or alive-status. `set_mafia` can be sent by an innocent; `send_message` can target any room; `kill_user`/`get_role` need no standing. The login UI is decorative — there's no `/auth` handler, no session, no token.
- **Evidence:** No `app.post`/`app.get` routes exist; every `socket.on` handler acts on client-supplied `data` without checking who the socket is.
- **Fix:** Re-architecture. Establish a durable player identity (signed token or at least a server-issued session id bound to the socket), record which player/role/room each socket is, and gate every event against the server's record. (Also either wire up `/auth` or remove the misleading login pages.)

### HIGH

#### H1 — Win condition decided on the client
- **Category:** Game-logic correctness / server authority
- **Location:** `app/front/src/Night.js:155,173-179`; `app/front/src/Morning.js:229-231`
- **Problem:** Clients decide the game is over (`aliveUserList.length === 1` → mafia win; mafia count `=== 0` → town win) and render the Win screen locally. Players can desync on who won, and a client can trivially force a win screen. There is no server-side win evaluation after deaths/votes.
- **Fix:** Server evaluates win after every elimination and broadcasts an authoritative game-over with the winning faction.

#### H2 — `start_timer` is client-triggered and re-triggerable by anyone
- **Category:** Real-time architecture / timers
- **Location:** `app/back/index.js:58-102`; emitted by every client on mount `app/front/src/Game.js:24-26`
- **Problem:** The phase clock only exists because clients emit `start_timer`. Any client can emit it again mid-game to reset the countdown for the whole room and jump `phaseIndex` handling. The interval is cleared/recreated on each call, so a late joiner or a malicious client can repeatedly restart the phase. Phase transitions and the condemnation resolution ride on this loosely-controlled interval.
- **Fix:** Server starts the room clock exactly once when the room fills; ignore client `start_timer`. Drive phase transitions from that single authoritative timer.

#### H3 — `join_room` capacity check is a non-atomic read-modify-write
- **Category:** Concurrency / race conditions
- **Location:** `app/back/index.js:39-56`
- **Problem:** `get_roles_in_room` (await) → check `< 5` → `pick_role` (await) → `add_to_room` (await). Two joins racing both observe `<5` and both insert → 6 players in a "5-max" room, or duplicate/oversubscribed roles. Because `WaitingRoom` starts only on `length === 5` exactly (`WaitingRoom.js:15`), a room that races to 6 **never starts** — permanent soft-lock.
- **Fix:** Serialize joins per room (a per-room queue/lock) and make the capacity check + insert atomic. Start the game on `>= 5`, not `=== 5`.

#### H4 — Disconnect/refresh destroys the player; no reconnection
- **Category:** Session lifecycle
- **Location:** `disconnect` → `remove_from_room(socket.id)` `app/back/index.js:246-249`; identity is `socket.id`
- **Problem:** A refresh or blip deletes the player's row (role, votes, alive status all gone) and there's no way to rebind. Since identity is the ephemeral socket id, a reconnect is a brand-new player. Mid-game this drops the room below 5 and can soft-lock or skew win math. Host-leave has no handling — the room just decays.
- **Fix:** Durable player identity + a disconnect grace window; on reconnect, rebind the socket to the existing player row and resend their private state. Decide (product call) whether a truly-gone player is AI-filled, skipped, or ends the room.

#### H5 — `send_message` accepts any room and any author; dead-player muting is client-only
- **Category:** Anti-abuse / authorization
- **Location:** `app/back/index.js:104-107`; client gate only in `app/front/src/Morning.js:200`
- **Problem:** The server relays `send_message` to `data.room` with no check that the socket is in that room, alive, or that `author` matches. A dead player (or anyone) can inject chat into any room and spoof any author name. The "spectators can't talk" rule is enforced only in the client.
- **Fix:** Server validates room membership + alive status from its own record and stamps the author from the socket's identity, not the payload.

#### H6 — `get_user_id` returns `undefined` (wrong column), breaking `force_disconnect`
- **Category:** Correctness
- **Location:** `app/back/index.js:455-471`
- **Problem:** Query selects `user_id` but the code reads `rows.userID` (wrong case), and the guard `typeof(rows) !== undefined` is always true (`typeof` returns a string, never the value `undefined`). So it resolves `undefined`, and `force_disconnect` calls `remove_from_room(undefined)` — deleting nothing and failing to disconnect. This is the intended room-teardown path from the Win screen.
- **Fix:** Patch: read `rows.user_id`, guard with `if (rows)`.

### MEDIUM

#### M1 — Single-process in-memory state → cannot scale past one instance
- **Category:** Scalability
- **Location:** globals `app/back/index.js:10-13`; `roomIntervals` map `index.js:32`; no Socket.IO adapter
- **Problem:** Room state and timers live in one process's memory. No Redis adapter/pub-sub, no sticky sessions — two instances means players in one room land on different nodes and never see each other. As written (C1), even a single instance can't run two rooms.
- **Fix:** Re-architecture for later: per-room actor with a shared store (Redis) + Socket.IO Redis adapter, or room-affinity routing. Not needed for a demo; required for real hosting.

#### M2 — Unguarded DB result access → rejections swallowed by empty catches
- **Category:** Error handling / resilience
- **Location:** e.g. `get_room_phase` `resolve(rows.phase)` `index.js:369`; `get_users_in_room` `rows.forEach` `index.js:416`; `get_role` `rows.role` `index.js:496`
- **Problem:** When a query returns no row (empty/nonexistent room, timing), these throw on `undefined`. Every handler wraps calls in `try/catch {}` that silently eats the error, so failures manifest as "nothing happens" — very hard to diagnose in production, and masks real bugs.
- **Fix:** Guard for missing rows; replace empty catches with structured logging (without logging secret roles).

#### M3 — Vote handling has no server-side integrity
- **Category:** Game-logic correctness
- **Location:** `update_condemnCnt` `app/back/index.js:199-205`; client gate only `app/front/src/Evening.js:171-178`
- **Problem:** Any client can increment the condemn count for any target any number of times by emitting `update_condemnCnt` directly (the one-vote rule is client-only). Dead players' votes, self-votes, and repeat votes aren't prevented server-side. Tie handling exists (top-two compare in `get_highest_condemn`) but rests on unverified counts.
- **Fix:** Record one vote per living player server-side (keyed by voter identity), validate phase/alive/target, resolve the tally on the server.

#### M4 — Secret roles and targets written to logs
- **Category:** Observability / privacy
- **Location:** `app/back/index.js:134-149` (`"mafia selected : " + data`), `add_to_room` logs role `index.js:355`, `get_highest_condemn` logs full rows `index.js:528`
- **Problem:** Console logs print the mafia's target, each player's assigned role, and vote tallies. Anyone with log access sees the hidden information. No correlation IDs, no structured logging.
- **Fix:** Remove secret-bearing logs; add structured logging with room/player IDs and no secrets.

#### M5 — CORS/transport hardcoded to localhost; no WSS/TLS/prod config
- **Category:** Deployment & config
- **Location:** `app/back/index.js:24-29` (`origin: "http://localhost:3000"`), client `app/front/src/App.js:5` (`http://localhost:3001`)
- **Problem:** Origins and the backend URL are compiled-in. Deploying to `brianl.tech` would fail CORS and mixed-content (HTTPS page → ws://localhost). No env-based config.
- **Fix:** Config via environment; set production origin, serve over WSS behind TLS.

#### M6 — Stale room rows never cleaned; `createTable` runs on every connection
- **Category:** Persistence / performance
- **Location:** `createTable` invoked per connection `app/back/index.js:35`; rows removed only on disconnect
- **Problem:** Finished games leave rows if teardown fails (and it does — see H6). No TTL/cleanup. `createTable` fires on every socket connect (wasteful and racy with `close`).
- **Fix:** Run schema setup once at boot; add room lifecycle cleanup when a game ends.

#### M7 — `Win.js` timer never counts down; reloads during render
- **Category:** Correctness (client)
- **Location:** `app/front/src/Win.js:11-17,34-37`
- **Problem:** The countdown `setInterval` is placed in a `useEffect` **cleanup return**, so it only starts on unmount — the timer never ticks normally. `window.location.reload()` is called inline during render when `seconds <= 0`. Fragile teardown that also feeds the broken `force_disconnect` (H6).
- **Fix:** Standard `useEffect` interval with cleanup; move reload/navigation into an effect.

### LOW

- **L1 — No tests at all.** The state machine and role resolution are deterministic and eminently unit-testable; there is zero coverage and no leak-regression tests. (`back` has the default failing `test` script.) — *Testing*
- **L2 — Dead/duplicated code:** commented-out `pick_role`/`db.js` remnants, duplicated inline style objects and `description()` across five phase files, `test` debug handler `index.js:269-271`. — *Code quality*
- **L3 — `react` is a dependency of the *backend* `package.json`** (`app/back/package.json:16`) — wrong, bloats install. — *Code quality*
- **L4 — `login.html` loads `cdn.tailwindcss.com`** (dev-only CDN) and the whole `public/*.html` set looks orphaned vs. the React app. — *Code quality*
- **L5 — No rate limiting / payload validation / connection caps** on socket events or room creation; a script can flood rooms/events. (Related to H5; low only because the app isn't yet hostable.) — *Anti-abuse*

---

## 3. Top-10 prioritized remediation plan

Ordered by impact-to-a-hosted-product ÷ effort, with dependencies noted.

| # | Fix | Findings | Effort | Depends on |
|---|-----|----------|--------|-----------|
| 1 | **Per-room server state object** (kill the globals) | C1, M1 | M | — (foundation) |
| 2 | **Durable player identity + per-event authz** (socket → player/role/room record) | C5, H5, M3 | M | 1 |
| 3 | **Server-authoritative night resolution**; remove `kill_user`/`get_mafia/doctor/cop` as client events | C3, C4 | M | 1, 2 |
| 4 | **Server-side role queries** (cop only, validated); stop generic `get_role` | C2 | S | 2, 3 |
| 5 | **Server-authoritative win check** after every elimination | H1 | S | 1, 3 |
| 6 | **Server-owned phase clock**; ignore client `start_timer` | H2 | S | 1 |
| 7 | **Atomic joins** (per-room queue); start on `>=5` | H3 | S | 1 |
| 8 | **Fix `force_disconnect`/`get_user_id` + `Win.js` teardown** | H6, M7 | S | — |
| 9 | **Reconnect + disconnect grace window** | H4 | M | 1, 2 |
| 10 | **Config via env (CORS/URLs), remove secret logs, add core tests** | M4, M5, L1 | S–M | — |

Effort: S ≈ hours, M ≈ a day or so. Items 1→2→3 are the critical spine and should land in that order.

---

## 4. Cannot-ship-until-fixed (blockers)

1. **C1** — process-global night actions: two concurrent rooms corrupt each other. The app is single-room-only until fixed.
2. **C2** — any client can read any role. Hidden-info is fully defeated.
3. **C3 + C4** — client-authoritative kills and target broadcast. Any client can kill anyone / see night actions.
4. **C5** — no auth/authz on any event. Every rule is client-side and forgeable.
5. **H3** — join race can soft-lock a room (stuck at 6, never starts).

Everything in CRITICAL plus H3 must be fixed before this is exposed to strangers. H1/H2/H4/H5/H6 should follow immediately after for a playable hosted experience.

---

## 5. Open questions (answers change the Phase 2 plan)

1. **Player count:** Is 5 the canonical room size, or variable sizes (with role counts that scale)?
2. **Roles/ruleset:** Are mafia / doctor / cop / fool / innocent final, exactly one of each special role? Confirm win conditions — especially the **fool** (wins if condemned) and its interaction with the mafia/town win check.
3. **Account model:** Real accounts (wire up `/auth`, persist match history) or guest-only per-session identity?
4. **Target host & infra:** Is `brianl.tech` the target, and is adding **Redis** acceptable (needed for multi-instance scaling, M1) — or is a single-instance, several-concurrent-rooms ceiling fine for now?
5. **Persistence expectation:** Should an in-progress game survive a server restart, or is losing in-flight rooms on deploy acceptable?
