import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { addBlock, BLOCK_END, BLOCK_START, CLIENTS, removeBlock } from "./clients";
import { EXIT, type Io } from "./io";
import {
  addHook,
  HOOK_COMMAND,
  parseSetupArgs,
  removeHook,
  SENSOR_COMMAND,
  type SetupDeps,
  setup,
} from "./setup";
import { MCP_ENDPOINT } from "./shared";

const KEY = "fc_agent_0123456789abcdefghijklmnopqrstuv";

/** A fresh HOME, with the deps writing to it and a scripted terminal. */
function machine(options: { tty?: boolean; answers?: string[]; platform?: NodeJS.Platform } = {}) {
  const home = mkdtempSync(join(tmpdir(), "forecall-setup-"));
  const out = { stdout: "", stderr: "", opened: [] as string[], prompts: [] as string[] };
  const answers = [...(options.answers ?? [])];
  const io: Io = {
    stdin: (async function* () {})(),
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    isTTY: options.tty ?? false,
    env: { HOME: home },
  };
  const deps: SetupDeps = {
    platform: options.platform ?? "darwin",
    read: async (file) => {
      try {
        return await readFile(file, "utf8");
      } catch {
        return undefined;
      }
    },
    write: async (file, text) => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text, "utf8");
    },
    exists: async (path) => {
      try {
        await readFile(path);
        return true;
      } catch (error) {
        return (error as { code?: string }).code === "EISDIR";
      }
    },
    openBrowser: async (url) => {
      out.opened.push(url);
    },
    prompt: async (question) => {
      out.prompts.push(question);
      return answers.shift();
    },
  };
  const read = (file: string) => readFile(join(home, file), "utf8");
  return { home, io, deps, out, read };
}

const ALL = CLIENTS.flatMap((client) => ["--client", client.id]);

