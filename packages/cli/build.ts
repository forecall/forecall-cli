// Bundles the CLI into dist/: dist/forecall.js (src/main.ts, the commands and `lint`), dist/dump.js
// (`dump` and the MCP client), which forecall.js loads only for `forecall dump`, dist/setup.js and
// dist/sensor.js (`forecall hook --sensor`). `lint` never loads anything that can reach the
// network (bundle.test.ts checks it). Not minified, so anyone can read what runs; esbuild drops the comments. No source
// map. The licenses of the bundled npm packages are written to dist/THIRD_PARTY_NOTICES.md.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

/** Licenses that let us bundle a package as long as its notice goes with it. */
export const ALLOWED_LICENSES = ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"];

/**
 * forecall.js keeps `import("./dump")`, `import("./setup")` and `import("./sensor")` as loads of
 * dist/dump.js, dist/setup.js and dist/sensor.js, each built on its own.
 */
const commandsStayOutside: esbuild.Plugin = {
  name: "commands-stay-outside",
  setup(build) {
    build.onResolve({ filter: /^\.\/(dump|setup|sensor)$/ }, (args) => ({
      path: `${args.path}.js`,
      external: true,
    }));
  },
};

const packageDir = fileURLToPath(new URL(".", import.meta.url));

const common: esbuild.BuildOptions = {
  // Paths in the metafile are relative to this package.
  absWorkingDir: packageDir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
};

/** Builds dist/ into `outdir` and returns both bundles' metafiles (bundle.test.ts reads them). */
export async function build(outdir = fileURLToPath(new URL("dist", import.meta.url))) {
  const lint = await esbuild.build({
    ...common,
    entryPoints: { forecall: "src/main.ts" },
    outdir,
    banner: { js: "#!/usr/bin/env node" },
    plugins: [commandsStayOutside],
  });
  const dump = await esbuild.build({
    ...common,
    entryPoints: { dump: "src/dump.ts" },
    outdir,
    // The MCP client's CommonJS dependencies (cross-spawn) call require().
    banner: {
      js: 'import { createRequire as __forecallCreateRequire } from "node:module";\nconst require = __forecallCreateRequire(import.meta.url);',
    },
  });
  // setup bundles no npm package: the clients' files are read and written with node's own modules.
  const setup = await esbuild.build({
    ...common,
    entryPoints: { setup: "src/setup.ts" },
    outdir,
  });
  // The sensor neither: node's fetch, and the KB's redaction copied into src/redact.ts.
  const sensor = await esbuild.build({
    ...common,
    entryPoints: { sensor: "src/sensor.ts" },
    outdir,
  });
  await writeFile(
    join(outdir, "THIRD_PARTY_NOTICES.md"),
    await thirdPartyNotices(dump.metafile as esbuild.Metafile),
  );
  return {
    lint: lint.metafile as esbuild.Metafile,
    dump: dump.metafile as esbuild.Metafile,
    setup: setup.metafile as esbuild.Metafile,
    sensor: sensor.metafile as esbuild.Metafile,
  };
}

export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  /** The license file's text, then the NOTICE file's if the package has one. */
  texts: string[];
}

/** The npm packages whose code is in the bundle, from esbuild's metafile. */
export async function bundledPackages(metafile: esbuild.Metafile): Promise<BundledPackage[]> {
  const roots = new Set<string>();
  for (const input of Object.keys(metafile.inputs)) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match?.[1] !== undefined) roots.add(match[1]);
  }
  const packages: BundledPackage[] = [];
  for (const root of roots) {
    const dir = join(packageDir, root);
    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name: string;
      version: string;
      license?: string;
    };
    const files = await readdir(dir);
    const licenseFile = files.find((file) => /^licen[cs]e(\.(md|txt))?$/i.test(file));
    if (licenseFile === undefined) throw new Error(`${manifest.name} has no license file`);
    const license = manifest.license ?? "";
    if (!ALLOWED_LICENSES.includes(license)) {
      throw new Error(`${manifest.name} is under "${license}", which is not in ALLOWED_LICENSES`);
    }
    const texts = [await readFile(join(dir, licenseFile), "utf8")];
    const notice = files.find((file) => /^notice(\.(md|txt))?$/i.test(file));
    if (notice !== undefined) texts.push(await readFile(join(dir, notice), "utf8"));
    packages.push({ name: manifest.name, version: manifest.version, license, texts });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

async function thirdPartyNotices(metafile: esbuild.Metafile): Promise<string> {
  const sections = (await bundledPackages(metafile)).map(
    (pkg) =>
      `## ${pkg.name} ${pkg.version} (${pkg.license})\n\n${pkg.texts.map((text) => text.trim()).join("\n\n")}\n`,
  );
  return `# Third-party notices\n\nThe forecall bundle includes code from these npm packages, under their own licenses.\n\n${sections.join("\n")}`;
}

if (import.meta.main) await build();
