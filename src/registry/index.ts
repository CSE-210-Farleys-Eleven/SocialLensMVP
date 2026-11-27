// Public surface of the module: other parts of the app import only from here.
export { loadAccounts } from './accounts';
export { KNOWN_APPS, buildRegistry, collectionsToRequest, appIdOf, lookupApp } from './registry';
export type * from './contract';

// Typical use:
//   const out = await loadAccounts({ info, fetch: session.fetchHandler });
//   const results = await Promise.all(out.accounts.map((a) => collect(a.request)));