# Contributing

Thanks for contributing to Google Calendar and Tasks Sync.

## Quick start

1. Fork and clone the repo.
2. Install dependencies:

```bash
npm install
```

3. Run a production build check:

```bash
npm run build
```

4. Run unit tests:

```bash
npm run test:unit
```

## Pull request checklist

- Keep changes scoped and explain user impact.
- Update docs when behavior changes.
- Ensure `npm run build` and `npm run test:unit` pass.
- Avoid introducing telemetry or hidden network behavior.
- Follow Obsidian plugin safety conventions.

## Release notes

Maintainers should keep release artifacts aligned with `manifest.json` version and include:

- `main.js`
- `manifest.json`
- `styles.css` (if present)
