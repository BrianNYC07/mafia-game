import io from 'socket.io-client';

// Server URL is configurable for deployment; defaults to local dev backend.
const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3001";

// The room code rides on the connection as ?room=<code> so a load balancer
// can route every player of a room to the same server instance
// (nginx: `hash $arg_room consistent` — see deploy/nginx.conf.example).
// The query is attached to every engine.io request, so hashing works for
// both websocket and polling transports.
export function createRoomSocket(room) {
  return io(SERVER_URL, { query: { room } });
}
