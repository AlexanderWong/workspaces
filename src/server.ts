import { createApp } from './app';
import { env } from './config/env';

const { app, workerPool } = createApp(env);

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`Worker pool started with concurrency ${env.WORKER_CONCURRENCY}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);

  server.close(async () => {
    await workerPool.stop();
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
