# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` (entry: `main.tsx`, app: `App.tsx`, styles: `index.css`, assets: `src/assets/`).
- Static assets: `public/` (served as-is by Vite).
- Build output: `dist/` (ignored by Git; do not commit).
- Config: `vite.config.ts`, `eslint.config.js`, `tsconfig*.json`, `index.html`.
- Architecture: single-page React + TypeScript app. CSV/XLSX is parsed client-side and state persisted in `localStorage`; no backend.

## Build, Test, and Development Commands
- `npm run dev`: Start Vite dev server with React Fast Refresh.
- `npm run build`: Type-check (`tsc -b`) and build production assets to `dist/`.
- `npm run preview`: Serve the production build locally to verify output.
- `npm run lint`: Run ESLint on the project; fix issues before pushing.

## Coding Style & Naming Conventions
- Language: TypeScript, React function components and hooks.
- Indentation: 2 spaces; use semicolons; single quotes in TS/TSX imports.
- Naming: `PascalCase` for components (`CustomerModal`), `camelCase` for variables/functions, UPPER_SNAKE_CASE for constants.
- Linting: ESLint with `@eslint/js`, `typescript-eslint`, `react-hooks`, and `react-refresh` rules. Keep hooks rules clean and avoid unused vars.

## Testing Guidelines
- No test runner is configured yet. Prefer adding unit tests with Vitest + React Testing Library.
- Suggested pattern: `src/**/*.test.ts(x)` colocated with code.
- Manual checks: run `npm run dev`, upload sample CSV/XLSX, verify KPIs, charts, grid columns, and `localStorage` persistence.

## Commit & Pull Request Guidelines
- Commits: short, imperative summaries (e.g., `fix: handle date gaps`, `feat: cohort retention view`). Keep to ~50 chars; follow up with details if needed.
- PRs: include purpose, before/after screenshots for UI, reproduction steps, and linked issues. Ensure `npm run lint && npm run build` pass.
- Do not commit `dist/` or environment-specific files. Small, focused PRs are preferred.

## Security & Configuration Tips
- Deployment: GitHub Pages workflow builds on `main`. Keep `package.json#homepage` and `vite.config.ts#base` aligned with repo name (`/customer-analysis/`).
- Data stays local in-browser; avoid adding secrets or external network calls.
- Validate CSV/XLSX headers and dates; handle malformed rows defensively.
