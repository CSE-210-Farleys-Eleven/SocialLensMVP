import { ADAPTERS_SCHEMA_VERSION } from './contract';
import type {
  Adapter,
  AdapterContext,
  AdapterIssue,
  AdapterItem,
  AdapterOutput,
  AdapterPipeline,
  AdapterRequest,
  AdapterResult,
  CoverageEntry,
} from './contract';
import { createContext } from './context';
import { createAtprotoAdapter } from './atproto';
import { createBlueskyAdapter } from './bluesky';
import { createFixturesAdapter, type FixtureScenario } from './fixtures';
import { issue } from './util';

/** Real network: atproto first (identity + records), then bluesky (counts). */
export function createLivePipeline(): AdapterPipeline {
  return [[createAtprotoAdapter()], [createBlueskyAdapter()]];
}

/** Offline: the synthetic account only. Same output shape as live. */
export function createFixturePipeline(scenario: FixtureScenario = 'typical'): AdapterPipeline {
  return [[createFixturesAdapter(scenario)]];
}

export interface CollectOptions {
  pipeline?: AdapterPipeline;
  /** Partial context; defaults fill the rest. */
  context?: Partial<AdapterContext>;
}

async function runOne(ctx: AdapterContext, req: AdapterRequest, upstream: readonly AdapterItem[], a: Adapter): Promise<AdapterOutput> {
  try {
    return await a.run(ctx, req, upstream);
  } catch (err) {
    // Adapters should never throw. If one does, contain it: one broken source
    // must not take the others down.
    if (ctx.signal?.aborted) {
      return { items: [], issues: [issue(a.id, 'aborted', 'warning', `${a.id}: cancelled.`)], coverage: [] };
    }
    const reason = err instanceof Error ? err.name : 'unknown error';
    return { items: [], issues: [issue(a.id, 'adapter-crashed', 'error', `${a.id} adapter crashed (${reason}).`)], coverage: [] };
  }
}

/**
 * THE entry point of the adapters module. Never rejects.
 *
 * Runs the pipeline stage by stage; adapters in a stage run in parallel
 * (allSettled semantics) and later stages see earlier stages' items. All
 * output is merged into ONE flat `items` list.
 */
export async function collect(req: AdapterRequest, opts: CollectOptions = {}): Promise<AdapterResult> {
  const ctx = createContext(opts.context);
  const pipeline = opts.pipeline ?? createLivePipeline();
  const items: AdapterItem[] = [];
  const issues: AdapterIssue[] = [];
  const coverage: CoverageEntry[] = [];
  const ran: string[] = [];
  const startedAt = ctx.now().toISOString();

  if (!req?.subject || (!req.subject.did && !req.subject.handle)) {
    issues.push(issue('collector', 'invalid-request', 'error', 'A DID or handle is required.'));
  } else {
    for (const stage of pipeline) {
      const outs = await Promise.all(stage.map((a) => runOne(ctx, req, items, a)));
      stage.forEach((a, i) => {
        ran.push(a.id);
        const o = outs[i]!;
        items.push(...o.items);
        issues.push(...o.issues);
        coverage.push(...o.coverage);
      });
    }
  }

  const identity = items.find((i) => i.kind === 'identity');
  const subject = {
    did: identity?.did ?? req?.subject?.did ?? null,
    handle: identity?.handle ?? req?.subject?.handle ?? null,
    pdsUrl: identity?.pdsUrl ?? null,
  };
  return {
    schemaVersion: ADAPTERS_SCHEMA_VERSION,
    subject,
    fetchedAt: startedAt,
    items,
    issues,
    coverage,
    adapters: ran,
    complete: !issues.some((i) => i.severity === 'error' || i.code === 'aborted') && coverage.every((c) => c.complete),
  };
}
