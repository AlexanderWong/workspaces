# REST API — Async Job Queue

A production-ready REST API built with **Node.js** and **TypeScript**. Clients submit jobs over HTTP; a background worker pool processes them asynchronously while a status endpoint tracks progress.

Designed for deployment to **GitHub** (with CI) and **DigitalOcean App Platform**.

## Features

- **Job submission** — `POST /api/v1/jobs` accepts a payload and returns a job ID immediately (`202 Accepted`)
- **Background worker pool** — configurable concurrency; mock processor simulates work with `sleep`
- **Status API** — `GET /api/v1/jobs/:id` returns `queued`, `running`, `completed`, or `failed` plus result/error
- **Web dashboard** — simple UI at `/` to submit jobs, poll status, and inspect results
- **Health check** — `GET /health` for load balancers and App Platform probes
- **Concurrency control** — mutex-protected job state and queue operations
- **Automated retries** — transient failures are retried with configurable backoff; permanent failures fail immediately
- **Split deployment** — API and worker run as separate DigitalOcean components sharing Redis

## Architecture

### Flow diagram

```mermaid
sequenceDiagram
    participant Client
    participant HTTP as Express (HTTP Layer)
    participant Controller
    participant Service
    participant Repo as Job Repository
    participant Queue as Job Queue
    participant Worker as Worker Pool
    participant Processor as Mock Processor

    Client->>HTTP: POST /api/v1/jobs payload
    HTTP->>Controller: submit(req.body)
    Controller->>Service: submitJob(payload)
    Service->>Repo: create(payload), status queued
    Service->>Queue: enqueue(jobId)
    Service-->>Controller: job
    Controller-->>Client: 202 Accepted with job id and status

    Note over Repo,Queue: In-memory locally, Redis when REDIS_URL is set
    Note over Worker,Processor: Decoupled background execution

    loop Each worker concurrency N
        Worker->>Queue: dequeue(pollIntervalMs)
        Queue-->>Worker: jobId or null
        Worker->>Repo: markRunning(jobId)
        Worker->>Processor: process(job.payload)
        alt Success
            Processor-->>Worker: result
            Worker->>Repo: markCompleted(jobId, result)
        else Transient failure retries remaining
            Processor-->>Worker: TransientProcessingError
            Worker->>Repo: requeueForRetry(jobId)
            Note over Worker: backoff RETRY_BACKOFF_MS
            Worker->>Queue: enqueue(jobId)
        else Permanent failure or max retries exceeded
            Processor-->>Worker: error
            Worker->>Repo: markFailed(jobId, error)
        end
    end

    Client->>HTTP: GET /api/v1/jobs/:id
    HTTP->>Controller: getStatus(id)
    Controller->>Service: getJob(id)
    Service->>Repo: findById(id)
    Repo-->>Service: job
    Service-->>Controller: job
    Controller-->>Client: 200 status result or error
```

### Layer responsibilities

| Layer | Responsibility |
|-------|----------------|
| `routes/` | HTTP routing and request validation |
| `controllers/` | Request/response mapping |
| `services/` | Business logic (submit, lookup) |
| `storage/` | Factory — in-memory (local) or Redis (split deploy) |
| `repositories/` | Job persistence (mutex-protected in-memory; Redis in production) |
| `queue/` | Async FIFO job queue (mutex-protected in-memory; Redis in production) |
| `workers/` | Worker pool and job processor |
| `concurrency/` | `AsyncMutex` for safe in-memory shared-state access |

### Concurrency control

HTTP handlers and background workers share the same job store and queue. Locally (no `REDIS_URL`), both live in process memory; in split deploy, API and worker processes share Redis via `createJobStorage()`.

- **In-memory (local dev)** — repository and queue operations run inside `AsyncMutex.runExclusive()` blocks so concurrent HTTP polls and worker updates cannot interleave.
- **Redis (production)** — repository and queue use Redis commands; no in-process mutex is needed because state is externalized.
- **Status guards** — transitions enforce a strict lifecycle (`queued` → `running` → `completed`/`failed`); concurrent `markRunning` calls on the same job only succeed once.

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
| `shouldFail` | boolean (optional) | Permanent failure (not retried) |
| `transientFailureCount` | number (optional) | Simulate N transient failures before success (for testing retries) |
| `data` | object (optional) | Arbitrary payload echoed in the result |

### Retry behavior

When the processor throws a `TransientProcessingError`:

1. Worker increments `retryCount` and resets status to `queued`
2. Waits `RETRY_BACKOFF_MS`, then re-enqueues the job
3. Repeats until success or `retryCount > maxRetries` (then marks `failed`)

Permanent errors (`shouldFail: true`) skip retries and fail immediately.

```bash
# Simulate 2 transient failures before succeeding (requires MAX_JOB_RETRIES >= 2)
curl -X POST http://localhost:8080/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"sleepMs": 500, "transientFailureCount": 2}'
```

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

## Web dashboard

With the API running, open `http://localhost:8080/` in a browser.

The dashboard lets you:

- Submit jobs with `sleepMs`, optional JSON payload, and failure simulation flags
- Poll job status automatically until `completed` or `failed`
- Look up any job by ID
- Review jobs submitted during the current browser session

Static assets live in `public/` and are served by the same Express process as the API (no separate frontend build step).

## Setup

**Requirements:** Node.js 20+

```bash
git clone <your-repo-url>
cd <repo-directory>   # folder created by git clone (package name is rest-api, not the directory)
npm install
npm run dev           # http://localhost:8080 — see Execution below for other modes
```

