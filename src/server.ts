/** Process entry point — starts the HTTP server and optionally embedded workers. */
import { createApp } from './app';
import { env } from './config/env';

async function main(): Promise<void> {
  const { app, workerPool, close } = await createApp(env);

  // Bind to 0.0.0.0 so DigitalOcean / container platforms can reach the app
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
    if (env.WORKERS_ENABLED) {
      console.log(`Embedded worker pool started with concurrency ${env.WORKER_CONCURRENCY}`);
    } else {
      console.log('Workers disabled — run npm run start:worker separately');
    }
  });

  /** Stop accepting requests, drain workers, then exit (used by App Platform deploys). */
  async function shutdown(signal: string): Promise<void> {
    console.log(`Received ${signal}, shutting down gracefully...`);

    server.close(async () => {
      await close();
      console.log('Server closed');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  // Prevent unused variable warning when workers run embedded
  void workerPool;
}

void main();
