// Entry point of the `forecall` command (bundled into dist/forecall.js by build.ts).
import { EXIT, run } from "./run";

try {
  process.exitCode = await run(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    isTTY: process.stdout.isTTY === true,
    env: process.env,
  });
} catch (error) {
  process.stderr.write(`forecall: internal error: ${(error as Error).stack ?? String(error)}\n`);
  process.exitCode = EXIT.error;
}
