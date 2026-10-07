import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishedManifest, stage } from "./pack.ts";

const manifest = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

describe("publishedManifest", () => {
  it("keeps what npm users see and drops the workspace's own fields", () => {
    const published = publishedManifest(manifest);
    expect(Object.keys(published)).toEqual([
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
    ]);
    expect(published).toMatchObject({
      name: "forecall",
      license: "Apache-2.0",
      bin: { forecall: "dist/forecall.js" },
      engines: { node: ">=22" },
    });
    expect(published.repository).toEqual({
      type: "git",
      url: "git+https://github.com/forecall/forecall-cli.git",
      directory: "packages/cli",
    });
  });
});

describe("the package", () => {
  it("holds only the bundles, the licenses, the notice, the readme and the manifest", async () => {
    const dir = await stage();
    const output = execFileSync("npm", ["pack", dir, "--dry-run", "--json"], { encoding: "utf8" });
    const [{ files }] = JSON.parse(output) as [{ files: { path: string }[] }];
    expect(files.map((file) => file.path).toSorted()).toEqual([
      "LICENSE",
      "NOTICE",
      "README.md",
      "dist/THIRD_PARTY_NOTICES.md",
      "dist/dump.js",
      "dist/forecall.js",
      "dist/sensor.js",
      "dist/setup.js",
      "package.json",
    ]);
    const staged = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(staged).not.toHaveProperty("devDependencies");
    expect(staged).not.toHaveProperty("scripts");
  }, 60_000);
});
