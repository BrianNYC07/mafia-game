import React, { useEffect, useState } from "react";
import { Game } from './Game.js';

export function WaitingRoom({ socket, session }) {
  const [userList, setUserList] = useState([]);
  // The server tells us when the game starts; a reconnect may land mid-game.
  const [started, setStarted] = useState(session.started);

  useEffect(() => {
    const handleUserList = (data) => setUserList(data);
    const handleGameStart = () => setStarted(true);

    socket.on("user_list", handleUserList);
    socket.on("game_start", handleGameStart);
    socket.emit("request_userList");

    return () => {
      socket.off("user_list", handleUserList);
      socket.off("game_start", handleGameStart);
    };
  }, [socket]);

  if (started) {
    return (
      <Game
        socket={socket}
        username={session.username}
        room={session.room}
        role={session.role}
        initialSpectator={!session.alive}
        initialPhase={session.phaseIndex}
        initialTimeLeft={session.timeLeft}
      />
    );
  }

  const centerStyle = {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    background: "none"
  };

  const titleStyle = {
    fontSize: "2.5rem",
    fontWeight: "bold",
    marginBottom: "0.5em",
    letterSpacing: "2px"
  };

  const subtitleStyle = {
    fontSize: "1.4rem",
    fontWeight: "500",
    marginBottom: "1em",
  };

  const listStyle = {
    fontSize: "1.15rem",
    margin: 0,
    padding: 0,
    listStyleType: "none"
  };

  const listItemStyle = {
    marginBottom: "0.25em"
  };

  return (
    <div style={centerStyle}>
      <div style={titleStyle}>WAITING ROOM</div>
      <div style={subtitleStyle}>
        Users in room: {userList.length} / 5
      </div>
      <ul style={listStyle}>
        {userList.map((uname, index) => (
          <li key={index} style={listItemStyle}>{uname}</li>
        ))}
      </ul>
    </div>
  )
}

export default WaitingRoom
