import type { Adapter, AdapterItem, AdapterOutput } from '../contract';
import { createAtprotoAdapter } from '../atproto';
import { createBlueskyAdapter } from '../bluesky';
import { FIXTURE_DID, type FixtureScenario } from './data';
import { createFixtureFetch } from './fetch';

/**
 * Fixtures adapter: the synthetic account, served through the REAL atproto and
 * bluesky adapters running over a fake network. Because it reuses the live
 * code, it is a drop-in for the live pipeline by construction (same coverage,
 * same issues, same degradation), and it can never drift from it.
 *
 * It ignores the request's subject: the fixture account is the only one that
 * exists. Every item, issue and coverage entry is relabelled `source:
 * 'fixtures'` so nothing synthetic can be mistaken for live data.
 */
export function createFixturesAdapter(scenario: FixtureScenario = 'typical'): Adapter {
  const atproto = createAtprotoAdapter();
  const bluesky = createBlueskyAdapter();
  return {
    id: 'fixtures',
    async run(ctx, req): Promise<AdapterOutput> {
      const fx = createFixtureFetch(scenario);
      const inner = {
        ...ctx,
        fetch: fx.fetch,
        sleep: async () => {}, // the fake network never needs real waiting
        endpoints: { plcDirectory: 'https://plc.directory', appView: 'https://public.api.bsky.app' },
        allowInsecureHosts: false,
      };
      // Never forward real credentials into the fake network.
      const { session: _ignored, ...rest } = req;
      const r = { ...rest, subject: { did: FIXTURE_DID } };

      const a = await atproto.run(inner, r, []);
      const b = await bluesky.run(inner, r, a.items);

      const relabel = <T extends { source: string }>(x: T): T => ({ ...x, source: 'fixtures' });
      return {
        items: [...a.items, ...b.items].map((i) => relabel(i) as AdapterItem),
        issues: [...a.issues, ...b.issues].map((i) => ({ ...relabel(i), message: `[synthetic] ${i.message}` })),
        coverage: [...a.coverage, ...b.coverage].map(relabel),
      };
    },
  };
}

export { createFixtureFetch, type FixtureFetch } from './fetch';
export {
  buildDataset,
  FIXTURE_SCENARIOS,
  FIXTURE_DID,
  FIXTURE_HANDLE,
  FIXTURE_PDS,
  type FixtureScenario,
  type FixtureDataset,
} from './data';
