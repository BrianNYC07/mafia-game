// Key for the per-tab session identity used to reconnect to a seat.
export const SESSION_KEY = "mafia_session";

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
