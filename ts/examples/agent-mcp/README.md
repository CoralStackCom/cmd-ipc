# AI Agent MCP Example

Expose cmd-ipc commands as AI agent tools via tool calling, with support for connecting to external MCP servers with automatic OAuth authentication.

**[Full Documentation](https://coralstack.com/cmd-ipc/examples/mcp-agent/)**

## Overview

This example demonstrates how to:

- Convert cmd-ipc commands into tools for AI agents
- Connect to external MCP servers to expand available tools
- Handle OAuth authentication for protected MCP servers
- Use the Vercel AI SDK to integrate with Google Gemini

## Running the Example

From the repository root:

```bash
yarn start:examples-agent-mcp
```

Open http://localhost:5173 and enter your Google AI API key.

## Development

### Prerequisites

- Node.js >= 20.18.2
- Yarn 4.6.0
- Google AI API key ([Get one here](https://aistudio.google.com/apikey))

### Setup

```bash
nvm use       # Use Node.js version from .nvmrc
yarn          # Install dependencies (from repo root)
yarn build    # Build the cmd-ipc library
```

### Optional: Configure API Key

Create a `.env` file to avoid entering your API key each time:

```bash
cp .env.example .env
# Edit .env and add: VITE_GOOGLE_AI_API_KEY=your_api_key_here
```

## Project Structure

```
examples/agent-mcp/
├── src/
│   ├── App.tsx                # Main app with tabs (Chat, MCP Servers)
│   ├── agent/                 # AI agent integration
│   │   ├── gemini-chat-transport.ts
│   │   └── list-tools.ts
│   ├── commands/              # Local command definitions
│   │   ├── command-registry.ts
│   │   ├── command-schema.ts
│   │   └── calc-service.ts
│   ├── components/            # React components
│   │   ├── ChatTab.tsx
│   │   ├── MCPServersTab.tsx
│   │   └── ToolsSidebar.tsx
│   ├── mcp/                   # MCP server management
│   │   └── mcp-server-manager.ts
│   ├── middleware/            # Vite dev server middleware
│   │   ├── mcp-proxy.ts       # CORS proxy for external MCP servers
│   │   └── spa-fallback.ts    # SPA routing for OAuth callbacks
│   └── utils/
│       └── oauth-popup.ts     # OAuth popup and token storage
```
