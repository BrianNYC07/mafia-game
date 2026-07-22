import React, { useEffect, useState } from "react";
import Night from './Night.js';
import Dawn from './Dawn.js';
import Morning from './Morning.js';
import Evening from './Evening.js';
import Dusk from './Dusk.js';
import Win from './Win.js';
import { script } from './Narration.js';

// Display names only — durations and transitions are owned by the server,
// which drives us via `time_update`.
const PHASE_NAMES = ["Night", "Dawn", "Morning", "Evening", "Dusk"];

export function Game({ socket, username, room, role, initialSpectator, initialPhase, initialTimeLeft }) {
    const [phase, setPhase] = useState(initialPhase || 0);
    const [seconds, setSeconds] = useState(initialTimeLeft ?? 15);
    const [condemned, setCondemned] = useState("");
    const [spectator, setSpectator] = useState(Boolean(initialSpectator));
    const [narration, setNarration] = useState("");
    const [investigation, setInvestigation] = useState(null); // {target, role} — cop only
    const [gameOver, setGameOver] = useState(null); // {winner}

    // These listeners live here (not in the phase components) because the
    // server emits resolution events immediately before the time_update that
    // mounts the next phase component — a listener registered on mount in
    // Dawn/Dusk would miss them.
    useEffect(() => {
        const handleTimeUpdate = ({ timeLeft, phaseIndex }) => {
            setSeconds(timeLeft);
            setPhase(phaseIndex);
            if (PHASE_NAMES[phaseIndex] === "Night") {
                // New cycle: clear last night's/day's outcomes.
                setNarration("");
                setInvestigation(null);
                setCondemned("");
            }
        };
        const handleNightResult = ({ attacked, died }) => {
            setNarration(attacked ? script(attacked, died) : "");
            if (attacked === username && died) setSpectator(true);
        };
        const handleInvestigation = (data) => setInvestigation(data);
        const handleCondemned = (data) => {
            setCondemned(data);
            if (data === username) setSpectator(true);
        };
        const handleYouDied = () => setSpectator(true);
        const handleGameOver = (data) => setGameOver(data);
        // A rebind after a network blip resends our private state; if we died
        // while disconnected we missed you_died, so sync from `joined` too.
        const handleRejoined = (data) => {
            if (data && data.alive === false) setSpectator(true);
        };

        socket.on("joined", handleRejoined);
        socket.on("time_update", handleTimeUpdate);
        socket.on("night_result", handleNightResult);
        socket.on("investigation_result", handleInvestigation);
        socket.on("return_condemned", handleCondemned);
        socket.on("you_died", handleYouDied);
        socket.on("game_over", handleGameOver);

        return () => {
            socket.off("joined", handleRejoined);
            socket.off("time_update", handleTimeUpdate);
            socket.off("night_result", handleNightResult);
            socket.off("investigation_result", handleInvestigation);
            socket.off("return_condemned", handleCondemned);
            socket.off("you_died", handleYouDied);
            socket.off("game_over", handleGameOver);
        };
    }, [socket, username]);

    if (gameOver) {
        return <Win socket={socket} winner={gameOver.winner} />;
    }

    switch (PHASE_NAMES[phase]) {
        case "Night":
            return <Night socket={socket} username={username} room={room} role={role} spectator={spectator} seconds={seconds} />;
        case "Dawn":
            return <Dawn
                socket={socket}
                username={username}
                room={room}
                role={role}
                spectator={spectator}
                seconds={seconds}
                narration={narration}
                investigation={investigation}
            />;
        case "Morning":
            return <Morning socket={socket} username={username} room={room} role={role} spectator={spectator} seconds={seconds} />;
        case "Evening":
            return <Evening socket={socket} username={username} room={room} role={role} spectator={spectator} seconds={seconds} />;
        case "Dusk":
            return <Dusk socket={socket} username={username} room={room} role={role} spectator={spectator} seconds={seconds} condemn={condemned} />;
        default:
            return (
                <div>
                    Unknown phase: {phase}
                </div>
            );
    }
}

export default Game;
