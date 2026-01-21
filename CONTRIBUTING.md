# Contributing to cmd-ipc

Thank you for your interest in contributing to cmd-ipc! This document provides guidelines and information for contributors.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/cmd-ipc.git`
3. Install dependencies: `yarn`
4. Create a branch for your changes: `git checkout -b feature/your-feature-name`

## Development Setup

### Prerequisites

- Node.js >= 20.18.2
- Yarn 4.6.0

### Commands

```bash
yarn                    # Install dependencies
yarn build              # Build the library
yarn typecheck          # Run TypeScript type checking
yarn test               # Run tests in watch mode
yarn test:run           # Run tests once
yarn format             # Format and lint code
yarn lint               # Run ESLint
yarn prettify           # Run Prettier
```

## Code Style

- We use ESLint and Prettier for code formatting
- Run `yarn format` before committing to ensure consistent style
- TypeScript strict mode is enabled

## Pull Request Process

1. Ensure your code passes all tests: `yarn test:run`
2. Ensure your code passes type checking: `yarn typecheck`
3. Ensure your code is formatted: `yarn format`
4. Update documentation if you're changing public APIs
5. Add tests for new functionality
6. Create a pull request with a clear description of your changes

### PR Title Format

Use conventional commit format for PR titles:

- `feat: add new feature`
- `fix: resolve bug in X`
- `docs: update documentation`
- `refactor: improve code structure`
- `test: add missing tests`
- `chore: update dependencies`

## Reporting Issues

When reporting issues, please include:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant code snippets or error messages

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the code, not the person
- Help others learn and grow

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
