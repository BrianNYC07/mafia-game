# Containerized deploy — nginx + Redis + 2 Node instances (one command)

This runs the **entire architecture** with `docker compose up`: two Node
instances behind nginx `hash $arg_room consistent` room routing, both using
Redis for the Socket.IO adapter and the room-ownership registry, with nginx
serving the React build and terminating TLS. No app-code changes.

## What runs

| Service | Image / build | Role |
|---|---|---|
| `redis` | `redis:7-alpine` | Socket.IO adapter (cross-instance emits) + room-ownership registry |
| `back1`, `back2` | `app/back/Dockerfile` | Authoritative Node instances (`REDIS_URL` set → multi-instance mode) |
| `web` | `deploy/web.Dockerfile` | nginx: room-hash routing, serves React build, TLS |
| `certbot` | `certbot/certbot` | One-shot Let's Encrypt issuance/renewal (profile-gated) |

Scaling is one line: add `back3` and a `server back3:3001;` in the nginx
`upstream`. Consistent hashing remaps only ~1/N of room codes.

---

## Prerequisites

- A Linux VPS (Ubuntu 22.04/24.04, 1 GB+ RAM).
- A registered domain you can set DNS on.
- Docker Engine + Compose plugin (installed in Step 2).

---

## Step 1 — Create the server

Spin up an Ubuntu VPS (Hetzner CX22, DigitalOcean $6 droplet, etc.). Note its
public IP. Open the firewall for SSH + web:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## Step 2 — Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in so `docker` works without sudo
```

## Step 3 — Get the code onto the server

```bash
git clone <your-repo-url> mafia && cd mafia
# (or: scp -r ./TheLastProject_... user@SERVER_IP:~/mafia)
```

## Step 4 — Bring it up over HTTP and verify every component

```bash
docker compose up -d --build
docker compose ps          # redis, back1, back2, web all "running"
```

**Verify the architecture is real** (replace `SERVER_IP`):

```bash
# Room routing: the SAME room always hits ONE backend; different rooms can
# land on different backends. The instance id is back1 or back2.
curl "http://SERVER_IP/healthz?room=alpha"
curl "http://SERVER_IP/healthz?room=alpha"     # same instance both times (affinity)
curl "http://SERVER_IP/healthz?room=bravo"     # try a few codes to find one on back2
```

> Note: `/healthz` with **no** `?room=` always resolves to one instance — the
> hash key is empty, so it's deterministic. Vary `?room=` to see routing.

```bash
# Watch both instances; a room's joins appear in exactly one backend's log.
docker compose logs -f back1 back2
```

Then play a full game: open `http://SERVER_IP` in **5 tabs**, same Room ID,
5 names — the game starts on the 5th join ([`ROOM_SIZE = 5`](../app/back/game.js)).
Kill an instance mid-game (`docker compose stop back2`) to see the other
instance's rooms keep running and the dead instance's claims expire.

## Step 5 — Point your domain at the server

At your registrar/DNS, add an **A record** for `YOUR_DOMAIN` (and `www` if you
want) → `SERVER_IP`. Wait for it to propagate:

```bash
dig +short YOUR_DOMAIN     # should print SERVER_IP
```

## Step 6 — Get a TLS certificate

The stack is already serving `:80` with the ACME challenge location, so issue
directly (fill in your domain + email):

```bash
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d YOUR_DOMAIN \
  --email you@example.com --agree-tos --no-eff-email
# add another -d www.YOUR_DOMAIN if you pointed www too
```

You should see “Successfully received certificate”. Certs live in the
`letsencrypt` volume, shared with nginx.

## Step 7 — Switch nginx to HTTPS

Put your real domain into the TLS config and make it the active one:

```bash
sed -i 's/YOUR_DOMAIN/your.actual.domain/g' deploy/nginx.tls.conf

# Make the TLS config sticky for all future `up` commands:
echo 'NGINX_CONF=./deploy/nginx.tls.conf' > .env

docker compose up -d       # web now serves 443 with your cert
```

