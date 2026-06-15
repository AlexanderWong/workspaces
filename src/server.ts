/** Process entry point — starts the HTTP server and handles graceful shutdown. */
import { createApp } from './app';
import { env } from './config/env';

const { app, workerPool } = createApp(env);

// Bind to 0.0.0.0 so DigitalOcean / container platforms can reach the app
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`Worker pool started with concurrency ${env.WORKER_CONCURRENCY}`);
});

/** Stop accepting requests, drain workers, then exit (used by App Platform deploys). */
async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);

  server.close(async () => {
    await workerPool.stop();
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit if workers don't finish within 10 s
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
