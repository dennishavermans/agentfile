import { build } from "esbuild";
import { cpSync } from "fs";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  target: "node20",
});

// Copy media folder for icon/asset references
try {
  cpSync("media", "dist/media", { recursive: true, force: true });
  console.log("✓ media/ copied to dist/media/");
} catch (err) {
  console.warn("Warning: Could not copy media folder", err.message);
}
