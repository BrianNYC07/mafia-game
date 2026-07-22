# Production-Readiness Audit — Multiplayer Mafia Game


---

## Role & mandate

You are a senior staff engineer conducting a production-readiness audit of a **real-time
multiplayer social-deduction (Mafia/Werewolf) game** that will be publicly hosted and
played concurrently by several independent users in separate game rooms.

Your job is to find what would break, leak, cheat, or fall over in production — and then fix
it. Be adversarial and specific. Do not compliment the code. Do not invent problems that
aren't there. Every finding must cite a real file and line/function; if you can't point to
the code, don't claim it.

Before auditing, spend your first pass **building an accurate map of the system**: languages,
frameworks, transport (WebSocket/Socket.IO/WebRTC/polling), where authoritative game state
lives, the persistence layer, how rooms/lobbies are created, and the deploy target. State
this map back to me before diving into findings so I can correct wrong assumptions.

---

## What "production-ready" means for THIS game

This is a hidden-information game. The single most important property is **server authority
over secret state**. Treat the following as the crown-jewel audit area:

### 1. Hidden-information integrity (highest priority)
- Does the **server** hold the source of truth for every player's role, alignment, night
  actions, and vote tallies — or is any of it computed/trusted on the client?
- **Does the server ever send a player information they shouldn't have?** The classic fatal
  bug: broadcasting the full game state (all roles) to every client and merely *hiding* it in
  the UI. A cheater reading the WebSocket frames or React devtools then sees every role.
  Verify that each outbound message is **filtered per-recipient** so a player only receives
  what their role legitimately knows.
- Are night actions (mafia kill, doctor save, detective check, etc.) validated **server-side**
  for legality (right phase, right role, alive, valid target, not already acted)?
- Can a client forge a message claiming to be another player, or claiming a role they don't
  have? Is every action authorized against the *server's* record of who that socket is?
- Are dead players prevented from receiving/sending live-game info (and from seeing the
  post-death chat unless intended)?

### 2. Real-time architecture & state synchronization
- How is game state synchronized? Full-state broadcast vs. deltas vs. event sourcing. Is it
  correct under reordering, duplication, and dropped messages?
- Is there a single authoritative phase/turn state machine (lobby → night → day/discussion →
  voting → resolution → win-check)? Are illegal transitions impossible, or just "unlikely"?
- Are timers (night timer, vote timer) enforced **server-side**? A client-side timer is an
  instant cheat vector and desyncs across players.
- What happens when two events race the same tick (last vote + timer expiry at once)?

### 3. Concurrency & race conditions
- Is per-room state mutated from multiple async handlers without a lock/queue/actor model?
  Look for read-modify-write on shared game objects across `await` points.
- Double-submission: can a player vote twice, act twice, or trigger phase resolution twice by
  spamming or reconnecting mid-action?
- Is there a serialization strategy per room (e.g. a command queue) so events apply atomically?

### 4. Session lifecycle, disconnects & reconnection
- What happens when a player disconnects mid-game? Are they dropped, AI-filled, given a grace
  window, marked idle? Is the game recoverable or does it soft-lock?
- Can a player **reconnect** and resume their exact state (role, votes cast, phase)? Or does a
  refresh nuke their session?
- Are sockets mapped to durable player identities (not just ephemeral socket IDs), so a
  reconnect re-binds correctly and can't be hijacked?
- Host-leaves handling: does the room die, migrate host, or auto-resolve?

### 5. Authentication & authorization
- How are users identified — accounts, guest tokens, room codes? Are tokens signed and
  verified server-side, or trusted from the client?
- Room codes: are they guessable/enumerable? Is joining a private room actually gated?
- Is every socket event authorized (this socket may perform this action, in this room, in this
  phase, as this role)? Missing per-event authz is the norm in hobby projects — check each
  handler.

### 6. Scalability & horizontal scaling
- Is game state in a single Node process's memory? If so, it **cannot scale past one instance**
  and dies with that process. What's the plan — Redis/shared store for room state, or a
  room-affinity/sticky-session router, or a stateful actor per room?
- Are WebSockets set up for multi-instance (e.g. Redis adapter / pub-sub for fan-out) or will
  players in the same room land on different instances and never see each other?
- Matchmaking/lobby service: how are rooms allocated across instances? Capacity limits per
  room and per instance?
- What's the realistic concurrent-room and concurrent-player ceiling on current architecture?

### 7. Persistence & data model
- What survives a server restart mid-game — nothing, or in-flight rooms? Is that acceptable?
- Is there a database for accounts, match history, stats? Is the schema sane, indexed, and
  migration-managed?
- Are secrets/roles ever written to persistent stores or logs where they'd leak?

