import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { startGestureDetection } from "./handGesture";
import BridgeGame from "./BridgeGame";

const SERVER_URL = "http://localhost:3000";
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function generateRoomId() {
  return crypto.randomUUID().slice(0, 8);
}

/** Link that puts whoever opens it straight into the room as broadcaster. */
function buildShareLink(id) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", id);
  url.searchParams.set("role", "broadcaster");
  return url.toString();
}

export default function App() {
  const [roomId, setRoomId] = useState("");
  const [role, setRole] = useState("broadcaster");
  const [status, setStatus] = useState("Chưa vào phòng");
  const [joined, setJoined] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomIdRef = useRef("");
  const roleRef = useRef("broadcaster");
  const remoteVideoRef = useRef(null);
  const autoJoinedRef = useRef(false);
  const gestureRef = useRef(null);
  const gestureStopRef = useRef(null);

  function stopGestureDetection() {
    if (gestureStopRef.current) {
      gestureStopRef.current();
      gestureStopRef.current = null;
    }
    gestureRef.current = null;
  }

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
    });

    socket.on("viewer-joined", async () => {
      const peer = peerRef.current;
      if (!peer) {
        return;
      }
      setStatus("Viewer đã vào, đang gửi offer...");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("offer", { roomId: roomIdRef.current, offer });
    });

    socket.on("offer", async (offer) => {
      const peer = peerRef.current;
      if (!peer) {
        return;
      }
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("answer", { roomId: roomIdRef.current, answer });
      setStatus("Đã gửi answer, đang kết nối...");
    });

    socket.on("answer", async (answer) => {
      const peer = peerRef.current;
      if (!peer) {
        return;
      }
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on("ice-candidate", async (candidate) => {
      const peer = peerRef.current;
      if (!peer || !candidate) {
        return;
      }
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("Lỗi thêm ICE candidate:", err);
      }
    });

    socket.on("broadcaster-joined", () => {
      setStatus("Người phát đã vào phòng.");
    });

    socket.on("broadcaster-left", () => {
      setStatus("Người phát đã rời phòng.");
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    });

    socket.on("viewer-left", () => {
      setStatus("Viewer đã rời phòng.");
    });

    socket.on("room-full", (message) => {
      setStatus(message);
    });

    socket.on("error-message", (message) => {
      setStatus(message);
    });

    return () => {
      socket.disconnect();
      if (peerRef.current) {
        peerRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      stopGestureDetection();
    };
  }, []);

  // A link built by buildShareLink() carries ?room=...&role=broadcaster so
  // whoever opens it joins as broadcaster immediately, no form interaction.
  useEffect(() => {
    if (autoJoinedRef.current) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const sharedRoom = params.get("room");
    const sharedRole = params.get("role");
    if (!sharedRoom || sharedRole !== "broadcaster") {
      return;
    }
    autoJoinedRef.current = true;
    setRoomId(sharedRoom);
    setRole("broadcaster");
    roomIdRef.current = sharedRoom;
    roleRef.current = "broadcaster";
    startBroadcaster().catch((err) => {
      console.error(err);
      setStatus(`Lỗi: ${err.message}`);
    });
  }, []);

  function createPeerConnection() {
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", {
          roomId: roomIdRef.current,
          candidate: event.candidate,
        });
      }
    };

    peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
    };

    peer.onconnectionstatechange = () => {
      console.log("Connection:", peer.connectionState);
      if (peer.connectionState === "connected") {
        setStatus("Đã kết nối");
        setConnected(true);
        if (roleRef.current === "viewer" && remoteVideoRef.current && !gestureStopRef.current) {
          gestureStopRef.current = startGestureDetection(remoteVideoRef.current, (gesture) => {
            gestureRef.current = gesture;
          });
        }
      }
      if (
        peer.connectionState === "disconnected" ||
        peer.connectionState === "failed" ||
        peer.connectionState === "closed"
      ) {
        setStatus(`Connection: ${peer.connectionState}`);
        setConnected(false);
        stopGestureDetection();
      }
    };

    peerRef.current = peer;
    return peer;
  }

  async function startBroadcaster() {
    setStatus("Đang mở camera...");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    localStreamRef.current = stream;

    const peer = createPeerConnection();
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));

    socketRef.current.emit("join-room", {
      roomId: roomIdRef.current,
      role: "broadcaster",
    });
    setJoined(true);
    setStatus("Đã vào phòng. Đang chờ viewer...");
  }

  function startViewer() {
    createPeerConnection();
    socketRef.current.emit("join-room", {
      roomId: roomIdRef.current,
      role: "viewer",
    });
    setJoined(true);
    setStatus("Đã vào phòng. Đang chờ người phát...");
  }

  async function handleJoin() {
    const trimmedRoomId = roomId.trim();
    if (!trimmedRoomId) {
      setStatus("Vui lòng nhập Room ID.");
      return;
    }
    roomIdRef.current = trimmedRoomId;
    roleRef.current = role;

    try {
      if (role === "broadcaster") {
        await startBroadcaster();
      } else {
        startViewer();
      }
    } catch (err) {
      console.error(err);
      setStatus(`Lỗi: ${err.message}`);
    }
  }

  function handleCreateRoom() {
    const newRoomId = generateRoomId();
    setRoomId(newRoomId);
    setRole("viewer");
    roomIdRef.current = newRoomId;
    roleRef.current = "viewer";
    setShareLink(buildShareLink(newRoomId));
    setCopied(false);
    startViewer();
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
    } catch (err) {
      console.error("Không copy được link:", err);
    }
  }

  const gameMode = role === "viewer" && connected;

  return (
    <div className="app">
      {!gameMode && (
        <>
          <h1>WebRTC 1-to-1</h1>

          <div className="controls">
            <button onClick={handleCreateRoom} disabled={joined}>
              Tạo phòng để xem
            </button>
          </div>

          {shareLink && (
            <div className="share-link">
              <input
                type="text"
                readOnly
                value={shareLink}
                onFocus={(e) => e.target.select()}
              />
              <button onClick={handleCopyLink}>{copied ? "Đã copy" : "Copy link"}</button>
            </div>
          )}

          <details className="manual-join">
            <summary>Vào phòng thủ công</summary>
            <div className="controls">
              <input
                type="text"
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                disabled={joined}
              />
              <select value={role} onChange={(e) => setRole(e.target.value)} disabled={joined}>
                <option value="broadcaster">Người phát</option>
                <option value="viewer">Người xem</option>
              </select>
              <button onClick={handleJoin} disabled={joined}>
                Vào phòng
              </button>
            </div>
          </details>

          <div className="status">{status}</div>
        </>
      )}

      {/* Only the viewer ever has anything to show here — the broadcaster
          doesn't self-preview their camera, and never receives a stream
          back. In game mode this becomes a picture-in-picture preview
          layered over the game canvas instead of a full-size box. */}
      {role === "viewer" && (
        <div className="videos">
          <div className={`video-container ${gameMode ? "video-container--pip" : ""}`}>
            {!gameMode && <h2>Remote</h2>}
            <video ref={remoteVideoRef} autoPlay playsInline />
          </div>
        </div>
      )}

      {gameMode && (
        <div className="game-overlay">
          <BridgeGame gestureRef={gestureRef} />
        </div>
      )}
    </div>
  );
}
