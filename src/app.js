const STORAGE_KEY = "stakeout.rooms.v1";
const LOCAL_KEY = "stakeout.local.v1";
const HEARTBEAT_MS = 5000;
const PHONE_TIMEOUT_MS = 20000;
const CAMERA_TIMEOUT_MS = 10000;
const MOTION_COOLDOWN_MS = 30000;

const initialNames = ["Ari", "Maya", "Dev", "Sam"];
const app = document.querySelector("#app");
const channel = "BroadcastChannel" in window ? new BroadcastChannel("stakeout") : null;
let currentRoute = parseRoute();
let localStream = null;
let renderTimer = null;
let motionState = { lastMagnitude: 0, warningSent: false, permission: "idle" };

const icons = {
  camera: "◉",
  copy: "⧉",
  phone: "▯",
  play: "▶",
  stop: "■",
  check: "✓",
};

function now() {
  return Date.now();
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function roomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function readRooms() {
  const serverRooms = requestRooms("GET");
  if (serverRooms) return serverRooms;
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeRooms(rooms) {
  const savedToServer = requestRooms("PUT", rooms);
  if (!savedToServer) localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  channel?.postMessage({ type: "rooms-changed" });
}

function requestRooms(method, rooms) {
  try {
    const request = new XMLHttpRequest();
    request.open(method, "/api/rooms", false);
    if (method === "PUT") request.setRequestHeader("Content-Type", "application/json");
    request.send(method === "PUT" ? JSON.stringify(rooms) : undefined);
    if (request.status < 200 || request.status >= 300) return null;
    return method === "GET" ? JSON.parse(request.responseText || "{}") : true;
  } catch {
    return null;
  }
}

function withRoom(roomId, updater) {
  const rooms = readRooms();
  const room = rooms[roomId];
  if (!room) return null;
  const nextRoom = updater(structuredClone(room)) || room;
  rooms[roomId] = nextRoom;
  writeRooms(rooms);
  return nextRoom;
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {};
  } catch {
    return {};
  }
}

function getShareOrigin() {
  return localStorage.getItem("stakeout.shareOrigin") || location.origin;
}

function setShareOrigin(value) {
  const normalized = value.trim().replace(/\/$/, "");
  if (normalized) localStorage.setItem("stakeout.shareOrigin", normalized);
}

function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...readLocal(), ...data }));
}

function navigate(path) {
  history.pushState({}, "", path);
  currentRoute = parseRoute();
  render();
}

function parseRoute() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  if (path === "/create") return { name: "create" };
  if (path.startsWith("/room/")) return { name: "room", roomId: path.split("/")[2] };
  if (path.startsWith("/phone/")) return { name: "phone", token: path.split("/")[2] };
  if (path.startsWith("/join/")) return { name: "join", code: path.split("/")[2] };
  if (params.get("join")) return { name: "join", code: params.get("join") };
  return { name: "home" };
}

