import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsInput } from './contract';
import { analyze } from './index';
import { analyzeInWorker } from './worker-client';

const input: AnalyticsInput = {
  fetchedAt: '2026-11-26T19:00:00Z',
  posts: [{ createdAt: '2026-11-25T23:40:00Z', isReply: false, engagement: null }],
  coverage: [{ source: 'fixtures', collection: 'app.bsky.feed.post', fetched: 1, complete: true }],
};

function makeWorker() {
  return {
    onmessage: null as Worker['onmessage'],
    onmessageerror: null as Worker['onmessageerror'],
    onerror: null as Worker['onerror'],
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
}

describe('analyzeInWorker', () => {
  it('sends a snapshot, returns the existing result and terminates its worker', async () => {
    const worker = makeWorker();
    const result = analyze(input);
    const pending = analyzeInWorker(input, () => worker);
    expect(worker.postMessage).toHaveBeenCalledWith(input);

    worker.onmessage?.call({} as Worker, new MessageEvent('message', { data: result }));

    await expect(pending).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('skips worker creation for an already cancelled run', async () => {
    const createWorker = vi.fn(makeWorker);
    await expect(analyzeInWorker(input, createWorker, AbortSignal.abort())).resolves.toBeNull();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('stops a cancelled run and removes its result handler', async () => {
    const worker = makeWorker();
    const controller = new AbortController();
    const pending = analyzeInWorker(input, () => worker, controller.signal);
    controller.abort();

    await expect(pending).resolves.toBeNull();
    expect(worker.onmessage).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not send the snapshot if the run is cancelled during worker creation', async () => {
    const worker = makeWorker();
    const controller = new AbortController();
    const result = analyzeInWorker(input, () => {
      controller.abort();
      return worker;
    }, controller.signal);

    await expect(result).resolves.toBeNull();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports a worker construction failure as unavailable', async () => {
    await expect(analyzeInWorker(input, () => {
      throw new Error('Worker unavailable');
    })).resolves.toBeNull();
  });

  it('terminates the worker if it cannot send the input', async () => {
    const worker = makeWorker();
    worker.postMessage.mockImplementation(() => { throw new Error('Cannot send snapshot'); });

    await expect(analyzeInWorker(input, () => worker)).resolves.toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(['error', 'messageerror'] as const)('reports a worker %s as unavailable', async (type) => {
    const worker = makeWorker();
    const pending = analyzeInWorker(input, () => worker);
    if (type === 'error') {
      worker.onerror?.call({} as AbstractWorker, new Event(type) as ErrorEvent);
    } else {
      worker.onmessageerror?.call({} as Worker, new MessageEvent(type));
    }

    await expect(pending).resolves.toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
