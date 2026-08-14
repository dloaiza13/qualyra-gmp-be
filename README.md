# Qualyra GMP Backend

Backend API for Qualyra GMP, an audit-ready-by-design quality management SaaS for regulated organizations.

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- npm 11+

Docker-based local infrastructure and Prisma are intentionally deferred to Phase 2.

## Setup

```bash
npm ci
cp .env.example .env
npm run start:dev
```

The application listens on `http://localhost:3000` by default.

## Verification

```bash
npm run lint
npm run typecheck
npm run test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
npm run start:prod
```

## Architecture direction

The backend will evolve as a modular NestJS monolith with pragmatic ports and adapters, tenant-aware use cases, PostgreSQL row-level security, and an OpenAPI contract. Business logic must stay out of controllers.

## Security

Never commit secrets or real credentials. Qualyra GMP is being designed for future validation and traceability; this repository does not claim GMP, ISO, FDA, or 21 CFR Part 11 compliance.
