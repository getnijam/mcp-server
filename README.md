<p align="center">
  <img src="./logo.png" alt="Nijam" width="84" height="84" />
</p>

# @nijam/mcp-server

MCP server for [Nijam](https://nijam.dev) — lets any MCP-capable agent (Claude Code, Claude Desktop, Cursor, …) query your Playwright test runs: what failed, why, since when, and what's flaky.

Ask things like *"why is the checkout suite red?"*, *"is `cart updates quantity` flaky?"*, or *"when did this test start failing?"* — the model answers from your real run history.

## Setup

You need a Nijam **read key** (`nij_rk_…`): create one in your dashboard under **Organization settings → Secret keys**, choosing the **Read (MCP)** type. Read keys are read-only by construction — they can never upload or change anything — and always cover the whole organization, so the agent can resolve any project by name or slug. (Ingestion keys — `nij_sk_…`, the ones in your CI — are write-only and are rejected by the read API, so a leaked CI key exposes no data.)

**Claude Code**

```bash
claude mcp add nijam -e NIJAM_API_KEY=nij_rk_... -- npx -y @nijam/mcp-server
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "nijam": {
      "command": "npx",
      "args": ["-y", "@nijam/mcp-server"],
      "env": { "NIJAM_API_KEY": "nij_rk_..." }
    }
  }
}
```

| Env var | Required | Default | |
| --- | --- | --- | --- |
| `NIJAM_API_KEY` | yes | — | Read key (`nij_rk_…`) from the dashboard. |
| `NIJAM_API_URL` | no | `https://api.nijam.dev` | Self-hosted / local API base URL. |

## Tools

`get_projects` is the entry point: it lists the projects the key can access as `{ id, slug, name }`. Every other tool's `project` parameter accepts the **id, the slug, or the name** — so "check the Web Checkout project" resolves without you ever pasting a UUID.

| Tool | What it answers |
| --- | --- |
| `get_projects` | What projects can I see? (call first — resolves "my project" into an id/slug) |
| `get_latest_run` | What's the state of the latest run (optionally on a branch)? |
| `list_failing_tests` | Which tests failed in this run (or the latest run), and with what error? |
| `get_failure` | Full detail of one failure: every attempt, error, screenshots/video/trace links. |
| `is_test_flaky` | Verdict + evidence: how often did this test flake recently? |
| `get_run` | One run's aggregate stats and per-spec-file breakdown. |
| `list_runs` | Run history, filterable by status/branch, paginated. |
| `get_test_history` | One test across the last 30 runs — spot when it started failing. |
| `list_flaky_tests` | The flakiest tests of the project, ranked by flake count. |

Reads only — read keys cannot write, and the server never mutates anything.

## Notes

- **Slugs** are derived from the project name (`"Web Checkout"` → `web-checkout`). If two projects share a slug, the tools say so and ask for the id.
- Trace artifacts are linked via short-lived (15 min) presigned URLs, minted on demand.
- Errors come back as tool errors with the API's own message, so the model can self-correct (e.g. unknown slug → the list of valid slugs).

## License

MIT