function setHtml(html) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="/" data-link>
          <span class="brand-mark">S</span>
          <span>The Stakeout</span>
        </a>
        <nav class="nav-actions">
          <a class="button ghost" href="/" data-link>Home</a>
          <a class="button ghost" href="#demo-video">Demo video</a>
          <button class="button ghost" data-demo-room>Load demo</button>
          <button class="button secondary" data-reset-prototype>Reset</button>
          <a class="button secondary" href="/create" data-link>Create room</a>
        </nav>
      </header>
      ${html}
    </div>
  `;
  bindGlobalActions();
}

function bindGlobalActions() {
  document.querySelectorAll("[data-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(link.getAttribute("href"));
    });
  });
  document.querySelector("[data-demo-room]")?.addEventListener("click", () => {
    const room = createRoom({
      hostName: "Niya",
      roomName: "Bio midterm bunker",
      durationMinutes: 25,
      stakesText: "Lowest score buys coffee tomorrow",
      breakMode: "pomodoro_25_5",
    });
    const rooms = readRooms();
    rooms[room.id].players[0].ready = true;
    rooms[room.id].players[0].cameraStatus = "connected";
    rooms[room.id].players[0].phoneStatus = "connected";
    rooms[room.id].players[0].lastPhoneHeartbeatAt = now();
    rooms[room.id].players.push(
      makePlayer("Maya", false, "connected", "connected", true),
      makePlayer("Dev", false, "connected", "connected", true),
    );
    rooms[room.id].players.forEach((player) => {
      player.lastPhoneHeartbeatAt = now();
    });
    rooms[room.id].events.push({
      id: uid("event"),
      playerId: rooms[room.id].players[1].id,
      delta: -50,
      reason: "phone_motion",
      description: "Maya bumped the phone during focus time",
      createdAt: now() - 80000,
    });
    rooms[room.id].players[1].score -= 50;
    writeRooms(rooms);
    navigate(`/room/${room.id}`);
  });
  document.querySelector("[data-reset-prototype]")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LOCAL_KEY);
    navigate("/");
  });
}

function createRoom({ hostName, roomName, durationMinutes, stakesText, breakMode }) {
  const id = uid("room");
  const host = makePlayer(hostName, true, "unknown", "unpaired", false);
  const pairingToken = uid("pair");
  host.pairingToken = pairingToken;
  const room = {
    id,
    code: roomCode(),
    hostUserId: host.id,
    name: roomName || "Study stakeout",
    status: "lobby",
    durationMinutes,
    stakesText,
    breakMode,
    focusMinutes: breakMode === "pomodoro_50_10" ? 50 : 25,
    breakMinutes: breakMode === "pomodoro_50_10" ? 10 : 5,
    createdAt: now(),
    maxPlayers: 4,
    players: [host],
    events: [],
    pairingTokens: [{ token: pairingToken, roomId: id, playerId: host.id, createdAt: now(), expiresAt: now() + 86400000, used: false }],
  };
  const rooms = readRooms();
  rooms[id] = room;
  writeRooms(rooms);
  writeLocal({ [id]: host.id });
  return room;
}

function makePlayer(displayName, isHost, cameraStatus, phoneStatus, ready) {
  return {
    id: uid("player"),
    displayName,
    score: 1000,
    isHost,
    joinedAt: now(),
    ready,
    cameraStatus,
    phoneStatus,
    lastPhoneHeartbeatAt: undefined,
    lastMotionPenaltyAt: undefined,
    lastDisconnectPenaltyAt: undefined,
    lastCameraPenaltyAt: undefined,
  };
}

function addEvent(room, playerId, delta, reason, description) {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) return;
  player.score += delta;
  room.events.unshift({ id: uid("event"), roomId: room.id, playerId, delta, reason, description, createdAt: now() });
}

function render() {
  clearInterval(renderTimer);
  currentRoute = parseRoute();
  if (currentRoute.name === "create") return renderCreate();
  if (currentRoute.name === "room") return renderRoom(currentRoute.roomId);
  if (currentRoute.name === "phone") return renderPhone(currentRoute.token);
  if (currentRoute.name === "join") return renderJoin(currentRoute.code);
  renderHome();
}

function renderHome() {
  setHtml(`
    <main class="page">
      <section class="hero">
        <div class="hero-copy">
          <div class="eyebrow">Lock in or lose out.</div>
          <h1><span>The</span> Stakeout</h1>
          <p class="lede">Compete with your friends to actually study. Set your stakes, pair your phone, and let the scoreboard call out every distraction.</p>
          <form class="join-box" data-join-form>
            <input name="code" maxlength="16" placeholder="Enter room code" aria-label="Room code" />
            <button class="button primary" type="submit">Join</button>
          </form>
          <div class="button-row">
            <a class="button primary" href="/create" data-link>Create Room</a>
            <a class="button secondary" href="#demo-video">Watch demo video</a>
          </div>
        </div>
        <div class="hero-visual" aria-label="Live focus competition preview">
          <div class="orbit-card orbit-card-a">
            <span class="glass-icon">1000</span>
            <strong>Start locked</strong>
            <p>Everyone enters with the same score.</p>
          </div>
          <div class="orbit-card orbit-card-b">
            <span class="glass-icon">-100</span>
            <strong>Phone pickup</strong>
            <p>Motion hits the feed instantly.</p>
          </div>
          <div class="orbit-card orbit-card-c">
            <span class="glass-icon">+50</span>
            <strong>Clean finish</strong>
            <p>No penalties, bonus points.</p>
          </div>
          <div class="score-float">
            <div class="ticker">
              <span>FOCUS ROOM</span>
              <span>PHONE DOWN</span>
              <span>CAMERA ON</span>
              <span>STAKES SET</span>
            </div>
            <div class="mini-score">
              <span>Maya stayed locked in</span>
              <strong>1050</strong>
              <div class="score-bar"><span style="width: 92%"></span></div>
              <span class="tag good">Clean bonus</span>
            </div>
            <div class="mini-score">
              <span>Dev picked up phone</span>
              <strong>900</strong>
              <div class="score-bar"><span style="width: 78%"></span></div>
              <span class="tag bad">-100</span>
            </div>
          </div>
        </div>
      </section>
      <section class="section-grid">
        <article class="card"><h3>1. Set your stakes</h3><p class="muted small">Keep it informal: coffee, boba, chores, or a group selfie penalty.</p></article>
        <article class="card"><h3>2. Pair your phone</h3><p class="muted small">Open the companion page and leave the phone face down and still.</p></article>
        <article class="card"><h3>3. Stay visible</h3><p class="muted small">Cameras, scores, and event history stay live until the timer ends.</p></article>
      </section>
      <section class="demo-video-panel" id="demo-video">
        <div>
          <div class="eyebrow">Demo video</div>
          <h2>See the room in motion.</h2>
        </div>
        <a class="button primary" href="#demo-video">Video slot ready</a>
      </section>
    </main>
  `);
  document.querySelector("[data-join-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code")?.toString().trim().toUpperCase();
    if (code) navigate(`/join/${code}`);
  });
}

function renderCreate() {
  setHtml(`
    <main class="page">
      <section class="panel">
        <div class="eyebrow">New private room</div>
        <h2>Set your stakes before the phones go down.</h2>
        <form class="form" data-create-form>
          <div class="field">
            <label for="hostName">Display name</label>
            <input id="hostName" name="hostName" required placeholder="Niya" />
          </div>
          <div class="field">
            <label for="roomName">Room name</label>
            <input id="roomName" name="roomName" placeholder="Chem final lock-in" />
          </div>
          <div class="field">
            <span>Session duration</span>
            <div class="segmented" data-duration>
              ${[25, 50, 90, 120, 240].map((value) => `<button class="segment ${value === 50 ? "active" : ""}" type="button" data-minutes="${value}">${value < 60 ? `${value} min` : `${value / 60} hr`}</button>`).join("")}
            </div>
            <input name="durationMinutes" type="hidden" value="50" />
          </div>
          <div class="field">
            <label for="breakMode">Break setting</label>
            <select id="breakMode" name="breakMode">
              <option value="none">No scheduled breaks</option>
              <option value="pomodoro_25_5">Pomodoro, 25 focus / 5 break</option>
              <option value="pomodoro_50_10">Long Pomodoro, 50 focus / 10 break</option>
            </select>
          </div>
          <div class="field">
            <label for="stakesText">Set your stakes</label>
            <textarea id="stakesText" name="stakesText" required placeholder="Loser buys coffee tomorrow"></textarea>
          </div>
          <button class="button primary" type="submit">Create room</button>
        </form>
      </section>
    </main>
  `);
  const durationInput = document.querySelector("[name='durationMinutes']");
  document.querySelectorAll("[data-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-minutes]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      durationInput.value = button.dataset.minutes;
    });
  });
  document.querySelector("[data-create-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const room = createRoom({
      hostName: data.hostName.toString().trim(),
      roomName: data.roomName.toString().trim(),
      durationMinutes: Number(data.durationMinutes),
      stakesText: data.stakesText.toString().trim(),
      breakMode: data.breakMode,
    });
    navigate(`/room/${room.id}`);
  });
}

function renderJoin(code) {
  const room = Object.values(readRooms()).find((item) => item.code === code || item.id === code);
  if (!room) {
    setHtml(`<main class="page"><section class="panel"><h2>Room not found</h2><p class="muted">Check the code or ask the host for a fresh invite link.</p></section></main>`);
    return;
  }
  setHtml(`
    <main class="page">
      <section class="panel">
        <div class="eyebrow">Join ${escapeHtml(room.name)}</div>
        <h2>Pick a display name.</h2>
        <form class="form" data-join-room>
          <div class="field"><label for="displayName">Display name</label><input id="displayName" name="displayName" required placeholder="${initialNames[room.players.length] || "Friend"}" /></div>
          <button class="button primary" type="submit">Enter lobby</button>
        </form>
      </section>
    </main>
  `);
  document.querySelector("[data-join-room]").addEventListener("submit", (event) => {
    event.preventDefault();
    const displayName = new FormData(event.currentTarget).get("displayName").toString().trim();
    const updated = withRoom(room.id, (draft) => {
      if (draft.players.length >= draft.maxPlayers) return draft;
      const player = makePlayer(displayName, false, "unknown", "unpaired", false);
      player.pairingToken = uid("pair");
      draft.players.push(player);
      draft.pairingTokens.push({ token: player.pairingToken, roomId: draft.id, playerId: player.id, createdAt: now(), expiresAt: now() + 86400000, used: false });
      writeLocal({ [draft.id]: player.id });
      return draft;
    });
    navigate(`/room/${updated.id}`);
  });
}

function renderRoom(roomId) {
  applyBackgroundChecks(roomId);
  const room = readRooms()[roomId];
  if (!room) {
    setHtml(`<main class="page"><section class="panel"><h2>Room not found</h2><p class="muted">Create a new room or use a valid invite link.</p></section></main>`);
    return;
  }
  if (room.status === "active" || room.status === "break") return renderSession(room);
  if (room.status === "ended") return renderEnd(room);

  const localPlayer = getLocalPlayer(room);
  const shareOrigin = getShareOrigin();
  const inviteUrl = `${shareOrigin}/join/${room.code}`;
  const phoneUrl = localPlayer ? `${shareOrigin}/phone/${localPlayer.pairingToken}` : "";
  setHtml(`
    <main class="page">
      <section class="room-layout">
        <div class="panel">
          <div class="inline-row" style="justify-content: space-between">
            <div>
              <div class="eyebrow">Lobby</div>
              <h2>${escapeHtml(room.name)}</h2>
            </div>
            <span class="status-pill neutral">${room.players.length}/${room.maxPlayers} players</span>
          </div>
          <div class="player-list">
            ${room.players.map((player) => playerRow(player)).join("")}
          </div>
          <div class="rules">
            <label class="check-row"><input type="checkbox" data-ready-check ${localPlayer?.ready ? "checked" : ""} /> <span>I accept the duration, stakes, camera requirement, phone pairing, and penalty rules.</span></label>
            <div class="button-row">
              <a class="button secondary" href="/" data-link>Back home</a>
              <button class="button secondary" data-camera>${icons.camera} Connect camera</button>
              <button class="button primary" data-ready>${localPlayer?.ready ? "Unready" : "Ready"}</button>
              <button class="button primary" data-start ${canStart(room, localPlayer) ? "" : "disabled"}>${icons.play} Start session</button>
            </div>
          </div>
        </div>
        <aside class="panel">
          <h3>Room code</h3>
          <div class="copy-code"><span>${room.code}</span><button class="icon-button" title="Copy invite link" data-copy="${inviteUrl}">${icons.copy}</button></div>
          <div class="card" style="margin-top: 14px"><h3>Set your stakes</h3><p class="muted">${escapeHtml(room.stakesText)}</p></div>
          <div class="card" style="margin-top: 14px"><h3>Duration</h3><p class="muted">${room.durationMinutes} minutes · ${breakLabel(room.breakMode)}</p></div>
          <h3 style="margin-top: 16px">Phone pairing</h3>
          <div class="qr"><span>${icons.phone} Scan/open link</span></div>
          <p class="small muted">Open this on your phone: <br /><a href="${phoneUrl}">${phoneUrl}</a></p>
          <div class="field" style="margin-top: 14px">
            <label for="shareOrigin">Phone URL base</label>
            <input id="shareOrigin" data-share-origin value="${escapeHtml(shareOrigin)}" placeholder="http://192.168.1.25:5173" />
            <div class="button-row">
              <button class="button secondary" data-apply-share-origin>Apply phone URL</button>
              <button class="button ghost" data-use-current-origin>Use current page</button>
            </div>
            <p class="small muted">Use the LAN URL printed by the dev server if your phone cannot open localhost.</p>
          </div>
        </aside>
      </section>
    </main>
  `);
  bindRoomActions(room, localPlayer);
  renderTimer = setInterval(render, 2000);
}

function bindRoomActions(room, localPlayer) {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard?.writeText(button.dataset.copy);
      button.textContent = icons.check;
    });
  });
  const shareOriginInput = document.querySelector("[data-share-origin]");
  shareOriginInput?.addEventListener("input", (event) => {
    setShareOrigin(event.currentTarget.value);
  });
  document.querySelector("[data-apply-share-origin]")?.addEventListener("click", () => {
    if (shareOriginInput) setShareOrigin(shareOriginInput.value);
    render();
  });
  document.querySelector("[data-use-current-origin]")?.addEventListener("click", () => {
    setShareOrigin(location.origin);
    render();
  });
  document.querySelector("[data-ready]")?.addEventListener("click", () => toggleReady(room.id, localPlayer?.id));
  document.querySelector("[data-ready-check]")?.addEventListener("change", () => toggleReady(room.id, localPlayer?.id));
  document.querySelector("[data-camera]")?.addEventListener("click", () => connectCamera(room.id, localPlayer?.id));
  document.querySelector("[data-start]")?.addEventListener("click", () => {
    withRoom(room.id, (draft) => {
      draft.status = "active";
      draft.startedAt = now();
      draft.endsAt = draft.startedAt + draft.durationMinutes * 60000;
      draft.phaseStartedAt = draft.startedAt;
      draft.phase = "focus";
      draft.events.unshift({ id: uid("event"), roomId: draft.id, playerId: draft.hostUserId, delta: 0, reason: "session_started", description: "The stakeout started", createdAt: now() });
      return draft;
    });
    render();
  });
}

function toggleReady(roomId, playerId) {
  if (!playerId) return;
  withRoom(roomId, (draft) => {
    const player = draft.players.find((item) => item.id === playerId);
    if (player) player.ready = !player.ready;
    return draft;
  });
  render();
}

async function connectCamera(roomId, playerId) {
  if (!playerId) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    withRoom(roomId, (draft) => {
      const player = draft.players.find((item) => item.id === playerId);
      if (player) player.cameraStatus = "connected";
      return draft;
    });
  } catch {
    withRoom(roomId, (draft) => {
      const player = draft.players.find((item) => item.id === playerId);
      if (player) player.cameraStatus = "error";
      return draft;
    });
  }
  render();
}

function renderSession(room) {
  applyBackgroundChecks(room.id);
  const fresh = readRooms()[room.id];
  const remaining = Math.max(0, fresh.endsAt - now());
  const phase = getPhase(fresh);
  if (remaining <= 0) {
    endRoom(fresh.id);
    return render();
  }
  const localPlayer = getLocalPlayer(fresh);
  setHtml(`
    <main class="page">
      <section class="session-layout">
        <div>
          <div class="timer-panel">
            <div>
              <div class="eyebrow" style="color: #91d8ca">${phase.isBreak ? "Break" : "Focus"}</div>
              <div class="timer-value">${formatMs(remaining)}</div>
            </div>
            <div class="button-row">
              <a class="button secondary" href="/" data-link>Back home</a>
              <button class="button secondary" data-leave>Leave</button>
              <button class="button danger" data-end ${localPlayer?.isHost ? "" : "disabled"}>${icons.stop} End</button>
            </div>
          </div>
          <div class="panel" style="margin-top: 14px">
            <div class="inline-row" style="justify-content: space-between">
              <h3>Video room</h3>
              <span class="status-pill ${localPlayer?.phoneStatus === "connected" ? "good" : "warn"}">${icons.phone} ${localPlayer?.phoneStatus || "unknown"}</span>
            </div>
            <div class="video-grid">
              ${fresh.players.map((player) => videoTile(player, localPlayer?.id === player.id)).join("")}
            </div>
          </div>
        </div>
        <aside class="panel">
          <h3>Scoreboard</h3>
          <div class="scoreboard">
            ${fresh.players.slice().sort((a, b) => b.score - a.score).map((player) => scoreRow(player)).join("")}
          </div>
          <div class="card" style="margin-top: 16px"><h3>Stakes</h3><p class="muted">${escapeHtml(fresh.stakesText)}</p></div>
          <h3 style="margin-top: 16px">Event feed</h3>
          <div class="event-feed">${eventRows(fresh)}</div>
        </aside>
      </section>
    </main>
  `);
  attachLocalVideo();
  document.querySelector("[data-end]")?.addEventListener("click", () => {
    endRoom(fresh.id);
    render();
  });
  document.querySelector("[data-leave]")?.addEventListener("click", () => {
    leaveSession(fresh.id, localPlayer?.id);
    navigate("/");
  });
  renderTimer = setInterval(render, 1000);
}

function renderEnd(room) {
  const ranked = room.players.slice().sort((a, b) => b.score - a.score);
  const lowScore = Math.min(...room.players.map((player) => player.score));
  const losers = room.players.filter((player) => player.score === lowScore);
  setHtml(`
    <main class="page">
      <section class="end-layout">
        <div class="panel">
          <div class="eyebrow">Final rankings</div>
          <h2>${losers.map((player) => escapeHtml(player.displayName)).join(" + ")} ${losers.length > 1 ? "take" : "takes"} the stakes.</h2>
          <div class="rank-list">
            ${ranked.map((player, index) => `<div class="rank-row"><span class="avatar">${index + 1}</span><div><strong>${escapeHtml(player.displayName)}</strong><p class="small muted">${penaltyCount(room, player.id)} score events</p></div><strong>${player.score}</strong></div>`).join("")}
          </div>
          <div class="button-row" style="margin-top: 16px">
            <a class="button secondary" href="/" data-link>Back home</a>
            <a class="button primary" href="/create" data-link>Start new room</a>
            <button class="button secondary" data-rematch>Same group rematch</button>
          </div>
        </div>
        <aside class="panel">
          <h3>Stakes summary</h3>
          <p class="lede" style="font-size: 1.2rem">${escapeHtml(room.stakesText)}</p>
          <h3 style="margin-top: 18px">Penalty history</h3>
          <div class="event-feed">${eventRows(room, true)}</div>
        </aside>
      </section>
    </main>
  `);
  document.querySelector("[data-rematch]")?.addEventListener("click", () => {
    const newRoom = createRoom({
      hostName: room.players[0]?.displayName || "Host",
      roomName: room.name,
      durationMinutes: room.durationMinutes,
      stakesText: room.stakesText,
      breakMode: room.breakMode,
    });
    navigate(`/room/${newRoom.id}`);
  });
}

function renderPhone(token) {
  const match = findPairing(token);
  if (!match) {
    setHtml(`
      <main class="page phone-page">
        <section class="panel phone-card">
          <div class="eyebrow">Phone pairing</div>
          <h2>Pairing link not connected.</h2>
          <p class="muted">Open the laptop app through the same server, create or load a room, then use the phone link from that lobby. The phone cannot use a localhost link from the laptop.</p>
          <div class="button-row" style="margin-top: 18px">
            <a class="button secondary" href="/" data-link>Open app home</a>
          </div>
        </section>
      </main>
    `);
    return;
  }
  const { room, player } = match;
  sendHeartbeat(room.id, player.id);
  setHtml(`
    <main class="page phone-page">
      <section class="panel phone-card">
        <div class="eyebrow">${escapeHtml(room.name)}</div>
        <h2>Keep this page open and place your phone down.</h2>
        <p class="muted">Paired as ${escapeHtml(player.displayName)}. Locking the phone or closing this tab may count as a disconnect.</p>
        <div class="phone-gauge">
          <div>
            <strong>${Math.round(motionState.lastMagnitude)}</strong>
            <p class="small">movement score</p>
          </div>
        </div>
        <div class="card">
          <h3>Connection</h3>
          <p class="muted small">Heartbeat active. Your laptop lobby should show Phone connected for ${escapeHtml(player.displayName)} within a few seconds.</p>
        </div>
        <div class="button-row">
          <button class="button primary" data-motion>Allow motion detection</button>
          <button class="button secondary" data-test-motion>Test pickup penalty</button>
        </div>
        <p class="small muted" style="margin-top: 14px">Status: ${motionState.permission}. Heartbeat sends every 5 seconds.</p>
      </section>
    </main>
  `);
  document.querySelector("[data-motion]")?.addEventListener("click", () => requestMotion(room.id, player.id));
  document.querySelector("[data-test-motion]")?.addEventListener("click", () => reportMotion(room.id, player.id, 24, true));
  renderTimer = setInterval(() => {
    sendHeartbeat(room.id, player.id);
  }, HEARTBEAT_MS);
}

function findPairing(token) {
  for (const room of Object.values(readRooms())) {
    const pairing = room.pairingTokens.find((item) => item.token === token && item.expiresAt > now());
    if (pairing) {
      const player = room.players.find((item) => item.id === pairing.playerId);
      if (player) return { room, player, pairing };
    }
  }
  return null;
}

function sendHeartbeat(roomId, playerId) {
  withRoom(roomId, (draft) => {
    const player = draft.players.find((item) => item.id === playerId);
    if (player) {
      player.phoneStatus = "connected";
      player.lastPhoneHeartbeatAt = now();
    }
    return draft;
  });
}

async function requestMotion(roomId, playerId) {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const result = await DeviceMotionEvent.requestPermission();
      if (result !== "granted") throw new Error("Motion permission denied");
    }
    motionState.permission = "tracking";
    window.addEventListener("devicemotion", (event) => {
      const acc = event.accelerationIncludingGravity || event.acceleration || {};
      const magnitude = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
      motionState.lastMagnitude = magnitude;
      if (magnitude > 18) reportMotion(roomId, playerId, magnitude, true);
      else if (magnitude > 11) reportMotion(roomId, playerId, magnitude, false);
    });
  } catch {
    motionState.permission = "blocked";
  }
  render();
}

function reportMotion(roomId, playerId, magnitude, strong) {
  withRoom(roomId, (draft) => {
    const phase = getPhase(draft);
    const player = draft.players.find((item) => item.id === playerId);
    if (!player || phase.isBreak) return draft;
    if (!strong && !motionState.warningSent) {
      motionState.warningSent = true;
      draft.events.unshift({ id: uid("event"), roomId, playerId, delta: 0, reason: "motion_warning", description: `${player.displayName} got one small movement warning`, createdAt: now() });
      return draft;
    }
    if (player.lastMotionPenaltyAt && now() - player.lastMotionPenaltyAt < MOTION_COOLDOWN_MS) return draft;
    player.lastMotionPenaltyAt = now();
    addEvent(draft, playerId, strong ? -100 : -50, strong ? "phone_pickup" : "phone_motion", `${player.displayName} ${strong ? "picked up or strongly moved" : "moved"} their phone (${Math.round(magnitude)})`);
    return draft;
  });
}

function applyBackgroundChecks(roomId) {
  withRoom(roomId, (draft) => {
    if (draft.status !== "active" && draft.status !== "break") return draft;
    const phase = getPhase(draft);
    draft.status = phase.isBreak ? "break" : "active";
    for (const player of draft.players) {
      if (player.lastPhoneHeartbeatAt && now() - player.lastPhoneHeartbeatAt > PHONE_TIMEOUT_MS) {
        if (player.phoneStatus !== "disconnected") player.phoneStatus = "disconnected";
        if (!player.lastDisconnectPenaltyAt || now() - player.lastDisconnectPenaltyAt > PHONE_TIMEOUT_MS * 2) {
          player.lastDisconnectPenaltyAt = now();
          addEvent(draft, player.id, -100, "phone_disconnect", `${player.displayName}'s phone heartbeat was lost for more than 20 seconds`);
        }
      }
      if (!phase.isBreak && player.cameraStatus !== "connected") {
        if (!player.cameraOffSince) player.cameraOffSince = now();
        if (now() - player.cameraOffSince > CAMERA_TIMEOUT_MS && (!player.lastCameraPenaltyAt || now() - player.lastCameraPenaltyAt > 60000)) {
          player.lastCameraPenaltyAt = now();
          addEvent(draft, player.id, -100, "camera_off", `${player.displayName}'s camera was off for more than 10 seconds`);
        }
      } else {
        player.cameraOffSince = undefined;
      }
    }
    return draft;
  });
}

