import type { AnalyticsInput, AnalyticsResult } from './contract';
import { analyze } from './index';

const worker = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<AnalyticsInput>) => void): void;
  postMessage(result: AnalyticsResult): void;
};

worker.addEventListener('message', ({ data }) => worker.postMessage(analyze(data)));
