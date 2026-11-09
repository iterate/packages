// examples/bun-box/box-file.ts — `.box.json`, the box's own record: its id and hook secret, where
// server.ts provided its stub, and the projects enrol.ts claimed for it. Parsed on every read.
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

export const BoxFile = z.object({
  deployment: z.string().regex(/^box[0-9a-f]+$/),
  hookSecret: z.string().min(1),
  provided: z.object({ project: z.string(), host: z.url(), at: z.string() }).optional(),
  /** slug → the project id the router routes it to */
  projects: z.record(z.string(), z.string()),
});
export type BoxFile = z.infer<typeof BoxFile>;

export const BOX_FILE = new URL("./.box.json", import.meta.url);
export const readBoxFile = () => BoxFile.parse(JSON.parse(readFileSync(BOX_FILE, "utf8")));
export const writeBoxFile = (box: BoxFile) =>
  writeFileSync(BOX_FILE, JSON.stringify(box, null, 2), { mode: 0o600 });
