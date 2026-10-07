// Packs what goes to npm: the bundle, LICENSE, NOTICE and README, with a package.json that has no
// devDependencies or scripts. The bundle holds @forecall/lint, so the package depends on nothing.
//
//   node pack.ts <directory>   prints the path of the tarball made in <directory>
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.ts";

/**
 * The fields of packages/cli/package.json that npm users see. Everything else stays here. npm
 * checks the provenance against `repository`, so it must name this repository.
 */
const PUBLISHED_FIELDS = [
  "name",
  "version",
  "description",
  "keywords",
  "homepage",
  "repository",
  "bugs",
  "license",
  "type",
  "bin",
  "files",
  "engines",
];

export function publishedManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    PUBLISHED_FIELDS.filter((field) => field in manifest).map((field) => [field, manifest[field]]),
  );
}

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Lays out the package in a new directory and returns it. */
export async function stage(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forecall-package-"));
  await build(join(dir, "dist"));
  for (const file of ["LICENSE", "NOTICE", "README.md"]) {
    await copyFile(here(file), join(dir, file));
  }
  const manifest = JSON.parse(await readFile(here("package.json"), "utf8"));
  await writeFile(
    join(dir, "package.json"),
    `${JSON.stringify(publishedManifest(manifest), null, 2)}\n`,
  );
  return dir;
}

/** Runs `npm pack` on the staged package and returns the tarball's path. */
export async function pack(destination: string): Promise<string> {
  await mkdir(destination, { recursive: true });
  const output = execFileSync(
    "npm",
    ["pack", await stage(), "--pack-destination", destination, "--json"],
    {
      encoding: "utf8",
    },
  );
  const [{ filename }] = JSON.parse(output) as [{ filename: string }];
  return join(destination, filename);
}

if (import.meta.main) {
  const destination = process.argv[2];
  if (destination === undefined) throw new Error("usage: node pack.ts <directory>");
  console.log(await pack(resolve(destination)));
}
