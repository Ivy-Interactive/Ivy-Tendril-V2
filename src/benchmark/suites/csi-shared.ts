// Helpers shared by the cli, startup and idle suites (not a suite itself: the runner only loads the
// names in SUITE_NAMES).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { errorMessage } from '../lib/log.ts';
import { TimeoutError } from '../lib/proc.ts';
import { toMiB } from '../lib/procstat.ts';
import type { AppId, Metric, SuiteResult, Unit } from '../lib/results.ts';

export { toMiB };

/**
 * Where V1's PathHelper.EnsureCliSymlink points the user's `tendril` command. Every V1 start from an
 * `.app` bundle (server and CLI alike) may rewrite these, so each suite that runs V1 snapshots them
 * before and after and says so if anything moved.
 */
const CLI_LINKS = ['/usr/local/bin/tendril', path.join(os.homedir(), '.local', 'bin', 'tendril')];

export type LinkState = Record<string, string | null>;

export function cliLinkState(): LinkState {
  const out: LinkState = {};
  for (const l of CLI_LINKS) {
    try {
      out[l] = fs.readlinkSync(l);
    } catch {
      out[l] = null;
    }
  }
  return out;
}

/** Adds a note either way, so the result shows the check ran; an unexpected change is loud. */
export function checkCliLinks(before: LinkState, r: SuiteResult, log: { error(...a: unknown[]): void }): void {
  const after = cliLinkState();
  const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
  if (changed.length) {
    const msg = `USER CLI SYMLINK CHANGED during the suite: ${changed.map((k) => `${k}: ${before[k] ?? 'absent'} -> ${after[k] ?? 'absent'}`).join('; ')}`;
    log.error(msg);
    r.notes.push(msg);
  } else {
    r.notes.push(`user CLI symlinks unchanged (${Object.entries(after).map(([k, v]) => `${k} -> ${v ?? 'absent'}`).join(', ')})`);
  }
}

/** Builds metrics for one suite and records failures with the dataset and scenario they belong to. */
export class Recorder {
  readonly r: SuiteResult;
  constructor(r: SuiteResult) {
    this.r = r;
  }

  metric(o: { scenario: string; app: AppId; dataset: string | null; metric: string; unit: Unit; samples: number[]; censored?: number[]; better?: 'lower' | 'higher'; meta?: Record<string, unknown> }): void {
    // A metric with no samples (and no timed-out ones) says nothing and trips validation; the
    // failure explaining why is recorded separately.
    if (!o.samples.length && !o.censored?.length) return;
    const m: Metric = {
      suite: this.r.suite,
      scenario: o.scenario,
      app: o.app,
      dataset: o.dataset,
      metric: o.metric,
      unit: o.unit,
      samples: o.samples,
      better: o.better ?? 'lower',
    };
    if (o.censored?.length) m.censored = o.censored;
    if (o.meta && Object.keys(o.meta).length) m.meta = o.meta;
    this.r.metrics.push(m);
  }

  fail(app: AppId, dataset: string | null, scenario: string, e: unknown): void {
    this.r.failures.push({ app, dataset, scenario, error: errorMessage(e) });
  }
}

export function round(x: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** Median of a non-empty list (for meta summaries only; the report does the real statistics). */
export function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Whether a failed sample ran out of time (a result: "not within the limit") rather than failing
 * for another reason. Timed-out samples are recorded as censored values at the limit.
 */
export function isTimeout(e: unknown): boolean {
  return e instanceof TimeoutError || (e instanceof Error && (e.name === 'TimeoutError' || /timed out|no exit within|within \d+ ms/i.test(e.message)));
}
