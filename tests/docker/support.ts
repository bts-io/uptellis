/** A Docker platform over a fresh SQLite file in a temp dir, with the repo's migrations and a settable clock. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDockerPlatform, type DockerPlatform } from "@/platform/docker";
import type { EnvSource } from "@/platform/docker/env";

export const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

export interface TempPlatform {
  platform: DockerPlatform;
  dir: string;
  file: string;
  clock: { now: number };
  /** Closes and opens the same file again (a container restart). */
  reopen(): DockerPlatform;
  dispose(): void;
}

export function tempPlatform(env: EnvSource = {}, start = Date.parse("2026-09-28T01:00:00Z")): TempPlatform {
  const dir = mkdtempSync(join(tmpdir(), "uptellis-docker-"));
  const file = join(dir, "uptellis.db");
  const clock = { now: start };
  const open = () =>
    createDockerPlatform({ databasePath: file, migrationsFolder: MIGRATIONS, env, now: () => clock.now });
  const t: TempPlatform = {
    platform: open(),
    dir,
    file,
    clock,
    reopen() {
      t.platform.close();
      t.platform = open();
      return t.platform;
    },
    dispose() {
      t.platform.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return t;
}
