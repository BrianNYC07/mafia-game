# Latency benchmark

Reproduce with `cd app/back && npm run bench` (script: `app/back/bench/latency.js`,
raw output: `app/back/bench/results.json`).

## What is measured

The server is booted in its own process. Real `socket.io-client` connections fill
N concurrent 5-player rooms and play through the join → game-start handshake. The
headline measurement is round-trip time on the request/response path every phase
component uses: client emits `request_alive_userList`, server authorizes the
socket's seat, reads room state, and replies with `user_alive_list`.

Two RTT numbers are reported per level, and the distinction matters:

- **Isolated** — all N players stay connected (the server holds every socket and
  all room state), but only **one** client pings at a time. This isolates the
  server's per-event handling cost.
- **Saturated** — every client pings as fast as it can. At high player counts this
  is dominated by the **benchmark client's** event loop: one Node process driving
  250 sockets is itself the bottleneck, not the server.

## Results

Node v22.19.0, Windows 11, single server instance, loopback. Client and server on
the same machine.

| Rooms | Players | Isolated p50 | Isolated p95 | Saturated p50 | Join p50 |
|------:|--------:|-------------:|-------------:|--------------:|---------:|
|     1 |       5 |      2.13 ms |      3.12 ms |       0.51 ms |  1.40 ms |
|    10 |      50 |      2.01 ms |      3.79 ms |       8.71 ms |  6.30 ms |
|    25 |     125 |      1.44 ms |      4.29 ms |      14.93 ms | 13.22 ms |
|    50 |     250 |      1.45 ms |      3.49 ms |      20.70 ms | 22.25 ms |

**Finding:** server-side event handling stays flat at **1.4–2.1 ms p50 (≤4.3 ms p95)
as concurrent players scale 5 → 250** — a 50× increase in load with no latency
growth. The saturated column climbs linearly over the same range because the
single-process test client saturates, which is a property of the harness, not the
server.

(The slight *improvement* in isolated p50 across levels is V8 JIT warmup, not a
real effect of load.)

## Limitations — read before quoting these numbers

- **Loopback, single machine.** No network transit, no TLS. Real user-perceived
  latency is dominated by internet RTT (typically 20–100 ms), which this does not
  measure. These numbers describe *server processing*, not end-to-end experience.
- **No ceiling was found.** 250 concurrent players is where the *test client*
  became the constraint, not the server. The real capacity limit is higher and
  remains unmeasured — establishing it needs distributed load generators.
- **Single instance.** The Redis/multi-instance path (`REDIS_URL` set) is not
  exercised here.
- The benchmark paces its isolated probe under the server's own rate limiter
  (~15 events/s per socket, an anti-abuse feature), rather than disabling it.

## Honest framing for a résumé

Supportable:

> Benchmarked with a multi-client load harness: server-side event-handling latency
> held flat at ~1.5 ms p50 (<5 ms p95) while scaling 5 → 250 concurrent players on
> a single instance.

Not supportable from this data: "250 concurrent users in production", "sub-2ms
latency for users", or any throughput/capacity ceiling claim.