describe("forecall setup", () => {
  it("configures every client once, changes nothing the second time, and --remove restores the files", async () => {
    const m = machine();
    // Files that exist already keep what they had.
    await m.deps.write(
      join(m.home, ".claude.json"),
      JSON.stringify({ numStartups: 3, mcpServers: { other: { type: "stdio", command: "x" } } }),
    );
    await m.deps.write(
      join(m.home, ".codex", "config.toml"),
      'model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "x"\n',
    );
    await m.deps.write(join(m.home, ".codex", "AGENTS.md"), "# Mine\n\nKeep this.\n");
    await m.deps.write(
      join(m.home, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: [] } }),
    );

    expect(await setup(["--key", KEY, "--hook", ...ALL], m.io, m.deps)).toBe(EXIT.ok);
    const claude = JSON.parse(await m.read(".claude.json"));
    expect(claude).toEqual({
      numStartups: 3,
      mcpServers: {
        other: { type: "stdio", command: "x" },
        forecall: { type: "http", url: MCP_ENDPOINT, headers: { Authorization: `Bearer ${KEY}` } },
      },
    });
    expect(JSON.parse(await m.read(".cursor/mcp.json")).mcpServers.forecall).toEqual({
      url: MCP_ENDPOINT,
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(JSON.parse(await m.read(".gemini/settings.json")).mcpServers.forecall).toEqual({
      httpUrl: MCP_ENDPOINT,
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(
      JSON.parse(await m.read(".codeium/windsurf/mcp_config.json")).mcpServers.forecall,
    ).toEqual({
      serverUrl: MCP_ENDPOINT,
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const desktop = JSON.parse(
      await m.read("Library/Application Support/Claude/claude_desktop_config.json"),
    );
    expect(desktop.mcpServers.forecall).toEqual({
      command: "npx",
      args: ["-y", "forecall-mcp"],
      env: { FORECALL_API_KEY: KEY },
    });
    const codex = await m.read(".codex/config.toml");
    expect(codex).toBe(
      `model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.forecall]\nurl = "${MCP_ENDPOINT}"\nhttp_headers = { Authorization = "Bearer ${KEY}" }\n`,
    );
    for (const file of [
      ".claude/CLAUDE.md",
      ".codex/AGENTS.md",
      ".gemini/GEMINI.md",
      ".codeium/windsurf/memories/global_rules.md",
    ]) {
      const text = await m.read(file);
      expect(text).toContain(BLOCK_START);
      expect(text).toContain("kb_lookup");
      expect(text.trim().endsWith(BLOCK_END)).toBe(true);
    }
    expect(await m.read(".codex/AGENTS.md")).toContain(
      "# Mine\n\nKeep this.\n\n<!-- forecall:start -->",
    );
    const settings = JSON.parse(await m.read(".claude/settings.json"));
    expect(settings.permissions).toEqual({ allow: [] });
    expect(settings.hooks.PostToolUse).toEqual([
      { matcher: "mcp__.*", hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 10 }] },
    ]);
    expect(m.out.stdout).toContain("Claude Code: added the server");
    expect(m.out.stdout).toContain("Cursor keeps its global rules in Settings");
    expect(m.out.stderr).toBe("");

    // Again: nothing changes.
    const before = await Promise.all([
      m.read(".claude.json"),
      m.read(".codex/config.toml"),
      m.read(".claude/settings.json"),
    ]);
    const again = machine();
    again.io.env = m.io.env;
    expect(await setup(["--key", KEY, "--hook", ...ALL], again.io, m.deps)).toBe(EXIT.ok);
    expect(
      await Promise.all([
        m.read(".claude.json"),
        m.read(".codex/config.toml"),
        m.read(".claude/settings.json"),
      ]),
    ).toEqual(before);
    expect(again.out.stdout).toContain("Claude Code: nothing to change");

    // Removed: the files are as they were found (new files stay, emptied of ours).
    const removed = machine();
    removed.io.env = m.io.env;
    expect(await setup(["--remove", ...ALL], removed.io, m.deps)).toBe(EXIT.ok);
    expect(JSON.parse(await m.read(".claude.json"))).toEqual({
      numStartups: 3,
      mcpServers: { other: { type: "stdio", command: "x" } },
    });
    expect(await m.read(".codex/config.toml")).toBe(
      'model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "x"\n',
    );
    expect(await m.read(".codex/AGENTS.md")).toBe("# Mine\n\nKeep this.\n");
    expect(await m.read(".claude/CLAUDE.md")).toBe("");
    expect(JSON.parse(await m.read(".claude/settings.json"))).toEqual({
      permissions: { allow: [] },
    });
    expect(JSON.parse(await m.read(".cursor/mcp.json"))).toEqual({ mcpServers: {} });
    expect(removed.out.stdout).toContain("Claude Code: removed the server");
    expect(await setup(["--remove", ...ALL], machine().io, m.deps)).toBe(EXIT.ok);
  });

  it("finds the clients by their directories and asks for the key and the hook at a terminal", async () => {
    const m = machine({ tty: true, answers: ["not-a-key", KEY, "y"] });
    await m.deps.write(join(m.home, ".claude", "keep"), "");
    await m.deps.write(join(m.home, ".gemini", "keep"), "");
    expect(await setup([], m.io, m.deps)).toBe(EXIT.ok);
    expect(m.out.opened).toEqual(["https://app.forecall.dev/api-keys?new=agent"]);
    expect(m.out.prompts).toHaveLength(3);
    expect(m.out.stderr).toContain("not an agent key");
    expect(JSON.parse(await m.read(".claude.json")).mcpServers.forecall.headers.Authorization).toBe(
      `Bearer ${KEY}`,
    );
    expect(JSON.parse(await m.read(".gemini/settings.json")).mcpServers.forecall.httpUrl).toBe(
      MCP_ENDPOINT,
    );
    expect(JSON.parse(await m.read(".claude/settings.json")).hooks.PostToolUse).toHaveLength(1);
    await expect(m.read(".cursor/mcp.json")).rejects.toThrow();
  });

  it("without a terminal and without a key, says what to do and exits with 0", async () => {
    const m = machine();
    await m.deps.write(join(m.home, ".cursor", "keep"), "");
    expect(await setup([], m.io, m.deps)).toBe(EXIT.ok);
    expect(m.out.stdout).toContain("npx forecall setup --key");
    await expect(m.read(".cursor/mcp.json")).rejects.toThrow();
    // No client at all.
    const empty = machine();
    expect(await setup(["--key", KEY], empty.io, empty.deps)).toBe(EXIT.ok);
    expect(empty.out.stdout).toContain("No supported client found");
  });

  it("skips the hook without a terminal unless --hook says so, and --dry-run writes nothing", async () => {
    const m = machine();
    expect(await setup(["--key", KEY, "--client", "claude-code"], m.io, m.deps)).toBe(EXIT.ok);
    expect(m.out.stdout).toContain("--hook to add it");
    await expect(m.read(".claude/settings.json")).rejects.toThrow();
    const dry = machine();
    expect(await setup(["--key", KEY, "--client", "cursor", "--dry-run"], dry.io, dry.deps)).toBe(
      EXIT.ok,
    );
    expect(dry.out.stdout).toContain("Cursor: would add the server");
    await expect(dry.read(".cursor/mcp.json")).rejects.toThrow();
  });

  it("reports a file it cannot read and goes on with the others", async () => {
    const m = machine();
    await m.deps.write(join(m.home, ".cursor", "mcp.json"), "{ not json");
    expect(
      await setup(
        ["--key", KEY, "--client", "cursor", "--client", "gemini", "--no-hook"],
        m.io,
        m.deps,
      ),
    ).toBe(EXIT.error);
    expect(m.out.stderr).toContain("Cursor: Cursor is not valid JSON");
    expect(JSON.parse(await m.read(".gemini/settings.json")).mcpServers.forecall).toBeDefined();
  });

  it("updates Claude Desktop's mcp-remote entry from forecall 0.3 to forecall-mcp, keeping its key", async () => {
    const m = machine();
    const file = join(m.home, "Library/Application Support/Claude/claude_desktop_config.json");
    const earlier = {
      command: "npx",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: what forecall 0.3 wrote, for mcp-remote to expand.
      args: ["-y", "mcp-remote", MCP_ENDPOINT, "--header", "Authorization:${FORECALL_AUTH}"],
      env: { FORECALL_AUTH: `Bearer ${KEY}` },
    };
    await m.deps.write(
      file,
      JSON.stringify({ mcpServers: { other: { command: "x" }, forecall: earlier } }),
    );
    // No --key and no terminal: the entry has the key already, so none is asked for.
    expect(await setup(["--client", "claude-desktop"], m.io, m.deps)).toBe(EXIT.ok);
    expect(m.out.stdout).toContain(`Claude Desktop: updated the server in ${file}`);
    expect(
      JSON.parse(await m.read("Library/Application Support/Claude/claude_desktop_config.json")),
    ).toEqual({
      mcpServers: {
        other: { command: "x" },
        forecall: { command: "npx", args: ["-y", "forecall-mcp"], env: { FORECALL_API_KEY: KEY } },
      },
    });
    // Once updated, a second run changes nothing.
    m.out.stdout = "";
    expect(await setup(["--client", "claude-desktop"], m.io, m.deps)).toBe(EXIT.ok);
    expect(m.out.stdout).toContain("Claude Desktop: nothing to change");
  });

  it("leaves an entry named forecall alone when forecall did not write it", async () => {
    const m = machine();
    const mine = { command: "node", args: ["/opt/my-proxy.js"], env: { TOKEN: "x" } };
    await m.deps.write(
      join(m.home, "Library/Application Support/Claude/claude_desktop_config.json"),
      JSON.stringify({ mcpServers: { forecall: mine } }),
    );
    expect(await setup(["--client", "claude-desktop"], m.io, m.deps)).toBe(EXIT.ok);
    expect(m.out.stdout).toContain("Claude Desktop: nothing to change");
    expect(
      JSON.parse(await m.read("Library/Application Support/Claude/claude_desktop_config.json"))
        .mcpServers.forecall,
    ).toEqual(mine);
  });

  it("uses CLAUDE_CONFIG_DIR, APPDATA on Windows, and XDG on Linux", async () => {
    const m = machine({ platform: "win32" });
    m.io.env = {
      ...m.io.env,
      CLAUDE_CONFIG_DIR: join(m.home, "cfg"),
      APPDATA: join(m.home, "Roaming"),
    };
    expect(
      await setup(
        ["--key", KEY, "--no-hook", "--client", "claude-code", "--client", "claude-desktop"],
        m.io,
        m.deps,
      ),
    ).toBe(EXIT.ok);
    expect(JSON.parse(await m.read("cfg/.claude.json")).mcpServers.forecall).toBeDefined();
    expect(await m.read("cfg/CLAUDE.md")).toContain(BLOCK_START);
    expect(
      JSON.parse(await m.read("Roaming/Claude/claude_desktop_config.json")).mcpServers.forecall,
    ).toBeDefined();
    const linux = machine({ platform: "linux" });
    expect(await setup(["--key", KEY, "--client", "claude-desktop"], linux.io, linux.deps)).toBe(
      EXIT.ok,
    );
    expect(
      JSON.parse(await linux.read(".config/Claude/claude_desktop_config.json")).mcpServers.forecall,
    ).toBeDefined();
  });

  it("treats an empty CLAUDE_CONFIG_DIR, HOME or APPDATA as unset", async () => {
    const m = machine({ platform: "win32" });
    m.io.env = { HOME: "", USERPROFILE: m.home, CLAUDE_CONFIG_DIR: "", APPDATA: "" };
    expect(
      await setup(
        ["--key", KEY, "--no-hook", "--client", "claude-code", "--client", "claude-desktop"],
        m.io,
        m.deps,
      ),
    ).toBe(EXIT.ok);
    expect(JSON.parse(await m.read(".claude.json")).mcpServers.forecall).toBeDefined();
    expect(await m.read(".claude/CLAUDE.md")).toContain(BLOCK_START);
    expect(m.out.stdout).toContain(join(m.home, ".claude", "CLAUDE.md"));
    expect(
      JSON.parse(await m.read("AppData/Roaming/Claude/claude_desktop_config.json")).mcpServers
        .forecall,
    ).toBeDefined();
  });

  it("writes nothing without a home directory", async () => {
    const m = machine();
    const written: string[] = [];
    m.deps.write = async (file) => {
      written.push(file);
    };
    m.io.env = { HOME: "", USERPROFILE: "", CLAUDE_CONFIG_DIR: "" };
    expect(await setup(["--key", KEY, "--no-hook", "--client", "claude-code"], m.io, m.deps)).toBe(
      EXIT.error,
    );
    expect(m.out.stderr).toContain("cannot find your home directory");
    expect(written).toEqual([]);
  });

  it.each<[string[], string]>([
    [["--client", "vim"], 'unknown client "vim"'],
    [["--hook", "--no-hook"], "--hook and --no-hook together"],
    [["--key", "fc_ci_0123456789abcdefghijklmnopqrstuv"], "--key must be an agent key"],
    [["extra"], "Unexpected argument"],
    [["--what"], "Unknown option"],
  ])("refuses %j", async (args, message) => {
    const m = machine();
    expect(await setup(args, m.io, m.deps)).toBe(EXIT.error);
    expect(m.out.stderr).toContain(message);
    expect(parseSetupArgs(args)).toMatchObject({ ok: false });
  });

  it("adds the sensor only with --sensor, without asking for the key again, and --remove --sensor takes out only it", async () => {
    const m = machine();
    const claude = ["--client", "claude-code"];
    expect(await setup(["--key", KEY, "--hook", ...claude], m.io, m.deps)).toBe(EXIT.ok);
    expect(m.out.stdout).not.toContain("sensor");
    const servers = await m.read(".claude.json");

    // Later, at a terminal: the server is there, so no key is asked for, nor the browser opened.
    const later = machine({ tty: true, answers: ["n"] });
    later.io.env = m.io.env;
    expect(await setup(["--sensor", ...claude], later.io, later.deps)).toBe(EXIT.ok);
    expect(later.out.opened).toEqual([]);
    expect(later.out.prompts).toHaveLength(1);
    expect(later.out.stdout).toContain("added the sensor's hook");
    expect(later.out.stdout).toContain("--remove --sensor");
    expect(await m.read(".claude.json")).toBe(servers);
    const post = JSON.parse(await m.read(".claude/settings.json")).hooks.PostToolUse;
    expect(post).toEqual([
      { matcher: "mcp__.*", hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 10 }] },
      {
        matcher: "mcp__.*",
        hooks: [{ type: "command", command: SENSOR_COMMAND, timeout: 10, async: true }],
      },
    ]);
    // Once.
    const again = machine();
    again.io.env = m.io.env;
    expect(await setup(["--sensor", "--no-hook", ...claude], again.io, m.deps)).toBe(EXIT.ok);
    expect(again.out.stdout).toContain("Claude Code: nothing to change");

    // Only the sensor comes out; the server, the instructions and the hint stay.
    const stop = machine();
    stop.io.env = m.io.env;
    expect(await setup(["--remove", "--sensor", ...ALL], stop.io, m.deps)).toBe(EXIT.ok);
    expect(stop.out.stdout).toContain("Claude Code: removed the sensor's hook");
    expect(stop.out.stdout).not.toContain("Cursor");
    expect(JSON.parse(await m.read(".claude/settings.json")).hooks.PostToolUse).toEqual([post[0]]);
    expect(await m.read(".claude.json")).toBe(servers);
    expect(await m.read(".claude/CLAUDE.md")).toContain(BLOCK_START);

    // And --remove takes both hooks out.
    const re = machine();
    re.io.env = m.io.env;
    await setup(["--sensor", "--no-hook", ...claude], re.io, m.deps);
    const all = machine();
    all.io.env = m.io.env;
    expect(await setup(["--remove", ...claude], all.io, m.deps)).toBe(EXIT.ok);
    expect(all.out.stdout).toContain("the PostToolUse hook and the sensor's hook");
  });

  it("says the sensor needs Claude Code when it is not there", async () => {
    const m = machine();
    expect(await setup(["--key", KEY, "--sensor", "--client", "cursor"], m.io, m.deps)).toBe(
      EXIT.ok,
    );
    expect(m.out.stdout).toContain("The sensor is a Claude Code hook");
  });

  it("prints the help", async () => {
    const m = machine();
    expect(await setup(["--help"], m.io, m.deps)).toBe(EXIT.ok);
    expect(m.out.stdout).toContain("Usage: forecall setup");
  });
});

