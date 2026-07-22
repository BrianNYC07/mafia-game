// Pure game logic for the Mafia game. No I/O, no sockets, no timers —
// everything in here is deterministic and unit-testable.

const PHASES = [
  { name: "Night", duration: 15 },
  { name: "Dawn", duration: 6 },
  { name: "Morning", duration: 10 },
  { name: "Evening", duration: 15 },
  { name: "Dusk", duration: 7 },
];

const ROLES = ["mafia", "cop", "doctor", "fool", "innocent"];
const ROOM_SIZE = 5;
const NIGHT_ROLES = ["mafia", "doctor", "cop"];

// Deal a role not yet present in the room. With ROOM_SIZE === ROLES.length
// every role appears exactly once per full room.
function pickRole(rolesInRoom) {
  const remaining = ROLES.filter((r) => !rolesInRoom.includes(r));
  return remaining[Math.floor(Math.random() * remaining.length)];
}

// Resolve the night's actions.
// actions: { mafia: username|null, doctor: username|null, cop: username|null }
// Returns { attacked, died }:
//   attacked — who the mafia targeted (null if no attack)
//   died     — the victim if the doctor did not protect them, else null
function resolveNight(actions) {
  const attacked = actions.mafia || null;
  if (!attacked) return { attacked: null, died: null };
  const saved = actions.doctor === attacked;
  return { attacked, died: saved ? null : attacked };
}

// Tally condemnation votes. votes: { voterUsername: targetUsername }
// Returns the condemned username, or null when there are no votes or the
// top two targets tie (parity with the original tie/no-vote behaviour).
function tallyVotes(votes) {
  const counts = new Map();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

// Evaluate the win condition. players: [{ role, alive }]
// foolCondemned: the fool was just condemned (fool wins immediately).
// Returns "fool" | "town" | "mafia" | null (game continues).
function checkWin(players, { foolCondemned = false } = {}) {
  if (foolCondemned) return "fool";
  const alive = players.filter((p) => p.alive);
  const mafiaCount = alive.filter((p) => p.role === "mafia").length;
  if (mafiaCount === 0) return "town";
  // Mafia win at parity: town can no longer outvote the mafia.
  if (mafiaCount >= alive.length - mafiaCount) return "mafia";
  return null;
}

module.exports = {
  PHASES,
  ROLES,
  ROOM_SIZE,
  NIGHT_ROLES,
  pickRole,
  resolveNight,
  tallyVotes,
  checkWin,
};
