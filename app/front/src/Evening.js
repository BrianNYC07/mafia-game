import React, { useEffect, useState } from "react";

const styles = {
  container: {
    background: 'linear-gradient(135deg, #b7b6ee 0%, #fbeedb 100%)',
    color: '#23244a',
    minHeight: '100vh',
    padding: '40px',
    borderRadius: '18px',
    boxShadow: '0 8px 32px 0 rgba(120, 120, 186, 0.14)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  section: {
    background: 'rgba(255,255,255,0.94)',
    borderRadius: '15px',
    padding: '24px 36px',
    margin: '16px 0',
    boxShadow: '0 2px 8px 0 rgba(186, 168, 120, 0.10)',
    width: '100%',
    maxWidth: '480px',
    textAlign: 'center',
  },
  title: {
    fontSize: '2.2rem',
    fontWeight: 700,
    letterSpacing: '2px',
    marginBottom: '12px',
    color: '#6b8aff',
    textShadow: '0 2px 12px #c6caff88, 0 1px 1px #fff8',
  },
  role: {
    fontSize: '1.35rem',
    fontWeight: 600,
    margin: '10px 0 18px 0',
    color: '#bfa261',
    textTransform: 'capitalize',
    textShadow: '0 1px 8px #c2bfa266',
  },
  button: {
    background: 'linear-gradient(90deg, #6b8aff 0%, #ffd86b 100%)',
    color: '#23244a',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 22px',
    margin: '7px 7px 7px 0',
    fontSize: '1.05rem',
    fontWeight: 600,
    letterSpacing: '1px',
    cursor: 'pointer',
    transition: 'all 0.21s cubic-bezier(.4,0,.2,1)',
    boxShadow: '0 2px 16px #6b8aff33',
  },
  buttonClose: {
    background: 'linear-gradient(90deg, #ff6b6b 0%, #ffd86b 100%)',
    color: '#23244a',
    border: 'none',
    borderRadius: '50%',
    width: '32px',
    height: '32px',
    fontSize: '1.1rem',
    fontWeight: 900,
    cursor: 'pointer',
    margin: '10px 0 0 0',
    boxShadow: '0 2px 8px #f66b6b11',
    transition: 'background 0.18s',
  },
  timer: {
    fontSize: '1.25rem',
    fontWeight: 600,
    margin: '18px 0 10px 0',
    color: '#6b8aff',
    textShadow: '0 1px 6px #6b8aff55',
  },
  userList: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    margin: '10px 0 0 0',
    fontSize: '1.09rem',
    color: '#264673',
  },
  spectatingList: {
    color: '#a3a3bb',
    fontStyle: 'italic',
    fontSize: '0.98rem',
    marginTop: '5px',
  },
  msg: {
    background: 'rgba(107,138,255,.12)',
    borderRadius: '8px',
    padding: '8px 16px',
    margin: '16px auto 8px auto',
    color: '#6b8aff',
    fontWeight: 500,
    fontSize: '1.1rem',
    width: 'fit-content',
    boxShadow: '0 2px 8px #6b8aff11',
  },
  descriptionBox: {
    background: 'rgba(255,255,255,.14)',
    borderRadius: '12px',
    margin: '18px 0 10px 0',
    padding: '16px 20px',
    color: '#23244a',
    boxShadow: '0 1px 6px #6b8aff33',
    position: 'relative',
  },
  voteButton: {
    background: 'linear-gradient(90deg, #ff6b6b 0%, #ffd86b 100%)',
    color: '#23244a',
    border: 'none',
    borderRadius: '50%',
    width: '34px',
    height: '34px',
    fontSize: '1.2rem',
    fontWeight: 900,
    cursor: 'pointer',
    marginLeft: '15px',
    boxShadow: '0 2px 8px #ff6b6b22',
    transition: 'background 0.18s',
  },
};

