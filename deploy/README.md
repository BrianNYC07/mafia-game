# Deploying multi-instance (audit M1)

> **One-command containerized deploy:** see [DEPLOY.md](DEPLOY.md) — Docker
> Compose brings up nginx + Redis + 2 Node instances together and walks through
> a VPS + domain + TLS deploy. The notes below describe the same architecture
> run manually (bare processes).

## Architecture

- **nginx** terminates TLS and routes `/socket.io/` with `hash $arg_room consistent`,
  so every player of a room lands on the same Node instance (the client sends the
  room code as `?room=<code>` on the connection — see `app/front/src/socket.js`).
- **Each Node instance** holds authoritative state for the rooms homed on it, in
  memory — same race-free model as single-instance.
- **Redis** provides the socket.io adapter (cross-instance emits) and a room-
  ownership registry: an instance claims `mafia:room-owner:<room>` when it creates
  a room (SET NX, 30s TTL, 10s heartbeat). If routing is ever misconfigured and a
  second instance is asked to create a room it doesn't own, the claim conflicts and
  players get a clean join error instead of a split-brain room. Claims of a crashed
  instance expire within 30s, freeing its room codes.

## Run

1. **Redis** (any 6+):

   ```
   redis-server            # or a managed instance
   ```

2. **N backend instances** (one process per CPU core is plenty):

   ```
   cd app/back
   PORT=3001 REDIS_URL=redis://127.0.0.1:6379 CORS_ORIGIN=https://brianl.tech node index.js
   PORT=3002 REDIS_URL=redis://127.0.0.1:6379 CORS_ORIGIN=https://brianl.tech node index.js
   ```

   (Use pm2/systemd in production; `INSTANCE_ID` is auto-generated, or set it
   for stable names in logs/healthz.)

3. **Frontend build**, pointed at the public origin:

   ```
   cd app/front
   REACT_APP_SERVER_URL=https://brianl.tech npm run build
   ```

   Copy `build/` to the nginx root (see `nginx.conf.example`).

4. **nginx**: adapt `nginx.conf.example` (instance list, TLS paths), reload.

## Verify

- `curl https://brianl.tech/healthz` a few times — `instance` should vary.
- Open two rooms in separate browsers; each room's traffic pins to one instance
  (check per-instance `:3001/healthz` room counts).
- Kill one instance mid-game: its rooms are lost (accepted — in-flight games
  don't survive restarts), players get a join error on rejoin and can start a
  new room; other instances' games are unaffected. The dead instance's room
  claims expire within 30s.

## Notes

- **Without `REDIS_URL`** the server runs single-instance, exactly as before —
  dev workflow (`npm start`) is unchanged.
- Scaling events (adding/removing upstream servers) remap ~1/N of room *codes*.
  An in-flight room whose code remaps will hit the ownership registry conflict
  on new joins; current players stay connected (their sockets are already
  established).
