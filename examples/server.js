import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

export function startStaticServer({ port, entry, label }) {
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? entry : pathname.slice(1);
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error("Not a file");
      response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  }).listen(port, () => {
    console.log(`${label}: http://localhost:${port}`);
  });
}