## Execution

### Development

```bash
npm run dev
```

Server runs at `http://localhost:8080` with hot reload.

### Production (single process — local)

```bash
npm run build
npm start          # API + embedded workers (in-memory storage)
```

### Production (split API + worker — requires Redis)

```bash
export REDIS_URL=redis://localhost:6379

npm run build
npm run start:api     # HTTP only, WORKERS_ENABLED=false
npm run start:worker  # background workers only
```

### Example workflow

```bash
# Submit a job
curl -X POST http://localhost:8080/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"sleepMs": 2000, "data": {"task": "demo"}}'

# Poll for status (replace JOB_ID)
curl http://localhost:8080/api/v1/jobs/JOB_ID
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run API with embedded workers (local/single-instance) |
| `npm run start:api` | Run HTTP API only (no workers) |
| `npm run start:worker` | Run worker process only (requires `REDIS_URL`) |
| `npm test` | Run all tests (unit + integration) |
| `npm run test:unit` | Run worker/repository unit tests |
| `npm run test:integration` | Run HTTP API integration tests |
| `npm run lint` | Lint source and tests |
| `npm run typecheck` | Type-check without emitting |

## Testing

Tests are split by scope:

| Suite | Location | Covers |
|-------|----------|--------|
| Unit | `tests/unit/` | Worker pool lifecycle, processor mock logic, repository concurrency |
| Unit (Redis) | `tests/unit/redis-*.test.ts`, `storage.test.ts` | Redis repository, queue, storage factory, failure injection |
| Integration | `tests/integration/` | Full HTTP request/response flow via supertest |
| Integration (Redis) | `tests/integration/redis-jobs.test.ts` | Split API + worker sharing FakeRedis (simulates DO production) |

```bash
npm test                 # all tests
npm run test:unit        # unit only
npm run test:integration # integration only
npm run test:redis       # Redis-specific tests only
```

Redis tests use `FakeRedis` (in-memory stand-in) so CI does not require a live Redis server. Optional: run against real Redis locally with `REDIS_URL=redis://localhost:6379`.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

1. `npm ci`
2. `npm run typecheck`
3. `npm run lint`
4. `npm test`
5. `npm run build`

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port (DigitalOcean sets this automatically) |
| `NODE_ENV` | `development` | Runtime environment |
| `API_PREFIX` | `/api/v1` | API route prefix |
| `WORKER_CONCURRENCY` | `2` | Number of concurrent background workers |
| `WORKER_POLL_INTERVAL_MS` | `250` | Queue poll interval when idle |
| `DEFAULT_JOB_SLEEP_MS` | `1000` | Default simulated work duration |
| `MAX_JOB_RETRIES` | `3` | Max automatic retries for transient failures |
| `RETRY_BACKOFF_MS` | `1000` | Delay before re-enqueueing a failed job |
| `WORKERS_ENABLED` | `true` | Set `false` on API service when workers run separately |
| `REDIS_URL` | — | Redis URL (required for split API/worker deployment) |

## Deploy to DigitalOcean App Platform

The included [`.do/app.yaml`](.do/app.yaml) defines three components:

| Component | Type | Run command | Purpose |
|-----------|------|-------------|---------|
| `api` | Web service | `npm run start:api` | Accepts job submissions, serves status API |
| `worker` | Worker | `npm run start:worker` | Processes jobs from the shared queue |
| `job-queue-redis` | Redis 7 | — | Shared job store and queue |

### Option 1: DigitalOcean control panel

1. Push this repo to GitHub (`AlexanderWong/workspaces`).
2. Go to [DigitalOcean Apps](https://cloud.digitalocean.com/apps) → **Create App** → **GitHub**.
3. Select the repo and branch `main`.
4. App Platform reads `.do/app.yaml` automatically, or set manually:
   - **API service:** build `npm run build`, run `npm run start:api`, port `8080`, health check `/health`
   - **Worker service:** build `npm run build`, run `npm run start:worker`
   - **Database:** add a Redis 7 cluster; bind `REDIS_URL` to both components
5. Set env vars on both services: `MAX_JOB_RETRIES=3`, `RETRY_BACKOFF_MS=1000`
6. Deploy.

### Option 2: doctl CLI

```bash
# Authenticate (one-time)
doctl auth init

# Create the app from the spec
doctl apps create --spec .do/app.yaml

# Watch deployment progress
doctl apps list
doctl apps get <APP_ID> --format DefaultIngress --no-header
```

### Verify deployment

```bash
# Replace with your App Platform URL
APP_URL=https://your-app.ondigitalocean.app

curl -X POST "$APP_URL/api/v1/jobs" \
  -H "Content-Type: application/json" \
  -d '{"sleepMs": 1000, "transientFailureCount": 1}'

curl "$APP_URL/api/v1/jobs/<JOB_ID>"
curl "$APP_URL/health"
```

## Known limitations

| Limitation | Detail |
|------------|--------|
| **In-memory storage (local)** | Without `REDIS_URL`, jobs live in process memory — fine for dev, not for split deploy |
| **Redis required for split deploy** | API and worker processes must share a Redis instance |
| **Polling required** | Clients must poll `GET /jobs/:id`; no webhooks or SSE |
| **No authentication** | All endpoints are public |
| **No rate limiting** | Unlimited job submission |
| **Mock processor** | Work is simulated via `sleep`; replace `MockJobProcessor` for real workloads |
| **Best-effort shutdown** | In-flight jobs may be interrupted on deploy/restart |

## License

MIT
