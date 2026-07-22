import React, { useEffect, useState } from "react";

const styles = {
  container: {
    background: 'linear-gradient(135deg, #e6e9f0 0%, #ffe7b3 100%)',
    color: '#23244a',
    minHeight: '100vh',
    padding: '40px',
    borderRadius: '18px',
    boxShadow: '0 8px 32px 0 rgba(220, 185, 100, 0.10)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  section: {
    background: 'rgba(255,255,255,0.94)',
    borderRadius: '15px',
    padding: '24px 36px',
    margin: '16px 0',
    boxShadow: '0 2px 8px 0 rgba(210, 178, 120, 0.10)',
    width: '100%',
    maxWidth: '540px',
    textAlign: 'center',
  },
  title: {
    fontSize: '2.2rem',
    fontWeight: 700,
    letterSpacing: '2px',
    marginBottom: '12px',
    color: '#e8b067',
    textShadow: '0 2px 12px #ffe9b766, 0 1px 1px #fff8',
  },
  role: {
    fontSize: '1.35rem',
    fontWeight: 600,
    margin: '10px 0 18px 0',
    color: '#6b8aff',
    textTransform: 'capitalize',
    textShadow: '0 1px 8px #d2d2fa66',
  },
  button: {
    background: 'linear-gradient(90deg, #ffd86b 0%, #6b8aff 100%)',
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
    color: '#e8b067',
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
  descriptionBox: {
    background: 'rgba(255,255,255,.14)',
    borderRadius: '12px',
    margin: '18px 0 10px 0',
    padding: '16px 20px',
    color: '#23244a',
    boxShadow: '0 1px 6px #ffd86b33',
    position: 'relative',
  },
  chatWindow: {
    background: 'rgba(255,255,255,0.92)',
    borderRadius: '15px',
    boxShadow: '0 2px 8px 0 #ffd86b22',
    padding: '0 0 14px 0',
    marginTop: 24,
    width: '100%',
    maxWidth: '540px',
    display: 'flex',
    flexDirection: 'column',
  },
  chatHeader: {
    background: 'linear-gradient(90deg, #ffd86b 0%, #ffe7b3 100%)',
    borderTopLeftRadius: '15px',
    borderTopRightRadius: '15px',
    padding: '16px 0 10px 0',
    fontWeight: 700,
    fontSize: '1.22rem',
    color: '#b67c14',
    letterSpacing: '1px',
    boxShadow: '0 2px 8px #ffd86b11',
  },
  chatBody: {
    padding: '12px 18px',
    minHeight: '240px',
    maxHeight: '260px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '9px',
  },
  message: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    margin: '0 0 2px 0',
  },
  messageContent: {
    background: 'rgba(255,232,160,.38)',
    color: '#23244a',
    padding: '7px 14px',
    borderRadius: '8px',
    fontWeight: 500,
    fontSize: '1.08rem',
    maxWidth: '340px',
    wordBreak: 'break-word',
    boxShadow: '0 1px 5px #ffd86b22',
  },
  messageMeta: {
    fontSize: '0.91rem',
    color: '#b67c14',
    display: 'flex',
    gap: '8px',
    marginTop: '2px',
    opacity: 0.82,
  },
  chatFooter: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px 0 14px',
    gap: '8px',
  },
  input: {
    flex: 1,
    borderRadius: '7px',
    border: '1px solid #ffd86b99',
    padding: '9px 13px',
    fontSize: '1.03rem',
    outline: 'none',
    marginRight: '8px',
    background: '#fff8e1',
    color: '#23244a',
  },
  sendButton: {
    background: 'linear-gradient(90deg, #ffd86b 0%, #6b8aff 100%)',
    color: '#23244a',
    border: 'none',
    borderRadius: '7px',
    padding: '8px 15px',
    fontSize: '1.15rem',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 8px #ffd86b22',
    transition: 'background 0.14s',
  },
};

export function Morning({ socket, username, room, role, spectator, seconds }) {
  const [currentMessage, setCurrentMessage] = useState("");
  const [messageList, setMessageList] = useState([]);
  const [aliveUserList, setAliveUserList] = useState([]);
  const [spectatingUserList, setSpectatingUserList] = useState([]);
  const [checkRole, setCheckRole] = useState(false);
  const [roleDescription, setRoleDescription] = useState("");

  // The server stamps author/time from the socket's authenticated seat and
  // rejects messages from dead players; we only send the text.
  const sendMessage = () => {
    if (currentMessage !== "" && spectator === false) {
      const now = new Date();
      socket.emit("send_message", { message: currentMessage });
      setMessageList((list) => [...list, {
        author: username,
        message: currentMessage,
        time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`,
      }]);
      setCurrentMessage("");
    }
  };

  useEffect(() => {
    const handleReceive = (data) => setMessageList((list) => [...list, data]);
    socket.on("receive_message", handleReceive);
    return () => {
      socket.off("receive_message", handleReceive);
    };
  }, [socket]);

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
      setRoleDescription("The mafia is the evil guy, blah blah blah, kill someone each night...");
    }
    else if (role === "doctor") {
      setRoleDescription("The doctor is a pretty cool role, blah blah blah, grant invincibility to a person for a night...");
    }
    else if (role === "cop") {
      setRoleDescription("The cop is cool i guess, blah blah blah, select someone to investigate each night to learn their role in the morning...");
    }
    else {
      setRoleDescription("The innocent is a basic role... you have no special role at night. Fear not because there is power in numbers, pay attention to the others' behaviour and vote to condemn the suspicious in the morning!");
    }
  }

  function constant() {
    return (
      <div style={styles.section}>
        <div>
          <div style={styles.title}>Morning Phase</div>
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
          <div style={styles.timer}>☀️ Time left: <span>{seconds}s</span></div>
        </div>
        <div style={{ marginTop: '18px' }}>
          <div style={{ fontWeight: 600, color: '#e8b067' }}>Alive:</div>
          <div style={styles.userList}>
            {aliveUserList.map((uname, idx) => (
              <span key={uname + idx}>{uname}</span>
            ))}
          </div>
          <div style={{ fontWeight: 600, color: '#6b8aff', marginTop: 12 }}>Spectating:</div>
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
      {constant()}
      <div style={styles.chatWindow}>
        <div style={styles.chatHeader}>
          Chat Room <span style={{ fontWeight: 400, marginLeft: 12 }}>{seconds}s</span>
        </div>
        <div style={styles.chatBody}>
          {messageList.map((messageContent, index) => (
            <div style={styles.message} key={index}>
              <div style={styles.messageContent}>
                <p style={{ margin: 0 }}>{messageContent.message}</p>
              </div>
              <div style={styles.messageMeta}>
                <span>{messageContent.time}&nbsp;</span>
                <span>{messageContent.author}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={styles.chatFooter}>
          <input
            style={styles.input}
            type="text"
            value={currentMessage}
            placeholder="Type your message..."
            onChange={(event) => setCurrentMessage(event.target.value)}
            onKeyPress={(event) => { event.key === 'Enter' && sendMessage(); }}
          />
          <button style={styles.sendButton} onClick={sendMessage}>&#9658;</button>
        </div>
      </div>
    </div>
  );
}

export default Morning
