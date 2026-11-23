/**
 * Adapters module: public API.
 *
 *   collect(request, options?) -> Promise<AdapterResult>
 *
 * Everything else is exported for tests and for people who want to compose
 * their own pipeline. Types live in ./contract.
 */
export * from './contract';
export { collect, createLivePipeline, createFixturePipeline, type CollectOptions } from './collect';
export { createContext } from './context';
export { createAtprotoAdapter } from './atproto';
export { createBlueskyAdapter } from './bluesky';
export {
  createFixturesAdapter,
  createFixtureFetch,
  FIXTURE_SCENARIOS,
  type FixtureScenario,
  type FixtureFetch,
} from './fixtures';
