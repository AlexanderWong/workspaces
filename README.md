# REST API — Async Job Queue

A production-ready REST API built with **Node.js** and **TypeScript**. Clients submit jobs over HTTP; a background worker pool processes them asynchronously while a status endpoint tracks progress.

Designed for deployment to **DigitalOcean App Platform** and source control on **GitHub**.

## Features

- **Job submission** — `POST /api/v1/jobs` accepts a payload and returns a job ID immediately (`202 Accepted`)
- **Background worker pool** — configurable concurrency; mock processor simulates work with `sleep`
- **Status API** — `GET /api/v1/jobs/:id` returns `queued`, `running`, `completed`, or `failed` plus result/error
- **Health check** — `GET /health` for load balancers and App Platform probes

## Architecture

```
HTTP Request → Controller → Service → Repository (persist job)
                              ↓
                         Job Queue (enqueue)
                              ↓
                    Worker Pool → Processor (mock sleep)
                              ↓
                         Repository (update status)
```

| Layer | Responsibility |
|-------|----------------|
| `routes/` | HTTP routing and request validation |
| `controllers/` | Request/response mapping |
| `services/` | Business logic (submit, lookup) |
| `repositories/` | Job persistence |
| `queue/` | Async job queue |
| `workers/` | Worker pool and job processor |

## API

### Submit a job

```http
POST /api/v1/jobs
Content-Type: application/json

{
  "sleepMs": 2000,
  "data": { "task": "process-report" }
}
```

**Response `202 Accepted`**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "queued"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sleepMs` | number (optional) | Simulated work duration in ms (default: `1000`) |
| `shouldFail` | boolean (optional) | Force failure for testing |
| `data` | object (optional) | Arbitrary payload echoed in the result |

### Get job status

```http
GET /api/v1/jobs/:id
```

**Response `200 OK`**

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "payload": { "sleepMs": 2000, "data": { "task": "process-report" } },
    "result": {
      "processedAt": "2026-06-15T12:00:02.000Z",
      "sleepMs": 2000,
      "message": "Job completed successfully",
      "input": { "sleepMs": 2000, "data": { "task": "process-report" } }
    },
    "error": null,
    "createdAt": "2026-06-15T12:00:00.000Z",
    "updatedAt": "2026-06-15T12:00:02.000Z",
    "startedAt": "2026-06-15T12:00:00.100Z",
    "completedAt": "2026-06-15T12:00:02.000Z"
  }
}
```

### Health check

```http
GET /health
```

## Local development

**Requirements:** Node.js 20+

```bash
npm install
npm run dev
```

Server runs at `http://localhost:8080`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run production build |
| `npm test` | Run test suite |
| `npm run lint` | Lint source and tests |
| `npm run typecheck` | Type-check without emitting |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port (DigitalOcean sets this automatically) |
| `NODE_ENV` | `development` | Runtime environment |
| `API_PREFIX` | `/api/v1` | API route prefix |
| `WORKER_CONCURRENCY` | `2` | Number of concurrent background workers |
| `WORKER_POLL_INTERVAL_MS` | `250` | Queue poll interval when idle |
| `DEFAULT_JOB_SLEEP_MS` | `1000` | Default simulated work duration |

## Deploy to DigitalOcean App Platform

1. Push this repository to GitHub.
2. In the [DigitalOcean control panel](https://cloud.digitalocean.com/apps), create a new **App** and connect your GitHub repo.
3. App Platform detects Node.js from `package.json`. Build and run commands:
   - **Build command:** `npm run build`
   - **Run command:** `npm start`
4. Set the HTTP port to **8080** (or rely on the `PORT` env var App Platform injects).
5. Configure the health check path to `/health`.

Alternatively, use the included spec file after updating the repo name:

```bash
# Edit .do/app.yaml — replace YOUR_GITHUB_USERNAME/YOUR_REPO_NAME
doctl apps create --spec .do/app.yaml
```

## Deploy to GitHub

```bash
git init
git add .
git commit -m "Initial commit: async job queue REST API"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## License

MIT
