import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

const root = process.cwd();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
let rooms = {};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/rooms") {
    if (req.method === "GET") {
      sendJson(res, rooms);
      return;
    }
    if (req.method === "PUT") {
      try {
        rooms = await readJson(req);
        sendJson(res, { ok: true });
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
      return;
    }
  }

  if (url.pathname.startsWith("/api/pair/") && req.method === "GET") {
    const token = decodeURIComponent(url.pathname.split("/").at(-1) || "");
    const match = findPairing(token);
    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Pairing token not found" }));
      return;
    }
    sendJson(res, {
      room: publicRoom(match.room),
      player: match.player,
    });
    return;
  }

  if (url.pathname === "/api/phone/heartbeat" && req.method === "POST") {
    const body = await readJson(req);
    const match = findPairing(body.token);
    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Pairing token not found" }));
      return;
    }
    match.player.phoneStatus = "connected";
    match.player.lastPhoneHeartbeatAt = Date.now();
    sendJson(res, { ok: true, room: publicRoom(match.room), player: match.player });
    return;
  }

  if (url.pathname === "/api/phone/motion" && req.method === "POST") {
    const body = await readJson(req);
    const match = findPairing(body.token);
    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Pairing token not found" }));
      return;
    }
    const result = applyMotion(match.room, match.player, Number(body.magnitude || 0), Boolean(body.strong));
    sendJson(res, { ok: true, result, room: publicRoom(match.room), player: match.player });
    return;
  }

  if (url.pathname.startsWith("/phone/")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(phonePage(decodeURIComponent(url.pathname.split("/").at(-1) || "")));
    return;
  }

  const requested = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, requested === "/" ? "index.html" : requested);

  if (!existsSync(filePath) || requested.startsWith("/room/") || requested.startsWith("/phone/") || requested.startsWith("/join/") || requested === "/create") {
    filePath = join(root, "index.html");
  }

  res.setHeader("Content-Type", mime[extname(filePath)] || "application/octet-stream");
  createReadStream(filePath)
    .on("error", () => {
      res.writeHead(404);
      res.end("Not found");
    })
    .pipe(res);
}).listen(port, host, () => {
  console.log(`The Stakeout prototype is running at http://localhost:${port}`);
  for (const address of getLanAddresses()) {
    console.log(`Phone pairing URL base: http://${address}:${port}`);
  }
});

function getLanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

function findPairing(token) {
  for (const room of Object.values(rooms)) {
    const pairing = room.pairingTokens?.find((item) => item.token === token && item.expiresAt > Date.now());
    if (!pairing) continue;
    const player = room.players?.find((item) => item.id === pairing.playerId);
    if (player) return { room, player, pairing };
  }
  return null;
}

function publicRoom(room) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    status: room.status,
    stakesText: room.stakesText,
    durationMinutes: room.durationMinutes,
  };
}

function applyMotion(room, player, magnitude, strong) {
  const activeFocus = room.status === "active";
  if (!activeFocus) return "ignored_not_focus";
  if (player.lastMotionPenaltyAt && Date.now() - player.lastMotionPenaltyAt < 30000) return "ignored_cooldown";
  player.lastMotionPenaltyAt = Date.now();
  const delta = strong ? -100 : -50;
  player.score += delta;
  room.events.unshift({
    id: `event_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`,
    roomId: room.id,
    playerId: player.id,
    delta,
    reason: strong ? "phone_pickup" : "phone_motion",
    description: `${player.displayName} ${strong ? "picked up or strongly moved" : "moved"} their phone (${Math.round(magnitude)})`,
    createdAt: Date.now(),
  });
  return "penalized";
}

function phonePage(token) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>The Stakeout Phone Pairing</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="page phone-page">
      <section class="panel phone-card">
        <div class="eyebrow">Phone pairing</div>
        <h2 id="title">Connecting...</h2>
        <p class="muted" id="subtitle">Keep this page open while your laptop lobby is active.</p>
        <div class="phone-gauge">
          <div>
            <strong id="movement">0</strong>
            <p class="small">movement score</p>
          </div>
        </div>
        <div class="card">
          <h3>Connection</h3>
          <p class="muted small" id="status">Starting heartbeat.</p>
        </div>
        <div class="button-row" style="margin-top: 18px">
          <button class="button primary" id="motion">Allow motion detection</button>
          <button class="button secondary" id="test">Test pickup penalty</button>
        </div>
      </section>
    </main>
    <script>
      const token = ${JSON.stringify(token)};
      const title = document.querySelector("#title");
      const subtitle = document.querySelector("#subtitle");
      const status = document.querySelector("#status");
      const movement = document.querySelector("#movement");
      let warningSent = false;

      async function api(path, body) {
        const options = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
        const response = await fetch(path, options);
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      }

      async function loadPairing() {
        try {
          const data = await api("/api/pair/" + encodeURIComponent(token));
          title.textContent = "Paired as " + data.player.displayName;
          subtitle.textContent = data.room.name + " · keep this page open and place your phone face down and still.";
          await heartbeat();
          setInterval(heartbeat, 5000);
        } catch (error) {
          title.textContent = "Pairing link not connected.";
          subtitle.textContent = "Create a fresh room on the laptop through the Cloudflare URL, then open the phone link from that lobby.";
          status.textContent = error.message;
        }
      }

      async function heartbeat() {
        const data = await api("/api/phone/heartbeat", { token });
        status.textContent = "Heartbeat active. Laptop should show Phone connected for " + data.player.displayName + ".";
      }

      async function reportMotion(score, strong) {
        movement.textContent = Math.round(score);
        const data = await api("/api/phone/motion", { token, magnitude: score, strong });
        status.textContent = data.result === "penalized" ? "Motion sent. Penalty applied during focus time." : "Motion sent: " + data.result + ".";
      }

      async function requestMotion() {
        try {
          if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
            const result = await DeviceMotionEvent.requestPermission();
            if (result !== "granted") throw new Error("Motion permission denied");
          }
          status.textContent = "Motion tracking active.";
          window.addEventListener("devicemotion", (event) => {
            const acc = event.accelerationIncludingGravity || event.acceleration || {};
            const score = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
            movement.textContent = Math.round(score);
            if (score > 18) reportMotion(score, true);
            else if (score > 11 && !warningSent) {
              warningSent = true;
              status.textContent = "Small movement warning detected.";
            }
          });
        } catch (error) {
          status.textContent = error.message;
        }
      }

      document.querySelector("#motion").addEventListener("click", requestMotion);
      document.querySelector("#test").addEventListener("click", () => reportMotion(24, true));
      loadPairing();
    </script>
  </body>
</html>`;
}

function sendJson(res, payload) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
