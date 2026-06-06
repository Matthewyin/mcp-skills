# MCP Skills

This repository contains reusable MCP-related skills, servers, and Codex plugin packages.

## Diagram Generator

`diagram-generator` is split into three publishable surfaces:

- `skills/diagram-generator/`: the agent-facing skill and reference playbooks.
- `mcp-diagram-generator/`: the TypeScript MCP server that generates Draw.io, Mermaid, and Excalidraw files.
- `plugins/diagram-generator/`: the Codex plugin wrapper that installs the skill and configures the MCP server.

The plugin MCP configuration uses:

```json
{
  "mcpServers": {
    "mcp-diagram-generator": {
      "command": "npx",
      "args": ["-y", "mcp-diagram-generator"]
    }
  }
}
```

This intentionally resolves the latest npm package at runtime.

## Repository Layout

```text
mcp-skills/
├── mcp-diagram-generator/
│   ├── scripts/
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
├── plugins/
│   └── diagram-generator/
│       ├── .codex-plugin/
│       ├── .mcp.json
│       └── skills/
└── skills/
    └── diagram-generator/
        ├── SKILL.md
        ├── package.json
        └── references/
```

## Local Checks

Run MCP server checks from `mcp-diagram-generator/`:

```bash
npm install
npm run build
npm run test:diagrams
```

Generated artifacts, local runtime state, dependency folders, archives, and environment files are intentionally ignored.

## License

MIT