Visit **https://your.actual.domain** — the game, over HTTPS. Done.

## Step 8 — Auto-renew certificates

Add a host cron (`crontab -e`) — renew, then reload nginx to pick up new certs:

```cron
0 3 * * * cd /home/YOUR_USER/mafia && docker compose run --rm certbot renew --webroot -w /var/www/certbot --quiet && docker compose exec -T web nginx -s reload
```

---

## Does this back the resume line?

> *Scaled horizontally with Nginx room routing, a Redis registry, and the
> Socket.IO adapter; added token reconnection, rate limiting, and payload
> validation.*

| Claim | Proven by |
|---|---|
| Nginx room routing | `hash $arg_room consistent` in [nginx.http.conf](nginx.http.conf) / [nginx.tls.conf](nginx.tls.conf); Step 4 `?room=` test |
| Horizontal scaling | `back1` + `back2` (add `back3…`) both live behind nginx |
| Redis registry | `REDIS_URL` set → [registry.js](../app/back/registry.js) claims `mafia:room-owner:*` |
| Socket.IO adapter | `REDIS_URL` set → [index.js `initRedis`](../app/back/index.js) attaches the Redis adapter |
| Token reconnection | [index.js `join_room`](../app/back/index.js) rebinds a seat by token |
| Rate limiting | `allowEvent` token bucket in [index.js](../app/back/index.js) |
| Payload validation | `maxHttpBufferSize` + `isName`/`isRoomId`/length checks in [index.js](../app/back/index.js) |

---

## Operations

- **Logs:** `docker compose logs -f web back1 back2`
- **Update after a code change:** `git pull && docker compose up -d --build`
- **Add an instance:** add a `back3` service (copy `back2`, `INSTANCE_ID: back3`)
  and a `server back3:3001;` line in both nginx configs, then `up -d --build`.
- **Tighten CORS:** the game is same-origin through nginx, so `CORS_ORIGIN: "*"`
  is harmless, but you can set `CORS_ORIGIN: "https://your.actual.domain"` on
  `back1`/`back2` in `docker-compose.yml`.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `docker compose up --build` killed during the React build | Out of RAM. Use a 2 GB+ server, or add swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` (persist in `/etc/fstab`). |
| certbot: "challenge failed" / "connection refused" | DNS not pointing at the server yet (`dig +short YOUR_DOMAIN` must equal the IP), or port 80 blocked (open it in `ufw` **and** any cloud-provider firewall), or the HTTP stack isn't up. |
| Site loads but "Connecting…" never resolves | Socket can't reach the backend. Check `docker compose logs web back1 back2`; confirm `/socket.io/` proxies (nginx conf) and that `CORS_ORIGIN` allows the site. |
| Polling errors / "Session ID unknown" | Affinity broke. Every request must carry `?room=` (the client does this) and nginx must `hash $arg_room consistent` — don't remove the hash. |
| `docker compose up` reverted to HTTP after enabling TLS | Missing `.env`. It must contain `NGINX_CONF=./deploy/nginx.tls.conf`. |
| `502 Bad Gateway` on `/socket.io/` | Backends aren't running or upstream names are wrong; `docker compose ps` and check `server back1:3001; server back2:3001;`. |
| Renewed cert but browser still shows the old one | nginx caches certs until reload: `docker compose exec web nginx -s reload`. |

## Caveats (be ready to speak to these)

- **One host.** Compose runs the instances as separate processes on a single
  VM — genuine app-tier horizontal scaling and the same code scales to multiple
  hosts by pointing the nginx `upstream` at more machines. It is not multi-host
  HA on its own.
- **In-memory game state.** A backend restart loses its in-flight rooms (by
  design — see [../spec.md](../spec.md) / AUDIT). Redis holds room *ownership*,
  not full game state.
