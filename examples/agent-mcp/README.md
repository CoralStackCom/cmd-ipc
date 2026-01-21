# AI Agent MCP Example

Expose cmd-ipc commands as AI agent tools via tool calling.

**[📖 Full Documentation](https://coralstack.com/cmd-ipc/examples/mcp-agent/)**

## Overview

This example demonstrates how to convert cmd-ipc commands into tools for AI agents. It uses the Vercel AI SDK to integrate with Google Gemini, showing how commands can be easily converted to tools for any AI agent framework.

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
│   ├── App.tsx               # Chat interface
│   ├── agent/
│   │   ├── useGeminiChat.ts  # Chat hook with AI SDK
│   │   └── list-tools.ts     # Converts commands to AI SDK tools
│   └── commands/
│       ├── command-registry.ts
│       ├── command-schema.ts
│       └── command-handlers.ts
```
