# Cloudflare Workers Example

HTTP-based commands with Cloudflare Workers and schema generation.

**[📖 Full Documentation](https://coralstack.github.io/cmd-ipc/examples/cloudflare-workers/)**

## Overview

This example demonstrates HTTP-based command communication using the HTTPChannel, with remote schema generation for type-safe client development. It includes a Cloudflare Worker serving commands at the edge and a React frontend consuming them.

## Running the Example

From the repository root:

```bash
yarn start:examples-cf-worker
```

Open http://localhost:5174 in your browser.

## Development

### Prerequisites

- Node.js >= 20.18.2
- Yarn 4.6.0

### Setup

```bash
nvm use       # Use Node.js version from .nvmrc
yarn          # Install dependencies (from repo root)
yarn build    # Build the cmd-ipc library
```

### Generate Remote Schemas

To regenerate TypeScript schemas from the running worker:

```bash
cmd-ipc generate-schema \
  --host http://localhost:8787 \
  --output ./packages/frontend/src/schemas/generated/worker-commands.ts \
  --prefix worker
```

## Project Structure

```
examples/cf-worker/
├── packages/
│   ├── worker/             # Cloudflare Worker
│   │   ├── wrangler.toml   # Worker configuration
│   │   └── src/
│   │       ├── index.ts
│   │       └── command-schema.ts
│   └── frontend/           # React application
│       └── src/
│           ├── schemas/
│           │   └── generated/  # CLI-generated remote schemas
│           └── services/
```
