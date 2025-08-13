# Baitdash Monorepo

- apps/web: Next.js web app
- apps/api: API gateway for Uber Direct
- packages/env: shared typed env loader

## Dev
corepack enable
pnpm install
pnpm dev

## Deploy (Vercel)
Create two projects from this repo:
- API: Root Directory `apps/api`
- Web: Root Directory `apps/web`
