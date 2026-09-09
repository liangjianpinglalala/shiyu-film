import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
const root = resolve(".pages-build/out");
const base = "/shiyu-film";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain",
};
createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (!pathname.startsWith(base + "/")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    let file = resolve(root, "." + pathname.slice(base.length));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (statSync(file).isDirectory()) file = resolve(file, "index.html");
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
    });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(3200, "127.0.0.1", () =>
  console.log("Pages test server listening on 3200"),
);
