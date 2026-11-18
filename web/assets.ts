import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

export function serveAssets(directory?: string): (request: Request) => Response {
  const files = new Map<string, string>();
  if (directory) {
    const root = realpathSync(directory);
    index(root, "/");
  }

  function index(location: string, prefix: string): void {
    for (const entry of readdirSync(location, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const file = join(location, entry.name);
      const url = prefix + encodeURIComponent(entry.name);
      if (entry.isDirectory()) index(file, url + "/");
      if (entry.isFile()) {
        files.set(url, file);
        if (entry.name === "index.html") files.set(prefix, file);
      }
    }
  }

  return request => {
    const pathname = new URL(request.url).pathname;
    const file = files.get(pathname);
    if (!file || !["GET", "HEAD"].includes(request.method)) return new Response("Not Found", { status: 404 });
    try {
      if (realpathSync(file) === file && lstatSync(file).isFile()) {
        const asset = Bun.file(file);
        return new Response(request.method === "HEAD" ? null : asset, {
          headers: { "Content-Type": asset.type },
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return new Response("Not Found", { status: 404 });
  };
}
