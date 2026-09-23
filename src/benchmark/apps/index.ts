// Adapter registry: the one place suites get an AppAdapter from (via suites/index.ts loadAdapters).

import type { AdapterOptions, AppAdapter, AppId } from './types.ts';
import { createV1Adapter } from './v1.ts';
import { createV2Adapter } from './v2.ts';

const FACTORIES: Record<AppId, (opts: AdapterOptions) => Promise<AppAdapter>> = {
  v1: createV1Adapter,
  v2: createV2Adapter,
};

/**
 * Builds the requested adapters in v1, v2 order. Throws when a binary an adapter cannot work
 * without is missing (the daemon/server binaries); optional pieces (IPC shim, desktop apps) only
 * fail the calls that need them, so e.g. the api suite still runs before the shim is built.
 */
export async function createAdapters(ids: readonly AppId[], opts: AdapterOptions): Promise<AppAdapter[]> {
  const out: AppAdapter[] = [];
  for (const id of ['v1', 'v2'] as const) {
    if (ids.includes(id)) out.push(await FACTORIES[id](opts));
  }
  return out;
}