describe("the instructions block and the hook entry", () => {
  it("goes in once and comes out cleanly", () => {
    const added = addBlock("# Mine\n") as string;
    expect(added.startsWith("# Mine\n\n<!-- forecall:start -->")).toBe(true);
    expect(addBlock(added)).toBeNull();
    expect(removeBlock(added)).toBe("# Mine\n");
    expect(removeBlock(`${added}\nAfter.\n`)).toBe("# Mine\n\nAfter.\n");
    expect(removeBlock(addBlock("") as string)).toBe("");
    expect(removeBlock("nothing")).toBeNull();
    expect(removeBlock(`${BLOCK_START}\nunterminated`)).toBe("");
  });

  it("keeps other hooks and leaves settings without hooks as they were", () => {
    const other = { matcher: "Bash", hooks: [{ type: "command", command: "echo" }] };
    const withOther = JSON.stringify({ hooks: { PostToolUse: [other], PreToolUse: [] } });
    const added = addHook(withOther) as string;
    expect(JSON.parse(added).hooks.PostToolUse).toHaveLength(2);
    expect(addHook(added)).toBeNull();
    expect(JSON.parse(removeHook(added) as string)).toEqual({
      hooks: { PreToolUse: [], PostToolUse: [other] },
    });
    expect(removeHook(withOther)).toBeNull();
    expect(JSON.parse(removeHook(addHook("") as string) as string)).toEqual({});
    // The hint and the sensor are told apart.
    const both = addHook(added, "sensor") as string;
    expect(addHook(both, "sensor")).toBeNull();
    expect(removeHook(added, ["sensor"])).toBeNull();
    expect(JSON.parse(removeHook(both, ["sensor"]) as string)).toEqual(JSON.parse(added));
  });
});
