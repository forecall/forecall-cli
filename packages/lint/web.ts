// The one Web API the tools/list reader needs, which both Workers and Node.js provide as a global,
// typed here instead of through DOM, Node or Workers types.
interface WebGlobals {
  TextEncoder: new () => { encode(input?: string): Uint8Array };
}

export const web = globalThis as unknown as WebGlobals;
