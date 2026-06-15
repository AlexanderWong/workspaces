/** Thrown by processors to signal a retryable failure (network blip, timeout, etc.). */
export class TransientProcessingError extends Error {
  constructor(message = 'Simulated transient processing error') {
    super(message);
    this.name = 'TransientProcessingError';
  }
}

export function isTransientProcessingError(error: unknown): error is TransientProcessingError {
  return error instanceof TransientProcessingError;
}
