import React, { useRef, useEffect, useState } from "react";
import guillotine from "./animations/condemn.png";

const styles = {
  container: {
    background: 'linear-gradient(135deg, #eed6b7 0%, #b6b8d6 100%)',
    color: '#23244a',
    minHeight: '100vh',
    padding: '40px',
    borderRadius: '18px',
    boxShadow: '0 8px 32px 0 rgba(185, 153, 77, 0.13)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  section: {
    background: 'rgba(255,255,255,0.92)',
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
    color: '#bfa261',
    textShadow: '0 2px 12px #fff9, 0 1px 1px #fff8',
  },
  role: {
    fontSize: '1.35rem',
    fontWeight: 600,
    margin: '10px 0 18px 0',
    color: '#7e7fff',
    textTransform: 'capitalize',
    textShadow: '0 1px 8px #d2d2fa66',
  },
  button: {
    background: 'linear-gradient(90deg, #ffd86b 0%, #7e7fff 100%)',
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
    boxShadow: '0 2px 16px #ffd86b33',
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
    color: '#bfa261',
    textShadow: '0 1px 6px #ffd86b55',
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
    background: 'rgba(186,168,120,.12)',
    borderRadius: '8px',
    padding: '8px 16px',
    margin: '16px auto 8px auto',
    color: '#bfa261',
    fontWeight: 500,
    fontSize: '1.1rem',
    width: 'fit-content',
    boxShadow: '0 2px 8px #ffd86b11',
  },
  descriptionBox: {
    background: 'rgba(255,255,255,.14)',
    borderRadius: '12px',
    margin: '18px 0 10px 0',
    padding: '16px 20px',
    color: '#23244a',
    boxShadow: '0 1px 6px #ffd86b33',
    position: 'relative',
  },
};

// Dusk is display-only: the server already resolved the vote, eliminated the
// condemned player, and told them privately via `you_died`.
export function Dusk({ socket, username, room, role, spectator, seconds, condemn }) {
  const [aliveUserList, setAliveUserList] = useState([]);
  const [spectatingUserList, setSpectatingUserList] = useState([]);
  const [checkRole, setCheckRole] = useState(false);
  const [roleDescription, setRoleDescription] = useState("");
  const [done, setDone] = useState(false);

  const Canvas = props => {
    const canvaS = useRef(null);

    useEffect(() => {
      const updateCanvas = canvaS.current;
      if (!updateCanvas) { // if null
        return;
      }
      const context = updateCanvas.getContext('2d');
      const image = new Image();
      image.src = guillotine;
      var intervalID = null;
      var row = 0;
      var col = 0;
      var speed = 300;

      image.onload = function () {
        if (!done) {
          setDone(true);
          intervalID = setInterval(animate, speed, 5, 5, 2);
        }
      }

      function animate(rows, cols, endCol) {
        if (col === cols) {
            col = 0;
            row += 1;
        }
        console.log(row, col);
        context.clearRect(0, 0, 500, 500);
        context.drawImage(image, 0+480*col, 0+480*row, 480, 480, 0, 0, 500, 500);
        if (row === (rows-1) && col === (endCol-1)) {
            clearInterval(intervalID);
        }

        col += 1;
      }

    }, []);
    return <canvas ref={canvaS} {...props} width="500" height="500"/>
  }

  const show_condemned = () => {
    if (condemn !== "") {
      return (
        <div style={styles.msg}>
          <b>{condemn}</b> has been sentenced to death by DEATH!!!!
        </div>
      );
    }
    else {
      return (
        <div style={styles.msg}>
          A decision could not be reached. Everyone returns to their own cabins feeling uneasy.
        </div>
      );
    }
  };

  // Get user lists
  useEffect(() => {
    socket.on("user_alive_list", setAliveUserList);
    socket.on("user_spectating_list", setSpectatingUserList);
    socket.emit("request_alive_userList");
    socket.emit("request_spectating_userList");
    return () => {
      socket.off("user_alive_list", setAliveUserList);
      socket.off("user_spectating_list", setSpectatingUserList);
    };
    // eslint-disable-next-line
  }, [socket, room]);

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
          <div style={styles.title}>Dusk Phase</div>
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
          <div style={styles.timer}>🌆 Time left: <span>{seconds}s</span></div>
        </div>
        { Canvas() }
        <div style={{ marginTop: '18px' }}>
          <div style={{ fontWeight: 600, color: '#bfa261' }}>Alive:</div>
          <div style={styles.userList}>
            {aliveUserList.map((uname, idx) => (
              <span key={uname + idx}>{uname}</span>
            ))}
          </div>
          <div style={{ fontWeight: 600, color: '#7e7fff', marginTop: 12 }}>Spectating:</div>
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
        <div style={styles.title}>Dusk</div>
        <div style={styles.timer}>{seconds}s</div>
        {show_condemned()}
      </div>
    </div>
  );
}

export default Dusk
