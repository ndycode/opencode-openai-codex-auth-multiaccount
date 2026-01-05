import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "..", "lib", "oauth-success.html");
const destDir = join(__dirname, "..", "dist", "lib");
const dest = join(destDir, "oauth-success.html");

await fs.mkdir(destDir, { recursive: true });
await fs.copyFile(src, dest);
