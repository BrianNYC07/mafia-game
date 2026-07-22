import React, { useEffect, useState } from "react";
import { clearSession } from './session.js';

const MESSAGES = {
  town: "The townsfolk have eliminated all mafia from their party!",
  mafia: "The mafia has killed all other members in the party!",
  fool: "As the fool takes their last breath, you realize that you've made a mistake. The fool has won by getting themself condemned!",
};

// The winner comes from the server's authoritative `game_over` event.
export function Win({ socket, winner }) {
  const [seconds, setSeconds] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (seconds <= 0) {
      clearSession();
      socket.emit("leave_room");
      window.location.reload();
    }
  }, [seconds, socket]);

  return (
    <div>
      <p> {MESSAGES[winner] || "The game has ended."} </p>
      <p> room closes in: </p>
      <p> {Math.max(seconds, 0)} </p>
    </div>
  )
}

export default Win
