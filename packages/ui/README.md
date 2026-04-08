# @agentfile/ui

> **Beta** — this package is in early development. APIs and behaviour may change between releases. Install explicitly with `npm install @agentfile/ui@beta`.

Local dashboard for [agentfile](https://github.com/dennishavermans/agentfile) — an interactive browser UI for inspecting your contract, previewing generated agent files, and monitoring manifest drift.

## Usage

The dashboard is started via the CLI:

```bash
npx @agentfile/cli ui
npx @agentfile/cli ui --port 3000
npx @agentfile/cli ui --root ./packages/app
```

Browse to `http://localhost:4311` (or your chosen port) once the server is running.

## Programmatic usage

`@agentfile/ui` exports a `startUiServer` function for embedding the dashboard in your own tooling:

```typescript
import { startUiServer } from "@agentfile/ui";

await startUiServer({
  root: process.cwd(),   // project root to inspect
  port: 4311,            // default: 4311
  dev: false,            // set true in development to skip the build step
  openBrowser: true,     // auto-open the dashboard on start
});
```

## Links

- [Full documentation](https://github.com/dennishavermans/agentfile)
- [CLI](https://www.npmjs.com/package/@agentfile/cli)

## License

MIT