### 8. Game-logic correctness & edge cases
- Win-condition evaluation: is it checked after every death/vote, and correct at edge counts
  (1v1, ties, simultaneous eliminations, everyone-mafia)?
- Vote resolution: tie handling, abstentions, self-votes, votes for dead/absent players,
  changing a vote, unanimous vs. plurality rules — all specified and enforced?
- Role interactions and ordering (e.g. doctor-saves-target-mafia-attacked, roleblock before
  action, double-protection) resolved deterministically?
- Can the game reach a state with no legal transition (soft-lock)? Enumerate.

### 9. Anti-abuse, moderation & rate limiting
- Rate limiting on socket events and room creation (spam, event floods, connection floods)?
- Input validation/sanitization on chat and display names (XSS via chat is common — is chat
  rendered as text, never HTML?).
- Chat moderation / reporting / muting / kick for a hosted product with strangers?
- Protection against a single client opening many sockets / bot-flooding lobbies?

### 10. Error handling & resilience
- Unhandled promise rejections / uncaught exceptions that can crash the whole process (and
  every game on it)? Is there a process-level guard + graceful degradation per room?
- Are malformed/oversized client payloads rejected safely rather than throwing?
- Graceful shutdown: on deploy, are in-flight rooms drained/notified rather than hard-killed?

### 11. Testing
- Coverage of the game state machine and role-resolution logic (this is deterministic and
  eminently unit-testable — is it tested?).
- Integration tests simulating multiple concurrent clients through a full game.
- Any load/soak test establishing the concurrency ceiling?
- Regression tests for the hidden-info leak class specifically.

### 12. Observability
- Structured logging with room/game/player correlation IDs (without logging secret roles)?
- Metrics: active rooms, players, phase durations, disconnect rate, error rate, event latency?
- Crash/error reporting (Sentry-style) and health/readiness endpoints for the orchestrator?

### 13. Deployment, config & secrets
- Containerized/reproducible build? Pinned dependencies? Documented one-command deploy?
- Config via environment (not hard-coded), secrets never committed — scan the repo/history for
  leaked keys.
- CORS, WSS/TLS, security headers configured for a real domain?
- CI/CD present? Health checks, autoscaling policy, and rollback path defined?

### 14. Performance
- Message volume per tick per room; any O(players²) broadcasts or per-message serialization
  hotspots. Payload sizes — are you shipping the whole game object every tick?
- Memory growth / leaks over long sessions and after rooms end (are finished rooms and their
  timers/listeners cleaned up?).

### 15. Privacy, compliance & code quality
- If hosting real users: what PII is collected/stored, and is there a basic privacy posture?
- Dependency vulnerabilities (audit the lockfile). Dead code, duplication, and the handful of
  refactors that would most reduce future bug surface.

---

## Phase 1 — Deliverable: the audit report

Produce a single report with:

1. **System map** — the architecture you reconstructed (transport, state ownership,
   persistence, deploy target), plus a short data-flow of one full game.
2. **Findings**, each as:
   - `Severity`: **Critical / High / Medium / Low**
   - `Category`: (from the sections above)
   - `Location`: file + function/line
   - `Problem`: what's wrong and the concrete failure/exploit it enables
   - `Evidence`: the specific code that proves it
   - `Fix`: the recommended remediation, and whether it's a patch or a re-architecture
   - Severity rubric: **Critical** = exploitable cheat, data/role leak, crash-all, or
     can't-scale-at-all blocker for hosting. **High** = breaks under normal concurrent
     multiplayer load or common disconnect flows. **Medium** = correctness/robustness gaps.
     **Low** = quality/maintainability.
3. **Top-10 prioritized remediation plan** — ordered by (impact to a hosted, multi-user
   product) ÷ (effort), with rough effort sizing and dependency ordering.
4. **Explicit "cannot ship until fixed" list** — the blockers.

**Stop here and present the report. Do not start changing code until I approve the plan.**
Ask me any clarifying questions whose answers would change your recommendations (intended
player counts per room, account model, target host, which roles/rulesets are canonical).

---

## Phase 2 — Implementation (only after I approve)

Once I approve the plan, implement fixes in **small, reviewable, dependency-ordered commits**,
starting with Critical blockers. For each change:

- Make the minimal correct change; call out anything that's a genuine re-architecture before
  doing it, with the tradeoffs.
- Add or update tests that would have caught the bug — especially for the hidden-information
  leak class and the state machine.
- Never introduce the very leaks you're fixing: default to per-recipient message filtering and
  server-authoritative validation.
- Keep the game playable at every commit; don't leave it in a broken intermediate state.
- After each batch, summarize what changed, what's tested, and what's left.
- If a fix needs a decision or a dependency/infra change I must make (Redis, a DB, a host
  setting), stop and tell me rather than guessing.

Do not mass-rewrite the codebase in one shot. Correctness and reviewability over speed.