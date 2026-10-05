// Serve the production Angular build locally, proxying API calls to Spring Boot.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(
  new URL("../frontend/dist/vv/browser/", import.meta.url),
);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
http
  .createServer(async (req, res) => {
    if (req.url?.startsWith("/api/")) {
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: 8080,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: "127.0.0.1:8080" },
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent)
          res.writeHead(502, { "Content-Type": "application/json" });
        res.end('{"error":"Backend unavailable"}');
      });
      req.pipe(upstream);
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      let path = resolve(root, "." + pathname);
      if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!(await stat(path).catch(() => null))?.isFile())
        path = resolve(root, "index.html");
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(await readFile(path));
    } catch {
      res.writeHead(500);
      res.end("Build frontend first.");
    }
  })
  .listen(4200, "127.0.0.1", () =>
    console.log("VV running at http://127.0.0.1:4200"),
  );
