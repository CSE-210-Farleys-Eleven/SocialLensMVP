import type { AnalyticsInput, AnalyticsResult } from './contract';

type AnalyticsWorker = Pick<Worker, 'onmessage' | 'onmessageerror' | 'onerror' | 'postMessage' | 'terminate'>;

/** Analyze one snapshot in a dedicated worker. A failed or cancelled run yields null. */
export async function analyzeInWorker(
  input: AnalyticsInput,
  createWorker: () => AnalyticsWorker,
  signal?: AbortSignal,
): Promise<AnalyticsResult | null> {
  if (signal?.aborted) return null;

  let worker: AnalyticsWorker;
  try {
    worker = createWorker();
  } catch {
    return null;
  }

  return new Promise(resolve => {
    function finish(result: AnalyticsResult | null): void {
      signal?.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onmessageerror = null;
      worker.onerror = null;
      worker.terminate();
      resolve(result);
    }

    function cancel(): void {
      finish(null);
    }

    worker.onmessage = (event: MessageEvent<AnalyticsResult>) => finish(event.data);
    worker.onmessageerror = cancel;
    worker.onerror = cancel;
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }

    try {
      worker.postMessage(input);
    } catch {
      cancel();
    }
  });
}
