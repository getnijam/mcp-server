#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { NijamClient } from './client.js';
import { registerTools } from './tools.js';

// Single-source the version from package.json (always shipped in the published
// package, one level up from dist/index.js) so the MCP handshake never drifts
// from the released version after the publish workflow bumps it. Read at runtime
// via a URL relative to this module so the bundler leaves it as a real file read.
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
const DEFAULT_API_URL = 'https://api.nijam.dev';

const apiKey = process.env.NIJAM_API_KEY;
const apiUrl = process.env.NIJAM_API_URL ?? DEFAULT_API_URL;

if (!apiKey) {
  // stderr only, stdout belongs to the MCP protocol.
  console.error(
    '[nijam-mcp] NIJAM_API_KEY is not set. Create a read key (nij_rk_…) in your Nijam ' +
      'dashboard (Organization settings → Secret keys → Read type) and pass it via the MCP server env.',
  );
  process.exit(1);
}

const server = new McpServer({ name: 'nijam', version: VERSION });
registerTools(server, new NijamClient(apiUrl, apiKey));

await server.connect(new StdioServerTransport());
console.error(`[nijam-mcp] v${VERSION} ready (api: ${apiUrl})`);
