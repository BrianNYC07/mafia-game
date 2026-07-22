import './App.css';
import { JoinRoom } from './JoinRoom.js';

// The socket is created per-room inside JoinRoom (the room code must be in
// the connection URL for load-balancer room affinity — see src/socket.js).
function App() {

  return (
    <JoinRoom />
  )
}

export default App;
