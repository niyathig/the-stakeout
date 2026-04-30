const store = globalThis.__stakeoutRoomsStore || { rooms: {} };
globalThis.__stakeoutRoomsStore = store;

module.exports = async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      sendJson(res, 200, store.rooms);
      return;
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      store.rooms = body && typeof body === "object" && !Array.isArray(body) ? body : {};
      sendJson(res, 200, { ok: true });
      return;
    }

    res.setHeader("Allow", "GET, PUT");
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: "Room API failed", detail: error.message });
  }
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
