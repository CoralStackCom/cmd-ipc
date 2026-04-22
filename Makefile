.PHONY: help check-node \
        install build test ready clean \
        ts-setup ts-build ts-ready ts-test ts-release ts-start-example \
        rust-build rust-test rust-lint rust-format rs-ready rs-start-example \
        docs-install docs-dev docs-build \
        conformance spec-format spec-check-format

help:             ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# When the user invokes a start-example target, capture the next word on
# the command line as the example name and forge it as a no-op target
# (otherwise make would try to build it as a real target and fail).
# Scoped to these targets only — no global catch-all — so typos of other
# targets still error loudly as expected.
ifneq (,$(filter rs-start-example ts-start-example,$(MAKECMDGOALS)))
EXAMPLE_NAME := $(word 2,$(MAKECMDGOALS))
ifneq (,$(EXAMPLE_NAME))
$(eval $(EXAMPLE_NAME):;@:)
endif
endif

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
ready: ts-ready rs-ready spec-check-format          ## Pre-commit gate for both languages

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
# Usage: make ts-start-example web-workers
#        make ts-start-example electron
#        make ts-start-example agent-mcp
#        make ts-start-example cf-worker
ts-start-example: check-node                        ## Start a TS example: make ts-start-example <folder>
	@test -n "$(EXAMPLE_NAME)" || { echo "usage: make ts-start-example <folder>"; exit 1; }
	@test -d "ts/examples/$(EXAMPLE_NAME)" || { echo "no such example: ts/examples/$(EXAMPLE_NAME)"; exit 1; }
	cd ts && yarn start:examples-$(EXAMPLE_NAME)

# ---------- Rust ----------
rust-build:   ; cd rust && cargo build --workspace                       ## Build Rust workspace
rust-test:    ; cd rust && cargo test --workspace                        ## Run Rust tests
rust-lint:    ; cd rust && cargo clippy --workspace --all-targets -- -D warnings  ## Clippy (-D warnings)
rust-format:  ; cd rust && cargo fmt --all                               ## Format Rust

# rs-ready: fmt (auto-fix) + clippy + tests. Parallel to ts-ready.
# Fails only on unfixable lint errors, test failures, or build errors.
rs-ready: rust-format rust-lint rust-test                                ## Rust pre-commit gate (fmt/clippy/test)

# rs-start-example: run one example binary by folder name.
# Usage: make rs-start-example multi-service
rs-start-example:                                                        ## Start a Rust example: make rs-start-example <folder>
	@test -n "$(EXAMPLE_NAME)" || { echo "usage: make rs-start-example <folder>"; exit 1; }
	@test -d "rust/examples/$(EXAMPLE_NAME)" || { echo "no such example: rust/examples/$(EXAMPLE_NAME)"; exit 1; }
	cd rust && cargo run -p $(EXAMPLE_NAME)

# ---------- Docs ----------
docs-install: ; cd docs && yarn                          ## Install docs deps
docs-dev:     ; cd docs && yarn dev                      ## Run docs site locally
docs-build:   ; cd docs && yarn build                    ## Build docs site

# ---------- Conformance ----------
conformance:                                             ## Run TS + Rust conformance suites
	cd ts && yarn conformance || true
	cd rust && cargo test --test conformance || true

# Reformat every JSON file under spec/ (schemas + conformance vectors) using
# the TypeScript workspace's prettier config — keeps diffs minimal and
# consistent across both language harnesses.
spec-format:                                             ## Format spec/*.json with prettier
	cd ts && yarn prettier '../spec/**/*.json' -w

# Fail if any spec/*.json is not prettier-clean. Wired into the ready gate.
spec-check-format:                                       ## Check spec/*.json is prettier-formatted
	cd ts && yarn prettier '../spec/**/*.json' --check
