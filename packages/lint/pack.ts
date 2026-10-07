// Builds and packs @forecall/lint for npm: dist/ (JavaScript with .js imports and the types, by
// tsconfig.build.json, and the sentence catalogs), LICENSE, NOTICE and README.md, with a
// package.json whose exports point into dist/. The release workflow publishes the tarball.
//
//   node pack.ts <directory>   prints the path of the tarball made in <directory>
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The package's entry points and the module each one is: the public one, then ./internal/*. */
export const ENTRIES = {
  ".": "index",
  "./internal/codes": "codes",
  "./internal/diff": "diff",
  "./internal/lint": "lint",
  "./internal/messages": "messages",
  "./internal/round": "round",
  "./internal/score-tool": "score-tool",
  "./internal/tools-list": "tools-list",
} as const;

/**
 * The fields of package.json that npm users see, with the exports into dist/. npm checks the
 * provenance against `repository`, so it must name this repository.
 */
export function publishedManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const fields = [
    "name",
    "version",
    "description",
    "keywords",
    "homepage",
    "repository",
    "bugs",
    "license",
    "engines",
  ];
  return {
    ...Object.fromEntries(fields.filter((f) => f in manifest).map((f) => [f, manifest[f]])),
    type: "module",
    sideEffects: false,
    exports: Object.fromEntries(
      Object.entries(ENTRIES).map(([path, module]) => [
        path,
        { types: `./dist/${module}.d.ts`, default: `./dist/${module}.js` },
      ]),
    ),
    files: ["dist", "LICENSE", "NOTICE"],
  };
}

/** Writes dist/ into the package directory `dir`. */
async function build(dir: string): Promise<void> {
  const tsc = here("node_modules/.bin/tsc");
  execFileSync(tsc, ["-p", here("tsconfig.build.json"), "--outDir", join(dir, "dist")], {
    stdio: "inherit",
  });
  await cp(here("messages"), join(dir, "dist", "messages"), { recursive: true });
  // tsc writes .js imports into the JavaScript but keeps .ts ones in the types; .js reads in every
  // TypeScript version and resolution mode.
  for (const name of await readdir(join(dir, "dist"))) {
    if (!name.endsWith(".d.ts")) continue;
    const path = join(dir, "dist", name);
    const types = await readFile(path, "utf8");
    await writeFile(path, types.replace(/from "(\.\/[a-z-]+)\.ts"/g, 'from "$1.js"'));
  }
}

/** Lays out the package in a new directory and returns it. */
export async function stage(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forecall-lint-package-"));
  await build(dir);
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
    { encoding: "utf8" },
  );
  const [{ filename }] = JSON.parse(output) as [{ filename: string }];
  return join(destination, filename);
}

if (import.meta.main) {
  const destination = process.argv[2];
  if (destination === undefined) throw new Error("usage: node pack.ts <directory>");
  console.log(await pack(resolve(destination)));
}
