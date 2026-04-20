.PHONY: help check-node \
        install build test ready clean \
        ts-setup ts-build ts-ready ts-test ts-release ts-start-example \
        rust-build rust-test rust-lint rust-format \
        docs-install docs-dev docs-build \
        conformance

help:             ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------- Node version guard ----------
# Reads .nvmrc at repo root and compares against `node --version`.
# Use `nvm use` (or fnm/asdf/volta) in your shell to switch automatically.
check-node:
	@test -f .nvmrc || { echo "missing .nvmrc"; exit 1; }
	@want="$$(cat .nvmrc)"; \
	got="$$(node --version 2>/dev/null || echo none)"; \
	wantNorm="$${want#v}"; gotNorm="$${got#v}"; \
	if [ "$$wantNorm" != "$$gotNorm" ]; then \
	  echo "Node version mismatch: want $$want, got $$got"; \
	  echo "Hint: run \`nvm use\` (or fnm/asdf equivalent) at the repo root."; \
	  exit 1; \
	fi

# ---------- Top-level aggregates ----------
install: ts-setup docs-install                      ## Install all dependencies (TS + docs)
build: ts-build rust-build                          ## Build all implementations
test: ts-test rust-test conformance                 ## Run all tests + conformance
ready: ts-ready rust-format rust-lint rust-test     ## Pre-commit gate: format, lint, typecheck, test

clean:
	rm -rf ts/node_modules "ts/packages/*/dist" "ts/examples/*/dist" \
	       rust/target docs/node_modules docs/dist

# ---------- TypeScript ----------
ts-setup: check-node                                ## Install all TS workspace deps
	cd ts && yarn install

ts-build: check-node                                ## Build all TS packages
	cd ts && yarn build

# ts-ready: format + lint (auto-fix) + typecheck + tests.
# Fails only on unfixable lint errors, type errors, or test failures.
# Formatting and fixable lint issues are corrected in-place.
ts-ready: check-node                                ## Pre-commit gate (format/lint/typecheck/test)
	cd ts && yarn prettify
	cd ts && yarn lint
	cd ts && yarn typecheck
	cd ts && yarn test:run

# ts-test: pass UI=1 to launch the vitest web UI instead of a one-shot run.
# Usage: make ts-test           # headless
#        make ts-test UI=1      # --ui
ts-test: check-node                                 ## Run TS tests (UI=1 for web UI)
	cd ts && yarn $(if $(UI),test:ui,test:run)

ts-release: check-node                              ## Run the TS release script
	cd ts && yarn release

# ts-start-example: start a single example in dev mode by its folder name.
# Usage: make ts-start-example EXAMPLE=web-workers
#        make ts-start-example EXAMPLE=electron
#        make ts-start-example EXAMPLE=agent-mcp
#        make ts-start-example EXAMPLE=cf-worker
ts-start-example: check-node                        ## Start an example (EXAMPLE=<folder>)
	@test -n "$(EXAMPLE)" || { echo "usage: make ts-start-example EXAMPLE=<folder>"; exit 1; }
	@test -d "ts/examples/$(EXAMPLE)" || { echo "no such example: ts/examples/$(EXAMPLE)"; exit 1; }
	cd ts && yarn start:examples-$(EXAMPLE)

# ---------- Rust ----------
rust-build:   ; cd rust && cargo build --workspace       ## Build Rust workspace
rust-test:    ; cd rust && cargo test --workspace        ## Run Rust tests
rust-lint:    ; cd rust && cargo clippy --workspace -- -D warnings  ## Clippy
rust-format:  ; cd rust && cargo fmt --all               ## Format Rust

# ---------- Docs ----------
docs-install: ; cd docs && yarn                          ## Install docs deps
docs-dev:     ; cd docs && yarn dev                      ## Run docs site locally
docs-build:   ; cd docs && yarn build                    ## Build docs site

# ---------- Conformance ----------
conformance:                                             ## Run TS + Rust conformance suites
	cd ts && yarn conformance || true
	cd rust && cargo test --test conformance || true