function endRoom(roomId) {
  withRoom(roomId, (draft) => {
    if (draft.status === "ended") return draft;
    draft.status = "ended";
    draft.endedAt = now();
    for (const player of draft.players) {
      const hadPenalty = draft.events.some((event) => event.playerId === player.id && event.delta < 0);
      if (!hadPenalty) addEvent(draft, player.id, 50, "clean_finish_bonus", `${player.displayName} finished clean and earned the bonus`);
    }
    return draft;
  });
}

function leaveSession(roomId, playerId) {
  if (!playerId) return;
  withRoom(roomId, (draft) => {
    const player = draft.players.find((item) => item.id === playerId);
    if (!player) return draft;
    addEvent(draft, playerId, -250, "left_session", `${player.displayName} left the session before the timer ended`);
    player.ready = false;
    player.cameraStatus = "off";
    player.phoneStatus = "disconnected";
    return draft;
  });
}

function canStart(room, localPlayer) {
  return Boolean(
    localPlayer?.isHost &&
      room.players.length >= 2 &&
      room.players.every((player) => player.ready && player.phoneStatus === "connected" && player.cameraStatus === "connected"),
  );
}

function getLocalPlayer(room) {
  const local = readLocal();
  const playerId = local[room.id] || room.players[0]?.id;
  return room.players.find((player) => player.id === playerId);
}

