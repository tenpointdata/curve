import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startServer } from "./server.ts";

const HELP = `Curve web

  curve web serve <app.curve> [--host HOST] [--port PORT]
    [--cert CERT.pem --key KEY.pem] [--public DIRECTORY] [--max-body BYTES]
  curve web jsx <component.jsx|component.tsx> -o <component.curve>

Bundle a React HTML entry with curve <index.html> -o <public-directory>.
`;

function integer(value: string, name: string, max: number): number {
  if (!/^\d+$/.test(value) || Number(value) > max) throw new Error("Invalid " + name + ": " + value);
  return Number(value);
}

async function serve(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args, allowPositionals: true, options: {
      host: { type: "string" }, port: { type: "string" }, cert: { type: "string" },
      key: { type: "string" }, public: { type: "string" }, "max-body": { type: "string" },
    },
  });
  if (positionals.length !== 1 || !/\.(?:curve|bend)$/.test(positionals[0])) {
    throw new Error("Provide one Curve web application");
  }
  if (Boolean(values.cert) !== Boolean(values.key)) throw new Error("--cert and --key must be supplied together");
  const module = await import(resolve(positionals[0])) as { default: unknown };
  const server = startServer(module.default, {
    hostname: values.host,
    port: values.port === undefined ? undefined : integer(values.port, "port", 65535),
    publicDirectory: values.public,
    maxBodyBytes: values["max-body"] === undefined ? undefined : integer(values["max-body"], "body limit", 0x7fffffff),
    tls: values.cert && values.key ? { cert: values.cert, key: values.key } : undefined,
    onError: error => console.error(error.message),
  });
  console.log(server.url.href);
  await new Promise<void>(settle => {
    function stop() {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      void server.stop().finally(settle);
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function jsx(args: string[], check: (file: string) => Promise<unknown>): Promise<void> {
  const { positionals, values } = parseArgs({
    args, allowPositionals: true, options: { output: { type: "string", short: "o" } },
  });
  const output = values.output;
  if (positionals.length !== 1 || !/\.(?:jsx|tsx)$/.test(positionals[0]) || !output?.endsWith(".curve")) {
    throw new Error("Provide one JSX or TSX input and a .curve output with -o");
  }
  const input = realpathSync(positionals[0]);
  const destination = resolve(output);
  try {
    if (realpathSync(destination) === input) throw new Error("Output would overwrite the JSX input");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const { compileJsx } = await import("./jsx.ts");
  const generated = await compileJsx(readFileSync(input, "utf8"), positionals[0]);
  const directory = mkdtempSync(join(dirname(destination), ".curve-jsx-"));
  try {
    const pending = join(directory, "generated.curve");
    writeFileSync(pending, generated);
    await check(pending);
    renameSync(pending, destination);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runWeb(args: string[], check: (file: string) => Promise<unknown>): Promise<void> {
  const [command, ...rest] = args;
  switch (command) {
    case undefined:
    case "--help":
      console.log(HELP.trimEnd());
      return;
    case "serve":
      await serve(rest);
      return;
    case "jsx":
      await jsx(rest, check);
      return;
    default:
      throw new Error(HELP.trimEnd());
  }
}
