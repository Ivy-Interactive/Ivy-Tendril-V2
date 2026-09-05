# vite-plus-starter

A starter for creating a Vite Plus project.

## Development

- Install dependencies:

```bash
vp install
```

- Run the unit tests:

```bash
vp test
```

- Build the library:

```bash
vp pack
```

## Storybook

Component documentation and testing via Storybook.

- Run the development server:

```bash
pnpm run storybook
```

Opens at http://localhost:6006.

- Install Playwright browser binaries (one-time setup):

```bash
pnpm run test-storybook:install
```

Browser binaries are cached in `~/.cache/ms-playwright` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright` (Windows) and are not re-downloaded per clone.

- Run Storybook tests against a running dev server:

```bash
pnpm run test-storybook
```

- Run Storybook tests in CI mode (builds static files first):

```bash
pnpm run test-storybook:ci
```

### CI

The [storybook-tests.yml](.github/workflows/storybook-tests.yml) workflow runs on every push and pull request. It includes a caching step for Playwright browsers to avoid re-downloading on every run.