function getPhase(room) {
  if (!room.startedAt || room.breakMode === "none") return { isBreak: false };
  const focus = (room.focusMinutes || 25) * 60000;
  const rest = (room.breakMinutes || 5) * 60000;
  const cycle = focus + rest;
  const elapsed = now() - room.startedAt;
  const inCycle = elapsed % cycle;
  return { isBreak: inCycle >= focus, phaseRemaining: inCycle >= focus ? cycle - inCycle : focus - inCycle };
}

function playerRow(player) {
  return `
    <div class="player-row">
      <span class="avatar">${initials(player.displayName)}</span>
      <div>
        <strong>${escapeHtml(player.displayName)}${player.isHost ? " · Host" : ""}</strong>
        <p class="small muted">Joined ${timeAgo(player.joinedAt)}</p>
      </div>
      <div class="inline-row" style="justify-content: end">
        ${pill(player.cameraStatus === "connected" ? "Camera" : "Camera", player.cameraStatus === "connected" ? "good" : player.cameraStatus === "error" ? "bad" : "warn")}
        ${pill(player.phoneStatus === "connected" ? "Phone" : "Phone", player.phoneStatus === "connected" ? "good" : player.phoneStatus === "disconnected" ? "bad" : "warn")}
        ${pill(player.ready ? "Ready" : "Not ready", player.ready ? "good" : "neutral")}
      </div>
    </div>
  `;
}

