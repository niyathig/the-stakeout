const store = globalThis.__stakeoutRoomsStore || { rooms: {} };
globalThis.__stakeoutRoomsStore = store;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    res.status(200).json(store.rooms);
    return;
  }

  if (req.method === "PUT") {
    try {
      const body = await readBody(req);
      store.rooms = body && typeof body === "object" ? body : {};
      res.status(200).json({ ok: true });
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
    }
    return;
  }

  res.setHeader("Allow", "GET, PUT");
  res.status(405).json({ error: "Method not allowed" });
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
