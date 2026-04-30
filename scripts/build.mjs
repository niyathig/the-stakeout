import { cp, mkdir, rm } from "node:fs/promises";

await rm("public", { force: true, recursive: true });
await mkdir("public/src", { recursive: true });

await cp("index.html", "public/index.html");
await cp("styles.css", "public/styles.css");
await cp("src/app.js", "public/src/app.js");
