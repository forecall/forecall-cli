// What npm would get: the files, a manifest whose exports match this package's, and a package that
// plain Node runs and a NodeNext TypeScript project typechecks.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { lintToolsList } from "./index.ts";
import { ENTRIES, stage } from "./pack.ts";

const TOOLS = JSON.stringify([{ name: "get_forecast", description: "Returns the forecast." }]);

describe("the npm package", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await stage();
  }, 120_000);

  it("has the built code, its types and the catalogs, and none of the tests or fixtures", () => {
    const output = execFileSync("npm", ["pack", dir, "--dry-run", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const [{ files }] = JSON.parse(output) as [{ files: { path: string }[] }];
    const paths = files.map((file) => file.path);
    for (const module of Object.values(ENTRIES)) {
      expect(paths).toContain(`dist/${module}.js`);
      expect(paths).toContain(`dist/${module}.d.ts`);
    }
    expect(paths).toEqual(
      expect.arrayContaining(["dist/messages/en.json", "dist/messages/ja.json"]),
    );
    expect(paths).toEqual(
      expect.arrayContaining(["LICENSE", "NOTICE", "README.md", "package.json"]),
    );
    expect(
      paths.filter((path) => /test|fixtures|\.ts$/.test(path.replace(/\.d\.ts$/, ""))),
    ).toEqual([]);
  }, 60_000);

  it("exports what this package exports, and names this repository for the provenance", async () => {
    const here = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
    const published = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(Object.keys(published.exports)).toEqual(Object.keys(here.exports));
    expect(published).toMatchObject({
      name: "@forecall/lint",
      type: "module",
      sideEffects: false,
      repository: {
        url: "git+https://github.com/forecall/forecall-cli.git",
        directory: "packages/lint",
      },
    });
    expect(published.private).toBeUndefined();
    expect(published.dependencies).toBeUndefined();
  });

  it("runs in plain Node and typechecks in a NodeNext project", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "forecall-lint-consumer-"));
    await mkdir(join(consumer, "node_modules", "@forecall"), { recursive: true });
    await cp(dir, join(consumer, "node_modules", "@forecall", "lint"), { recursive: true });
    await writeFile(join(consumer, "package.json"), '{"type":"module"}\n');
    const program = [
      'import { lintToolsList } from "@forecall/lint";',
      'import { issueMessage } from "@forecall/lint/internal/messages";',
      `const result = lintToolsList(${JSON.stringify(TOOLS)});`,
      "if (!result.ok) throw new Error(result.error.code);",
      "const issue = result.report.tools[0]?.issues[0];",
      'console.log(JSON.stringify([result.report.scoreAvg, issue ? issueMessage("en", issue) : ""]));',
    ].join("\n");
    await writeFile(join(consumer, "run.mjs"), program);
    await writeFile(join(consumer, "check.ts"), program);
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          strict: true,
          noEmit: true,
          types: [],
          skipLibCheck: false,
        },
        files: ["check.ts"],
      }),
    );

    const [score, sentence] = JSON.parse(
      execFileSync("node", [join(consumer, "run.mjs")], { encoding: "utf8" }),
    );
    const source = lintToolsList(TOOLS);
    if (!source.ok) throw new Error("the source could not read the tools");
    expect(score).toBe(source.report.scoreAvg);
    expect(sentence).not.toBe("");

    const tsc = fileURLToPath(new URL("./node_modules/.bin/tsc", import.meta.url));
    expect(() =>
      execFileSync(tsc, ["-p", join(consumer, "tsconfig.json")], { stdio: "pipe" }),
    ).not.toThrow();
  }, 120_000);
});