export function Evening({ socket, username, room, role, spectator, seconds }) {
  const [aliveUserList, setAliveUserList] = useState([]);
  const [spectatingUserList, setSpectatingUserList] = useState([]);
  const [checkRole, setCheckRole] = useState(false);
  const [roleDescription, setRoleDescription] = useState("");
  const [target, setTarget] = useState("");
  const [idiotTriedToVote, setIdiotTriedToVote] = useState("");

  useEffect(() => {
    const handleAliveList = (data) => setAliveUserList(data);
    const handleSpectatingList = (data) => setSpectatingUserList(data);

    socket.on("user_alive_list", handleAliveList);
    socket.on("user_spectating_list", handleSpectatingList);

    socket.emit("request_alive_userList");
    socket.emit("request_spectating_userList");

    return () => {
      socket.off("user_alive_list", handleAliveList);
      socket.off("user_spectating_list", handleSpectatingList);
    };
  }, [socket, room]);

  const picked_who = () => {
    if (target !== "" && spectator === false) {
      return (
        <div style={styles.msg}>
          You have voted for <b>{target}</b> to be condemned to death!
        </div>
      );
    }
    return (
      <div style={styles.msg}>
        Who do you think is the most suspicious?
      </div>
    );
  };

  // One vote per player; the server enforces this too (first vote sticks,
  // dead players and dead targets rejected).
  const vote = (uname) => {
    if (spectator === false && target === "") {
      setTarget(uname);
      socket.emit("cast_vote", { target: uname });
    } else if (spectator) {
      setIdiotTriedToVote("You may not vote, you are dead.");
    }
  };

  function description(role) {
    setCheckRole(true);
    if (role === "mafia") {
      setRoleDescription("The mafia's goal is to kill off all the other members in the party while not getting caught. Every night, they can select another player and send death vibes their way!");
    }
    else if (role === "doctor") {
      setRoleDescription("The doctor is a member of the townsfolk with a very special job. Every night, they can select another player and protect them from misfortune.");
    }
    else if (role === "cop") {
      setRoleDescription("The cop is a member of the townsfolk with a very special job. Every night, they can select another player and investigate them and find out their role!");
    }
    else if (role === "fool") {
      setRoleDescription("The fool is neither aligned with the townsfolk nor the mafia. They win upon getting condemned and hung.");
    }
    else {
      setRoleDescription("The innocent is a member of the townsfolk.");
    }
  }

  function constant() {
    return (
      <div style={styles.section}>
        <div>
          <div style={styles.title}>Evening Phase</div>
          <div style={styles.role}>You are the <span>{role}</span></div>
          <div>
            {["mafia", "doctor", "cop", "fool", "innocent"].map((roleName) => (
              <button
                key={roleName}
                style={styles.button}
                onClick={() => description(roleName)}
              >
                {roleName.charAt(0).toUpperCase() + roleName.slice(1)}
              </button>
            ))}
          </div>
          {checkRole && (
            <div style={styles.descriptionBox}>
              <div>{roleDescription}</div>
              <button
                style={styles.buttonClose}
                onClick={() => setCheckRole(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
          )}
          <div style={styles.timer}>🌇 Time left: <span>{seconds}s</span></div>
        </div>
        <div style={{ marginTop: '18px' }}>
          <div style={{ fontWeight: 600, color: '#6b8aff' }}>Alive:</div>
          <div style={styles.userList}>
            {aliveUserList.map((uname, idx) => (
              <span key={uname + idx}>{uname}</span>
            ))}
          </div>
          <div style={{ fontWeight: 600, color: '#bfa261', marginTop: 12 }}>Spectating:</div>
          <div style={styles.spectatingList}>
            {spectatingUserList.map((uname, idx) => (
              <span key={uname + idx}>{uname}</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      { constant() }
      <div style={styles.section}>
        <div style={styles.title}>Evening</div>
        <div style={styles.timer}>{seconds}s</div>
        <div style={{ margin: '16px 0' }}>
          <div style={{ fontWeight: 600, color: '#bfa261', marginBottom: 6 }}>Condemn a player:</div>
          {aliveUserList.map((uname, index) => (
            <div key={uname + index} style={{ display: 'flex', alignItems: 'center', margin: '8px 0' }}>
              <span style={{ fontWeight: 500 }}>{uname}</span>
              <button
                style={styles.voteButton}
                onClick={() => vote(uname)}
                disabled={!!target || spectator}
                aria-label={`Vote to condemn ${uname}`}
                title={`Vote to condemn ${uname}`}
              >💀</button>
            </div>
          ))}
        </div>
        {picked_who()}
        {idiotTriedToVote && (
          <div style={styles.msg}>{idiotTriedToVote}</div>
        )}
      </div>
    </div>
  );
}

export default Evening
