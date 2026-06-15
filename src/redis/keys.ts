/** Redis key names for the production job queue. */
export const QUEUE_KEY = 'jobs:queue';
export const INFLIGHT_KEY = 'jobs:inflight';
export const DLQ_KEY = 'jobs:dlq';

export const jobKey = (id: string): string => `job:${id}`;
