import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Main process + preload: CommonJS, node platform, electron + node builtins external. */
await esbuild.build({
  entryPoints: [resolve(root, "src/main/main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: resolve(root, "dist/main/main.js"),
  external: ["electron", "node:*"],
  sourcemap: true,
  logLevel: "warning",
});

await esbuild.build({
  entryPoints: [resolve(root, "src/main/preload.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: resolve(root, "dist/main/preload.js"),
  external: ["electron"],
  sourcemap: true,
  logLevel: "warning",
});

/** Renderer: browser bundle. */
await esbuild.build({
  entryPoints: [resolve(root, "src/ui/index.tsx")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  outfile: resolve(root, "dist/ui/index.js"),
  sourcemap: true,
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
});

mkdirSync(resolve(root, "dist/ui"), { recursive: true });
cpSync(resolve(root, "src/ui/index.html"), resolve(root, "dist/ui/index.html"));
cpSync(resolve(root, "src/ui/styles.css"), resolve(root, "dist/ui/styles.css"));

console.log("build ok");
