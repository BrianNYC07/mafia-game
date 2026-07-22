import React, { useEffect, useRef, useState } from "react";
import { WaitingRoom } from './WaitingRoom.js';
import { SESSION_KEY } from './session.js';
import { createRoomSocket } from './socket.js';

// Session identity survives a refresh so the server can rebind us to our
// seat (reconnect). Cleared when a game ends or a join is rejected.

export function JoinRoom() {
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("");
  const [error, setError] = useState("");
  const [socket, setSocket] = useState(null);
  // Private state the server sent us on join: role, token, phase, etc.
  const [session, setSession] = useState(null);
  const socketRef = useRef(null);

  // Open a socket for one room (the room code must be known at connection
  // time for load-balancer room affinity) and drive the join handshake.
  const openSocket = (roomId, name) => {
    if (socketRef.current) return; // already connecting/connected
    const s = createRoomSocket(roomId);
    socketRef.current = s;

    // On (re)connect, present our stored token if we have one so the server
    // rebinds our existing seat; otherwise ask for a fresh seat.
    const joinArgs = () => {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        try {
          const { room, username, token } = JSON.parse(stored);
          if (room === roomId) return { room, username, token };
        } catch {
          sessionStorage.removeItem(SESSION_KEY);
        }
      }
      return { room: roomId, username: name };
    };
    s.on("connect", () => s.emit("join_room", joinArgs()));

    s.on("joined", (data) => {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ room: data.room, username: data.username, token: data.token })
      );
      setError("");
      setSession(data);
    });

    s.on("join_error", (data) => {
      sessionStorage.removeItem(SESSION_KEY);
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
      setSession(null);
      setError(data && data.reason ? data.reason : "Could not join.");
    });

    setSocket(s);
  };

  // Auto-rejoin after a refresh.
  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const { room, username } = JSON.parse(stored);
        openSocket(room, username);
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, []);

  const joinRoom = () => {
    if (username !== "" && room !== "") {
      openSocket(room, username);
    }
  };

  if (session && socket) {
    return (
      <div className="App">
        <WaitingRoom socket={socket} session={session} />
      </div>
    );
  }

  return (
    <div className="App">
      <div className="joinChatContainer">
        <h3> Join Room </h3>
        <input
          type="text"
          placeholder="Name..."
          maxLength={20}
          onChange={(event) => setUsername(event.target.value)}
          onKeyPress={(event) => { event.key === 'Enter' && joinRoom(); }}
        />
        <input
          type="text"
          placeholder="Room ID..."
          maxLength={16}
          onChange={(event) => setRoom(event.target.value)}
          onKeyPress={(event) => { event.key === 'Enter' && joinRoom(); }}
        />
        <button onClick={joinRoom}> connect </button>
        {socket && !session && <p>Connecting…</p>}
        {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
      </div>
    </div>
  )
}

export default JoinRoom
