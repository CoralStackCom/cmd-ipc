# Web Workers Example

Offload computation to background threads while keeping the UI responsive.

**[📖 Full Documentation](https://coralstack.github.io/cmd-ipc/examples/web-workers/)**

## Overview

This example demonstrates how to use cmd-ipc with Web Workers for background computation. Each worker runs in an isolated iframe sandbox, making it ideal for plugin architectures where third-party code runs in isolated workers.

## Running the Example

From the repository root:

```bash
yarn start:examples-web-workers
```

Open http://localhost:5173 in your browser.

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

### Building for Production

```bash
yarn workspace @examples/web-workers build
```

## Project Structure

```
examples/web-workers/
├── src/
│   ├── main.tsx          # Entry point - creates workers & registry
│   ├── App.tsx           # React UI
│   ├── ipc/
│   │   ├── command-schema.ts  # Command definitions
│   │   └── event-schema.ts    # Event definitions
│   └── workers/
│       ├── calc.worker.ts     # Math operations
│       ├── data.worker.ts     # Data processing
│       └── crypto.worker.ts   # Cryptographic operations
```
