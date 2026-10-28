# Codr

Self-hosted platform for local competitive coding contests. Participants write and run code in the browser against test cases; organizers author questions in structured forms and configure timed contests. Everything, including the code-execution sandbox, runs on one machine with `docker compose up`, and it works on a LAN without internet after the first start.

> Work in progress. Full setup, architecture and authoring guides are being written as the phases land.

## Quick start

```sh
cp .env.example .env        # optional; every value has a default
docker compose up -d
```

Open http://localhost:3000 and sign in as `admin` / `codr-admin` (change it under **Users**).

The first start needs internet once: Docker pulls the images and the runner downloads the language packages (Python, C/C++, Java and JavaScript by default) into a persistent volume. After that, everything works offline.

## Development

```sh
npm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db runner
npm run dev            # API on :3000 (watch mode) + Vite on :5173
npm test               # unit + integration tests (needs the dev database)
```
