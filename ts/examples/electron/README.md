# Electron.js Example

A multi-process Command IPC architecture for building extensible, performant Electron.js apps.

**[📖 Full Documentation](https://coralstack.com/cmd-ipc/examples/electron/)**

## Overview

This example demonstrates type-safe IPC between Electron main and renderer processes using MessagePorts. It includes a background worker process, a sandboxed execution environment, and a React frontend.

## Running the Example

From the repository root:

```bash
yarn start:examples-electron
```

## Development

### Prerequisites

- Node.js >= 20.18.2
- Yarn 4.6.0

### Setup

```bash
nvm use                           # Use Node.js version from .nvmrc
yarn                              # Install dependencies (from repo root)
yarn workspace @examples/electron-core build  # Build core package
```

### Testing

```bash
yarn workspace @examples/electron-main test
```

## Project Structure

```
examples/electron/
├── packages/
│   ├── core/       # Shared types and schemas
│   ├── main/       # Electron main process
│   ├── frontend/   # Electron renderer (React)
│   ├── worker/     # Background worker process
│   └── sandbox/    # Sandboxed execution environment
```