function scoreRow(player) {
  const width = Math.max(8, Math.min(100, (player.score / 1050) * 100));
  return `<div class="score-row"><div class="score-line"><strong>${escapeHtml(player.displayName)}</strong><strong>${player.score}</strong></div><div class="score-bar"><span style="width:${width}%"></span></div></div>`;
}

function videoTile(player, isLocal) {
  return `
    <div class="video-tile">
      ${isLocal && localStream ? `<video data-local-video autoplay muted playsinline></video>` : `<div class="video-placeholder"><div><span class="avatar">${initials(player.displayName)}</span><p>${player.cameraStatus === "connected" ? "Camera connected" : "Camera off"}</p></div></div>`}
      <span class="video-label">${escapeHtml(player.displayName)}</span>
    </div>
  `;
}

function attachLocalVideo() {
  const video = document.querySelector("[data-local-video]");
  if (video && localStream) video.srcObject = localStream;
}

function eventRows(room, includeAll = false) {
  const events = includeAll ? room.events : room.events.slice(0, 8);
  if (!events.length) return `<div class="empty">No score events yet.</div>`;
  return events.map((event) => {
    const player = room.players.find((item) => item.id === event.playerId);
    const tone = event.delta < 0 ? "bad" : event.delta > 0 ? "good" : "neutral";
    return `<div class="event-row"><span class="tag ${tone}">${event.delta > 0 ? "+" : ""}${event.delta}</span><div><strong>${escapeHtml(player?.displayName || "Room")}</strong><p class="small muted">${escapeHtml(event.description)}</p></div><span class="small muted">${timeAgo(event.createdAt)}</span></div>`;
  }).join("");
}

function pill(text, tone) {
  return `<span class="status-pill ${tone}">${escapeHtml(text)}</span>`;
}

function breakLabel(mode) {
  if (mode === "pomodoro_25_5") return "25/5 Pomodoro";
  if (mode === "pomodoro_50_10") return "50/10 Long Pomodoro";
  return "No scheduled breaks";
}

function formatMs(ms) {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function timeAgo(timestamp) {
  const seconds = Math.max(1, Math.round((now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function penaltyCount(room, playerId) {
  return room.events.filter((event) => event.playerId === playerId && event.delta !== 0).length;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("popstate", render);
window.addEventListener("storage", render);
channel?.addEventListener("message", render);
render();
