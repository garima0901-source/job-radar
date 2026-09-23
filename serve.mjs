// Local preview: node serve.mjs → http://localhost:8123
import { fileURLToPath } from "node:url";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "docs"), types = { ".html": "text/html", ".json": "application/json" };
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
}).listen(8123);
