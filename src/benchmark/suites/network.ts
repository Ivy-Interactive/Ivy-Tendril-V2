// Suite `network`: how many bytes each architecture moves over sockets, per UI scenario.
//
// What crosses a socket differs by design:
//   V1  the page talks to the V1 server over loopback HTTP (assets, API) and SignalR WebSockets; in
//       the desktop app a WKWebView does exactly the same against the same Kestrel server. So the
//       browser <-> server leg IS V1's network traffic.
//   V2  the page talks to its Tauri host through in-process IPC and loads its assets from the app
//       bundle; the only sockets are host <-> daemon (loopback REST, a WebSocket and an SSE change
//       stream). Here the host is the IPC shim, which runs the app's real cmd_* handlers and bridges,
//       so what it sends the daemon is what tendril-app sends.
//
// Every leg is measured on the wire by a byte-counting proxy (lib/tcpproxy.ts):
//   V1  Chromium -> proxy -> V1 server                     leg "net" (and "ui": the same leg)
//   V2  Chromium -> proxy -> shim                          leg "ui": IPC + assets, not a socket in the real app
//       shim     -> proxy -> daemon                        leg "net": the real loopback traffic
// The like-for-like comparison of the two UIs is the "ui" leg (what the page exchanges with its
// backend, assets and data counted separately). The "net" leg is architecture-internal: for V1 it is
// the page itself (so it includes the assets), for V2 only host <-> daemon (no assets, no IPC).
// For V2 the shim must reach the daemon through the proxy without touching the daemon's own `.master`
// (the daemon rewrites it from memory on a 30 s heartbeat). The shim therefore runs with a shadow
// TENDRIL_HOME: a directory of symlinks to the real home's entries plus its own copy of `.master`
// with the port pointed at the proxy. Everything the host reads from the home (Plans/, Logs/, ...)
// still resolves to the real files; its ui_state.json stays in the shadow.
//
// Scenarios per dataset x app (one server, one fresh Chromium):
//   cold-load          fresh context: navigation start until the traffic has settled after content
//   nav:<view>         first visit of each view in that context, click until settled
//   idle               a settled warm page left alone: bytes per minute
//   push               REST PUT (harness -> server directly, not counted) toggling a Draft; what the
//                      UI side then receives until the badge has changed and traffic has settled
//   session            fresh context: load, visit every view, a few pushes, as one total
// plus, when the profile asks for it:
//   desktop-external     the external (non-loopback) traffic of the real desktop apps, sampled with
//                        nettop started before the app (and V2's daemon) is spawned, filtered to the
//                        app's process tree afterwards (a lower bound: nettop only sees sockets that
//                        are open when it samples)
//   real-host-cold-load  V2 only, a check of the shim: the real Tendril.app runs with a shadow
//                        TENDRIL_HOME whose .master points at a proxy in front of its daemon, and its
//                        host <-> daemon traffic after launch is compared with the shim's cold load
//
// "Settled" means no byte moved on either leg for QUIET_MS. Background traffic inside a window
// (V2's 5 s job poll, SignalR keep-alives) is part of the count; the idle scenario measures it.

import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { hasConnectionTo } from '../apps/common.ts';
import type { AppAdapter, NavTarget, ReadyCondition, ServerHandle, UiHandle } from '../apps/types.ts';
import { TIMEOUTS, type DatasetName } from '../lib/config.ts';
import { desktopHomesRoot, loadManifest, removeDesktopHomes, restoreHome, type DatasetManifest } from '../datasets/index.ts';
import { joinUrl, request } from '../lib/http.ts';
import { errorMessage, type Logger } from '../lib/log.ts';
import { isAlive, registerCleanup, sleep } from '../lib/proc.ts';
import { newSuiteResult, type AppId, type Metric, type SuiteResult, type Unit } from '../lib/results.ts';
import { CountingProxy, deltaCounters, topRoutes, type ProxyCounters } from '../lib/tcpproxy.ts';
import { descendantsFromTable } from '../lib/procstat.ts';
import type { SuiteContext } from './index.ts';

const SUITE = 'network';
/** Same browser setup as the ui suite. */
const VIEWPORT = { width: 1280, height: 800 };
const LAUNCH_ARGS = ['--enable-precise-memory-info'];
/**
 * Visit order, as in the ui suite: V1 marks plans and review with the same active-pane title, so
 * they are never visited back to back (the landing view is plans, the pass ends on plans).
 */
const NAV_ORDER: readonly NavTarget[] = ['jobs', 'review', 'dashboard', 'plans'];
/** No byte on either leg for this long = the scenario's traffic has settled. */
const QUIET_MS = 1500;
/** A scenario that never goes quiet is cut here (and flagged in meta). */
const SETTLE_MAX_MS = 20_000;
const SETTLE_POLL_MS = 50;
const WAIT_MS = TIMEOUTS.uiWaitMs;
const CLICK_TIMEOUT_MS = 30_000;
const TOP_ROUTES = 8;
/**
 * IPC failures that are not caused by the shadow home: the ui suite, which runs the shim on the
 * daemon's real home, sees the same ones.
 */
const KNOWN_IPC_FAILURES = 'cmd_list_all_recommendations is known V2 bug F1; cmd_get_verification_report finds no report file in the generated plans; both fail the same way in the ui suite, where the shim uses the real home';
const SHIM_LABEL = 'IPC shim (stand-in for the tendril-app host; not the Tauri binary)';

type Want = 'content' | 'empty' | 'any';
type Leg = 'net' | 'ui';

/** How long one call into the page may take beyond its own timeout before the page counts as hung. */
const PAGE_GRACE_MS = 30_000;

/** The page stopped answering: nothing more can be measured on it. */
class PageHung extends Error {}

/**
 * Bounds a Playwright call. evaluate has no timeout of its own, and a renderer whose main thread is
 * blocked can hold even a timed wait far past its limit, which would stall the whole run.
 */
async function bounded<T>(p: Promise<T>, what: string, limitMs = PAGE_GRACE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => {});
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PageHung(`${what}: the page did not answer within ${Math.round(limitMs / 1000)} s`)), limitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Taps: the proxies of one session and their settle logic

interface Taps {
  /** Loopback socket traffic of the shipped architecture (V1 browser<->server, V2 host<->daemon). */
  net: CountingProxy;
  /** What the page exchanges with its backend (V1: the same proxy; V2: browser<->shim). */
  ui: CountingProxy;
  /** Where Chromium goes. */
  pageUrl: string;
}

interface Snap {
  net: ProxyCounters;
  ui: ProxyCounters;
  /** V2 only: shim IPC calls the page has logged so far. */
  ipc: number | null;
}

function moved(t: Taps): number {
  return t.net === t.ui ? t.net.totalBytes() : t.net.totalBytes() + t.ui.totalBytes();
}

/** Waits until nothing has moved on either leg for QUIET_MS; returns how long that took. */
async function settle(t: Taps): Promise<{ ms: number; capped: boolean }> {
  const t0 = performance.now();
  let last = moved(t);
  let quietSince = performance.now();
  for (;;) {
    await sleep(SETTLE_POLL_MS);
    const now = performance.now();
    const m = moved(t);
    if (m !== last) {
      last = m;
      quietSince = now;
    } else if (now - quietSince >= QUIET_MS) return { ms: now - t0, capped: false };
    if (now - t0 >= SETTLE_MAX_MS) return { ms: now - t0, capped: true };
  }
}

async function snap(t: Taps, page: Page | null, app: AppId): Promise<Snap> {
  let ipc: number | null = null;
  if (page && app === 'v2') ipc = await bounded(page.evaluate(() => ((window as unknown as { __SHIM_IPC__?: unknown[] }).__SHIM_IPC__ ?? []).length), 'IPC count').catch(() => null);
  return { net: t.net.snapshot(), ui: t.ui.snapshot(), ipc };
}

// ---------------------------------------------------------------------------------------------
// Recording

interface Recorder {
  app: AppAdapter;
  ds: DatasetName;
  add(scenario: string, metric: string, unit: Unit, value: number, sampleMeta?: Record<string, unknown>): void;
  meta(scenario: string, metric: string, meta: Record<string, unknown>): void;
}

function makeRecorder(result: SuiteResult, app: AppAdapter, ds: DatasetName): Recorder {
  const byKey = new Map<string, Metric>();
  return {
    app,
    ds,
    add(scenario, metric, unit, value, sampleMeta) {
      if (!Number.isFinite(value)) return;
      const key = `${scenario}\u0000${metric}`;
      let m = byKey.get(key);
      if (!m) {
        m = { suite: SUITE, scenario, app: app.id, dataset: ds, metric, unit, samples: [], better: 'lower', meta: {} };
        byKey.set(key, m);
        result.metrics.push(m);
      }
      m.samples.push(value);
      if (sampleMeta) ((m.meta!.perSample ??= []) as unknown[]).push(sampleMeta);
    },
    meta(scenario, metric, meta) {
      const m = byKey.get(`${scenario}\u0000${metric}`);
      if (m) Object.assign(m.meta!, meta);
    },
  };
}

function legMetrics(d: ProxyCounters): Record<string, [Unit, number]> {
  const c = d.categories;
  const total = d.up + d.down;
  const asset = c.asset.up + c.asset.down;
  return {
    total_bytes: ['bytes', total],
    down_bytes: ['bytes', d.down],
    up_bytes: ['bytes', d.up],
    asset_bytes: ['bytes', asset],
    data_bytes: ['bytes', total - asset],
    ws_bytes: ['bytes', c.ws.up + c.ws.down],
    requests: ['count', d.requests],
    ws_messages: ['count', d.wsFrames.up + d.wsFrames.down],
    connections: ['count', d.connsOpened],
  };
}

function legMeta(d: ProxyCounters): Record<string, unknown> {
  const c = d.categories;
  return {
    sseBytes: c.sse.up + c.sse.down,
    apiBytes: c.api.up + c.api.down,
    otherBytes: c.other.up + c.other.down,
    wsControlFrames: d.wsControlFrames.up + d.wsControlFrames.down,
    routes: topRoutes(d, TOP_ROUTES),
  };
}

/** Records one sample of every leg metric for a window between two snapshots. */
function recordWindow(r: Recorder, scenario: string, a: Snap, b: Snap, extra: Record<string, unknown>): { net: ProxyCounters; ui: ProxyCounters } {
  const net = deltaCounters(a.net, b.net);
  const ui = deltaCounters(a.ui, b.ui);
  const sameLeg = r.app.id === 'v1';
  const ipcCalls = a.ipc !== null && b.ipc !== null ? b.ipc - a.ipc : undefined;
  for (const [leg, d] of [
    ['net', net],
    ['ui', ui],
  ] as Array<[Leg, ProxyCounters]>) {
    const meta = { ...extra, leg: legName(r.app.id, leg), ...legMeta(d), ...(leg === 'ui' && ipcCalls !== undefined ? { ipcCalls } : {}), ...(sameLeg && leg === 'ui' ? { sameAs: 'net' } : {}) };
    for (const [name, [unit, v]] of Object.entries(legMetrics(d))) r.add(scenario, `${leg}_${name}`, unit, v, name === 'total_bytes' ? meta : undefined);
  }
  return { net, ui };
}

/** Idle: rates per minute rather than totals. */
function recordIdle(r: Recorder, a: Snap, b: Snap, extra: Record<string, unknown>): void {
  const minutes = (b.net.at - a.net.at) / 60_000;
  for (const leg of ['net', 'ui'] as const) {
    const d = deltaCounters(a[leg], b[leg]);
    const meta = { ...extra, leg: legName(r.app.id, leg), windowSec: Math.round(minutes * 600) / 10, ...legMeta(d), ...(r.app.id === 'v1' && leg === 'ui' ? { sameAs: 'net' } : {}) };
    r.add('idle', `${leg}_bytes_per_min`, 'bytes', (d.up + d.down) / minutes, meta);
    r.add('idle', `${leg}_down_bytes_per_min`, 'bytes', d.down / minutes);
    r.add('idle', `${leg}_requests_per_min`, 'count', d.requests / minutes);
    r.add('idle', `${leg}_ws_messages_per_min`, 'count', (d.wsFrames.up + d.wsFrames.down) / minutes);
  }
}

function legName(app: AppId, leg: Leg): string {
  if (app === 'v1') return 'browser <-> V1 server (loopback HTTP + SignalR WebSocket; the UI leg and the internal socket are the same)';
  return leg === 'net' ? 'architecture-internal socket: host (IPC shim) <-> daemon (loopback REST + WebSocket + SSE; no assets, no IPC)' : 'UI to backend: browser <-> IPC shim (IPC + assets; in-process in the real app)';
}

// ---------------------------------------------------------------------------------------------
// Page helpers (Playwright waits: this suite times nothing, it only needs to know when a view is up)

function wantFor(m: DatasetManifest): Record<NavTarget, Want> {
  return {
    plans: m.counts.plansQueue > 0 ? 'content' : 'empty',
    jobs: m.counts.jobs > 0 ? 'content' : 'empty',
    dashboard: 'any',
    review: m.counts.reviewQueue > 0 ? 'content' : 'empty',
    recommendations: 'empty',
  };
}

async function waitReady(page: Page, c: ReadyCondition, want: Want, what: string): Promise<void> {
  const probes = want === 'any' ? c.anyOf : c.anyOf.filter((p) => p.kind === want);
  const use = probes.length ? probes : c.anyOf;
  try {
    await bounded(
      (async () => {
        await Promise.any(use.map((p) => page.locator(p.selector).first().waitFor({ state: p.state, timeout: WAIT_MS })));
        for (const p of c.allOf ?? []) await page.locator(p.selector).first().waitFor({ state: p.state, timeout: WAIT_MS });
        for (const s of c.noneOf ?? []) await page.locator(s).first().waitFor({ state: 'detached', timeout: WAIT_MS });
      })(),
      what,
      WAIT_MS + PAGE_GRACE_MS,
    );
  } catch (e) {
    if (e instanceof PageHung) throw e;
    const msg = e instanceof AggregateError ? errorMessage(e.errors[0]) : errorMessage(e);
    throw new Error(`${what}: view not ready within ${WAIT_MS} ms: ${msg.split('\n')[0]}`);
  }
}

async function badge(page: Page, css: string): Promise<number> {
  return bounded(
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? Number((el.textContent ?? '').replace(/[^0-9]/g, '') || '0') : 0;
    }, css),
    'plans badge',
  );
}

async function waitBadge(page: Page, css: string, expected: number, what: string): Promise<void> {
  try {
    await bounded(
      page.waitForFunction(
        ([sel, exp]) => {
          const el = document.querySelector(sel);
          return (el ? Number((el.textContent ?? '').replace(/[^0-9]/g, '') || '0') : 0) === exp;
        },
        [css, expected] as const,
        { timeout: WAIT_MS, polling: 50 },
      ),
      what,
      WAIT_MS + PAGE_GRACE_MS,
    );
  } catch (e) {
    if (e instanceof PageHung) throw e;
    throw new Error(`${what}: plans badge did not reach ${expected} within ${WAIT_MS} ms (${errorMessage(e).split('\n')[0]})`);
  }
}

// ---------------------------------------------------------------------------------------------
// Session

interface Session {
  app: AppAdapter;
  ds: DatasetName;
  manifest: DatasetManifest;
  server: ServerHandle;
  ui: UiHandle;
  taps: Taps;
  browser: Browser;
  want: Record<NavTarget, Want>;
  queue: number;
  rec: Recorder;
  fail: (scenario: string, e: unknown) => void;
  note: (s: string) => void;
  log: Logger;
  pageErrors: string[];
  ipcFailures: Map<string, number>;
  /** Push toggles so far in this session: which target and value comes next. */
  pushSeq: number;
}

async function newPage(s: Session): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await s.browser.newContext({ viewport: VIEWPORT });
  try {
    if (s.ui.initScript) await ctx.addInitScript({ content: s.ui.initScript });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => s.pageErrors.push(e.message.slice(0, 200)));
    return { ctx, page };
  } catch (e) {
    await ctx.close().catch(() => {});
    throw e;
  }
}

/** Closes a context after collecting the V2 shim's failed IPC commands (to prove the shadow home works). */
async function closePage(s: Session, ctx: BrowserContext, page: Page): Promise<void> {
  if (s.app.id === 'v2') {
    const failed = await bounded(page.evaluate(() => ((window as unknown as { __SHIM_IPC__?: Array<{ cmd: string; ok: boolean }> }).__SHIM_IPC__ ?? []).filter((x) => !x.ok).map((x) => x.cmd)), 'IPC failures').catch(() => [] as string[]);
    for (const c of failed) s.ipcFailures.set(c, (s.ipcFailures.get(c) ?? 0) + 1);
  }
  await bounded(ctx.close(), 'close context').catch(() => {});
}

async function load(s: Session, page: Page): Promise<{ settleMs: number; capped: boolean }> {
  await bounded(page.goto(s.taps.pageUrl, { waitUntil: 'commit', timeout: WAIT_MS }), 'page load', WAIT_MS + PAGE_GRACE_MS);
  await bounded(page.locator(s.app.ui.shell).first().waitFor({ state: 'visible', timeout: WAIT_MS }), 'shell', WAIT_MS + PAGE_GRACE_MS);
  await waitReady(page, s.app.ui.ready.plans, s.want.plans, 'landing view');
  const st = await settle(s.taps);
  return { settleMs: st.ms, capped: st.capped };
}

async function visit(s: Session, page: Page, target: NavTarget): Promise<{ settleMs: number; capped: boolean }> {
  await bounded(page.click(s.app.ui.navButton(target), { timeout: CLICK_TIMEOUT_MS }), `click ${target}`, CLICK_TIMEOUT_MS + PAGE_GRACE_MS);
  await waitReady(page, s.app.ui.ready[target], s.want[target], `navigate to ${target}`);
  const st = await settle(s.taps);
  return { settleMs: st.ms, capped: st.capped };
}

function pushTargets(m: DatasetManifest): string[] {
  const t = m.ids.pushTargets.filter((id) => id !== m.ids.updatePlanId);
  return t.length ? t : m.ids.pushTargets;
}

/**
 * One state toggle (Icebox on even steps, Draft on odd ones, so pairs leave the dataset as it was).
 * The PUT goes straight to the server, never through a proxy: only what the UI side receives because
 * of it is counted.
 */
async function pushOnce(s: Session, page: Page): Promise<{ settleMs: number; capped: boolean; target: string; value: string; requestMs: number }> {
  const targets = pushTargets(s.manifest);
  const i = s.pushSeq;
  const target = targets[Math.floor(i / 2) % targets.length]!;
  const value = i % 2 === 0 ? 'Icebox' : 'Draft';
  const before = i % 2 === 0 ? s.queue : s.queue - 1;
  const expected = i % 2 === 0 ? s.queue - 1 : s.queue;
  const css = s.app.ui.navBadge('plans');
  const t0 = performance.now();
  const shown = await badge(page, css);
  if (shown !== before) throw new Error(`plans badge shows ${shown} before push ${i}, expected ${before}`);
  const spec = s.app.api['plans.update']({ planId: target, jobId: '', i: value === 'Icebox' ? 0 : 1 });
  const t1 = performance.now();
  const r = await request({ method: spec.method, url: joinUrl(s.server.baseUrl, spec.path), headers: s.server.authHeaders(), body: spec.body });
  if (r.status < 200 || r.status >= 300) throw new Error(`PUT ${spec.path} -> ${r.status || r.error}`);
  s.pushSeq++;
  const t2 = performance.now();
  await waitBadge(page, css, expected, `push ${value} of ${target}`);
  const t3 = performance.now();
  const st = await settle(s.taps);
  s.log.debug(`push ${i}: badge read ${Math.round(t1 - t0)} ms, PUT ${Math.round(t2 - t1)} ms, badge change ${Math.round(t3 - t2)} ms, settle ${Math.round(st.ms)} ms`);
  return { settleMs: st.ms, capped: st.capped, target, value, requestMs: Math.round(r.ms * 10) / 10 };
}

/** Puts a pushed plan back to Draft when an odd number of pushes (or a failure) left it in Icebox. */
async function restorePushes(s: Session, page: Page | null): Promise<void> {
  if (s.pushSeq % 2 === 0) return;
  const targets = pushTargets(s.manifest);
  const target = targets[Math.floor((s.pushSeq - 1) / 2) % targets.length]!;
  const spec = s.app.api['plans.update']({ planId: target, jobId: '', i: 1 });
  const r = await request({ method: spec.method, url: joinUrl(s.server.baseUrl, spec.path), headers: s.server.authHeaders(), body: spec.body });
  if (r.status < 200 || r.status >= 300) throw new Error(`restoring ${target} to Draft: ${r.status || r.error}`);
  s.pushSeq++;
  if (page) await waitBadge(page, s.app.ui.navBadge('plans'), s.queue, 'badge after restoring a pushed plan').catch(() => {});
  await settle(s.taps);
}

// ---------------------------------------------------------------------------------------------
// Scenarios

async function coldLoadAndNav(s: Session, i: number): Promise<void> {
  const { ctx, page } = await newPage(s);
  try {
    let a = await snap(s.taps, null, s.app.id);
    try {
      const l = await load(s, page);
      const b = await snap(s.taps, page, s.app.id);
      recordWindow(s.rec, 'cold-load', a, b, { i, settleMs: Math.round(l.settleMs), settleCapped: l.capped, windowMs: Math.round(b.net.at - a.net.at) });
      a = b;
    } catch (e) {
      s.fail('cold-load', e);
      return;
    }
    for (const target of NAV_ORDER) {
      try {
        const v = await visit(s, page, target);
        const b = await snap(s.taps, page, s.app.id);
        recordWindow(s.rec, `nav:${target}`, a, b, { i, settleMs: Math.round(v.settleMs), settleCapped: v.capped, windowMs: Math.round(b.net.at - a.net.at) });
        a = b;
      } catch (e) {
        s.fail(`nav:${target}`, e);
        a = await snap(s.taps, page, s.app.id);
      }
    }
  } finally {
    await closePage(s, ctx, page);
    // Closing the context tears its sockets down; let that finish outside every window.
    await settle(s.taps);
  }
}

async function warmPageScenarios(s: Session, k: SuiteContext['knobs']['network']): Promise<void> {
  const { ctx, page } = await newPage(s);
  try {
    try {
      await load(s, page);
    } catch (e) {
      s.fail('idle', e);
      return;
    }
    const shown = await badge(page, s.app.ui.navBadge('plans')).catch(() => NaN);
    if (shown !== s.queue) {
      s.note(`${s.app.id}/${s.ds}: plans badge shows ${shown}, the dataset manifest says ${s.queue}; push expectations follow the page`);
      if (Number.isFinite(shown)) s.queue = shown;
    }
    for (let w = 0; w < k.idleWindows; w++) {
      const a = await snap(s.taps, page, s.app.id);
      await sleep(k.idleWindowSec * 1000);
      const b = await snap(s.taps, page, s.app.id);
      recordIdle(s.rec, a, b, { window: w });
    }
    if (!pushTargets(s.manifest).length) {
      s.note(`push skipped for ${s.app.id}/${s.ds}: the dataset has no Draft plan besides the auto-opened one`);
      return;
    }
    for (let i = 0; i < k.pushSamples; i++) {
      if (!isAlive(s.server.pid)) {
        s.fail('push', new Error(`${s.app.id} server (pid ${s.server.pid}) exited`));
        break;
      }
      const a = await snap(s.taps, page, s.app.id);
      try {
        const p = await pushOnce(s, page);
        const b = await snap(s.taps, page, s.app.id);
        recordWindow(s.rec, 'push', a, b, { i, target: p.target, value: p.value, putMs: p.requestMs, settleMs: Math.round(p.settleMs), settleCapped: p.capped, windowMs: Math.round(b.net.at - a.net.at) });
      } catch (e) {
        s.fail('push', e);
        if (e instanceof PageHung) return;
        await settle(s.taps);
      }
    }
    await restorePushes(s, page).catch((e) => s.fail('push', e));
  } finally {
    await closePage(s, ctx, page);
    await settle(s.taps);
  }
}

async function session(s: Session, i: number, pushes: number): Promise<void> {
  const { ctx, page } = await newPage(s);
  const steps: string[] = [];
  let capped = false;
  try {
    const a = await snap(s.taps, null, s.app.id);
    const l = await load(s, page);
    capped ||= l.capped;
    steps.push('load');
    for (const target of NAV_ORDER) {
      const v = await visit(s, page, target);
      capped ||= v.capped;
      steps.push(target);
    }
    const nPush = pushTargets(s.manifest).length ? pushes : 0;
    for (let p = 0; p < nPush; p++) {
      const r = await pushOnce(s, page);
      capped ||= r.capped;
      steps.push(`push ${r.value}`);
    }
    const b = await snap(s.taps, page, s.app.id);
    recordWindow(s.rec, 'session', a, b, { i, steps, settleCapped: capped, windowMs: Math.round(b.net.at - a.net.at) });
  } catch (e) {
    s.fail('session', new Error(`${errorMessage(e)} (after ${steps.join(', ') || 'nothing'})`));
  } finally {
    await restorePushes(s, page).catch((e) => s.fail('session', e));
    await closePage(s, ctx, page);
    await settle(s.taps);
  }
}

// ---------------------------------------------------------------------------------------------
// V2 wiring: the shim reaches the daemon through the proxy via a shadow home

/**
 * A home for the V2 host (shim or real app) whose `.master` points at `proxyPort` and whose every
 * other entry is a symlink into the daemon's real home. The daemon's own `.master` is never touched.
 */
function shadowHome(realHome: string, homesDir: string, ds: DatasetName, proxyPort: number): { home: string; linked: string[]; master: Record<string, unknown> } {
  const home = path.join(homesDir, `v2-${ds}-network-shadow`);
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const linked: string[] = [];
  for (const e of fs.readdirSync(realHome)) {
    if (e === '.master' || e === 'ui_state.json') continue;
    fs.symlinkSync(path.join(realHome, e), path.join(home, e));
    linked.push(e);
  }
  const master = JSON.parse(fs.readFileSync(path.join(realHome, '.master'), 'utf8')) as Record<string, unknown>;
  const host = String(master.host ?? '127.0.0.1');
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`daemon .master names host ${host}; the proxy only listens on 127.0.0.1`);
  const shadow = { ...master, host: '127.0.0.1', port: proxyPort };
  fs.writeFileSync(path.join(home, '.master'), JSON.stringify(shadow, null, 2));
  return { home, linked: linked.sort(), master: { pid: master.pid, port: master.port, host: master.host, scheme: master.scheme } };
}

async function wire(app: AppAdapter, server: ServerHandle, runDir: string, ds: DatasetName, log: Logger): Promise<{ ui: UiHandle; taps: Taps; shadow: string | null; meta: Record<string, unknown> }> {
  if (app.id === 'v1') {
    const ui = await app.startUi(server, runDir);
    const net = await CountingProxy.start({ targetHost: '127.0.0.1', targetPort: server.port, label: 'browser->v1-server' });
    return { ui, taps: { net, ui: net, pageUrl: `${net.url}/` }, shadow: null, meta: { v1Server: server.baseUrl, proxy: net.url } };
  }
  const net = await CountingProxy.start({ targetHost: '127.0.0.1', targetPort: server.port, label: 'shim->daemon' });
  let ui: UiHandle | null = null;
  let uiProxy: CountingProxy | null = null;
  try {
    const sh = shadowHome(server.home, path.join(runDir, 'homes'), ds, net.port);
    ui = await app.startUi({ ...server, home: sh.home }, runDir);
    const shimPort = Number(new URL(ui.url).port);
    uiProxy = await CountingProxy.start({ targetHost: '127.0.0.1', targetPort: shimPort, label: 'browser->shim' });
    // Prove the bridges went through the proxy: the shim's own report of the master it read, and
    // the shim process holding no direct connection to the daemon's port.
    const health = await request({ url: `${ui.url}__shim/health`, collectBody: true });
    const info = JSON.parse(health.body?.toString('utf8') ?? '{}') as { master?: { port?: number; pid?: number }; bridges?: string };
    if (Number(info.master?.port) !== net.port) throw new Error(`the shim read port ${String(info.master?.port)} from its home, expected the proxy's ${net.port}`);
    const shimPid = (await ui.extraProcesses())[0]?.pid ?? null;
    await sleep(500);
    const direct = shimPid ? await hasConnectionTo(shimPid, server.port) : null;
    const viaProxy = shimPid ? await hasConnectionTo(shimPid, net.port) : null;
    if (direct) throw new Error(`the shim (pid ${shimPid}) holds a direct connection to the daemon port ${server.port}; traffic would bypass the proxy`);
    log.info(`v2 shim bridged through ${net.url} (bridges ${info.bridges ?? '?'}, via proxy ${String(viaProxy)}, direct ${String(direct)}); page via ${uiProxy.url}`);
    return {
      ui,
      taps: { net, ui: uiProxy, pageUrl: `${uiProxy.url}/` },
      shadow: sh.home,
      meta: { daemon: server.baseUrl, shimUrl: ui.url, netProxy: net.url, uiProxy: uiProxy.url, shadowLinked: sh.linked, daemonMaster: sh.master, bridges: info.bridges ?? null, shimConnectedViaProxy: viaProxy, shimDirectToDaemon: direct },
    };
  } catch (e) {
    await uiProxy?.close();
    await ui?.stop().catch(() => {});
    await net.close();
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Driver

async function closeBrowser(browser: Browser, log: Logger): Promise<void> {
  const closed = await Promise.race([browser.close().then(() => true), sleep(15_000).then(() => false)]).catch(() => false);
  if (!closed) log.warn('Chromium did not close within 15 s');
}

async function runSession(ctx: SuiteContext, result: SuiteResult, app: AppAdapter, ds: DatasetName, manifest: DatasetManifest): Promise<void> {
  const log = ctx.log.child(`${app.id}/${ds}`);
  const k = ctx.knobs.network;
  // Once a page stops answering, the rest of this app's scenarios on this dataset are skipped.
  let hung: string | null = null;
  const fail = (scenario: string, e: unknown) => {
    const error = errorMessage(e).split('\n')[0]!;
    log.warn(`${scenario}: ${error}`);
    result.failures.push({ app: app.id, dataset: ds, scenario, error });
    if (e instanceof PageHung) hung ??= error;
  };
  const note = (s: string) => {
    if (!result.notes.includes(s)) result.notes.push(s);
  };
  const go = () => isAlive(server.pid) && hung === null;
  const restored = await restoreHome({ paths: ctx.paths, dataset: ds, app: app.id, runDir: ctx.runDir, suffix: 'network', log });
  const server = await app.startServer({ home: restored.home, runDir: ctx.runDir, mode: 'web' });
  let wired: Awaited<ReturnType<typeof wire>> | null = null;
  let browser: Browser | null = null;
  let unregister: (() => void) | null = null;
  try {
    wired = await wire(app, server, ctx.runDir, ds, log);
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const b = browser;
    unregister = registerCleanup(() => closeBrowser(b, log));
    const s: Session = {
      app,
      ds,
      manifest,
      server,
      ui: wired.ui,
      taps: wired.taps,
      browser,
      want: wantFor(manifest),
      queue: manifest.counts.plansQueue,
      rec: makeRecorder(result, app, ds),
      fail,
      note,
      log,
      pageErrors: [],
      ipcFailures: new Map(),
      pushSeq: 0,
    };
    // Whatever the server and bridges do before any page exists (V2's WS and SSE bridges connect at
    // shim start) is not part of any scenario.
    const pre = await snap(s.taps, null, app.id);
    await settle(s.taps);

    log.info(`cold-load + first visits x${k.coldLoads}`);
    for (let i = 0; i < k.coldLoads && go(); i++) await coldLoadAndNav(s, i);
    log.info(`idle ${k.idleWindows} x ${k.idleWindowSec} s, push x${k.pushSamples}`);
    if (go()) await warmPageScenarios(s, k);
    log.info(`session x${k.sessions} (${k.sessionPushes} pushes each)`);
    for (let i = 0; i < k.sessions && go(); i++) await session(s, i, k.sessionPushes);
    if (hung) fail('(session)', new Error(`the ${app.id} page stopped answering (${hung}); the remaining scenarios on ${ds} were skipped`));
    if (!isAlive(server.pid)) fail('(session)', new Error(`${app.id} server (pid ${server.pid}) exited during the suite`));

    const all = deltaCounters(pre.net, s.taps.net.snapshot());
    const setupMeta = { ...wired.meta, preConnections: pre.net.connsOpened, wholeSessionNetBytes: all.up + all.down, wholeSessionNetConnections: all.connsOpened };
    s.rec.meta('cold-load', 'net_total_bytes', { setup: setupMeta });
    if (s.pageErrors.length) note(`${app.id}/${ds}: ${s.pageErrors.length} page error(s), e.g. ${s.pageErrors.slice(0, 2).join(' | ')}`);
    if (app.id === 'v2') {
      const failed = [...s.ipcFailures].map(([c, n]) => `${c} x${n}`).join(', ');
      note(`V2/${ds}: shim bridged through the host->daemon proxy via a shadow TENDRIL_HOME (symlinks to the daemon's home, own .master); failed IPC commands across all pages: ${failed || 'none'}${failed ? ` (${KNOWN_IPC_FAILURES})` : ''}.`);
    }
  } finally {
    if (browser) await closeBrowser(browser, log);
    unregister?.();
    if (wired) {
      await wired.ui.stop().catch((e) => log.warn(`stopping the UI host failed: ${errorMessage(e)}`));
      if (wired.taps.ui !== wired.taps.net) await wired.taps.ui.close();
      await wired.taps.net.close();
    }
    await server.stop().catch((e) => log.warn(`stopping the server failed: ${errorMessage(e)}`));
    fs.rmSync(restored.home, { recursive: true, force: true });
    if (wired?.shadow) fs.rmSync(wired.shadow, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Desktop: external traffic of the real apps (nettop)

interface ExtConn {
  proc: string;
  pid: number | null;
  local: string;
  remote: string;
  bytesIn: number;
  bytesOut: number;
}

function isLoopback(addr: string): boolean {
  return /^(127\.|::1|localhost|\[::1\])/.test(addr) || addr.startsWith('::ffff:127.');
}

/**
 * Parses `nettop -L` CSV: a process row (`name.pid,in,out,`) followed by its connection rows
 * (`tcp4 local<->remote,in,out,`). Counts are cumulative per socket; the largest seen is kept.
 */
function parseNettop(text: string, into: Map<string, ExtConn>): void {
  let proc = '?';
  let pid: number | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(',') || line.startsWith('time,')) continue;
    const cols = line.split(',');
    const name = cols[0]!;
    const m = /^tcp[46] (\S+)<->(\S+)$/.exec(name);
    if (!m) {
      proc = name;
      const pm = /\.(\d+)$/.exec(name);
      pid = pm ? Number(pm[1]) : null;
      continue;
    }
    const [, local, remote] = m as unknown as [string, string, string];
    if (remote.startsWith('*') || isLoopback(remote)) continue;
    const bin = Number(cols[1] || 0);
    const bout = Number(cols[2] || 0);
    const key = `${proc}|${local}|${remote}`;
    const cur = into.get(key);
    if (!cur) into.set(key, { proc, pid, local, remote, bytesIn: bin, bytesOut: bout });
    else {
      cur.bytesIn = Math.max(cur.bytesIn, bin);
      cur.bytesOut = Math.max(cur.bytesOut, bout);
    }
  }
}

function remoteHost(remote: string): string {
  // tcp4 "1.2.3.4:443", tcp6 "2a00::1.443"
  const v4 = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(remote);
  if (v4) return v4[1]!;
  const i = remote.lastIndexOf('.');
  return i > 0 ? remote.slice(0, i) : remote;
}

async function reverse(ip: string): Promise<string | null> {
  try {
    const names = await Promise.race([dns.reverse(ip), sleep(2000).then(() => [] as string[])]);
    return names[0] ?? null;
  } catch {
    return null;
  }
}

/** nettop over every process for `samples` one-second samples (it flushes only on a normal exit). */
function startNettop(samples: number): { done: Promise<Map<string, ExtConn>>; kill(): void } {
  const conns = new Map<string, ExtConn>();
  let buf = '';
  const np = spawn('/usr/bin/nettop', ['-L', String(samples), '-s', '1', '-x', '-n', '-m', 'tcp', '-t', 'external', '-J', 'bytes_in,bytes_out'], { stdio: ['ignore', 'pipe', 'ignore'] });
  np.stdout!.on('data', (c: Buffer) => {
    buf += c.toString('utf8');
    const cut = buf.lastIndexOf('\n');
    if (cut >= 0) {
      parseNettop(buf.slice(0, cut), conns);
      buf = buf.slice(cut + 1);
    }
  });
  const unregister = registerCleanup(() => {
    if (np.exitCode === null) np.kill('SIGKILL');
  });
  const done = new Promise<Map<string, ExtConn>>((resolve, reject) => {
    const timer = setTimeout(() => {
      np.kill('SIGKILL');
      reject(new Error(`nettop did not finish ${samples} samples in time`));
    }, samples * 1000 + 20_000);
    np.once('exit', () => {
      clearTimeout(timer);
      unregister();
      parseNettop(buf, conns);
      resolve(conns);
    });
    np.once('error', (e) => {
      clearTimeout(timer);
      unregister();
      reject(e);
    });
  });
  return {
    done,
    kill: () => {
      if (np.exitCode === null) np.kill('SIGKILL');
    },
  };
}

async function desktopExternal(ctx: SuiteContext, result: SuiteResult): Promise<void> {
  const sec = ctx.knobs.network.desktopIdleSec;
  if (sec <= 0) return;
  const ds = ctx.desktopDatasets[0];
  if (!ds) return;
  for (const app of ctx.apps) {
    const log = ctx.log.child(`${app.id}/desktop`);
    const scenario = 'desktop-external';
    let handle: Awaited<ReturnType<AppAdapter['launchDesktop']>> | null = null;
    let nettop: ReturnType<typeof startNettop> | null = null;
    try {
      const restored = await restoreHome({ paths: ctx.paths, dataset: ds, app: app.id, runDir: ctx.runDir, homesRoot: desktopHomesRoot(ctx.runDir), suffix: 'network', log });
      // nettop runs over every process from before the launch (so V2's daemon start and the apps'
      // first seconds are covered) and is filtered to this launch's processes afterwards.
      nettop = startNettop(sec);
      const t0 = performance.now();
      handle = await app.launchDesktop({ home: restored.home, runDir: ctx.runDir });
      const h = handle;
      const pids = new Set<number>();
      const roles = new Set<string>();
      const collect = async () => {
        const roots = await h.roots();
        const table = await ctx.procstat.listAll();
        for (const r of roots) {
          pids.add(r.pid);
          roles.add(r.role);
          for (const d of descendantsFromTable(table, r.pid)) pids.add(d);
        }
      };
      while (performance.now() - t0 < sec * 1000) {
        await collect().catch(() => {});
        await sleep(2000);
      }
      const conns = await nettop.done;
      const list = [...conns.values()].filter((c) => c.pid !== null && pids.has(c.pid));
      const hosts = new Map<string, string | null>();
      for (const c of list) {
        const host = remoteHost(c.remote);
        if (!hosts.has(host)) hosts.set(host, await reverse(host));
      }
      const endpoints = list
        .map((c) => ({ process: c.proc, remote: c.remote, name: hosts.get(remoteHost(c.remote)) ?? null, bytesIn: c.bytesIn, bytesOut: c.bytesOut }))
        .sort((a, b) => b.bytesIn + b.bytesOut - (a.bytesIn + a.bytesOut));
      const rec = makeRecorder(result, app, ds);
      const meta = { durationSec: sec, launchLeadMs: Math.round(performance.now() - t0), pids: [...pids].sort((a, b) => a - b), roles: [...roles].sort(), endpoints, lowerBound: 'nettop only reports sockets still open when it samples (every 1 s)' };
      rec.add(scenario, 'ext_bytes_in', 'bytes', list.reduce((s2, c) => s2 + c.bytesIn, 0), meta);
      rec.add(scenario, 'ext_bytes_out', 'bytes', list.reduce((s2, c) => s2 + c.bytesOut, 0));
      rec.add(scenario, 'ext_connections', 'count', list.length);
      log.info(`external traffic over ${sec} s: ${list.length} connection(s), ${endpoints.slice(0, 3).map((e) => `${e.name ?? e.remote} ${e.bytesIn}/${e.bytesOut}`).join('; ') || 'none'}`);
    } catch (e) {
      log.warn(`desktop external traffic failed: ${errorMessage(e)}`);
      result.failures.push({ app: app.id, dataset: ds, scenario, error: errorMessage(e).split('\n')[0]! });
    } finally {
      nettop?.kill();
      if (handle) await handle.stop().catch((e) => log.warn(`stopping the desktop app failed: ${errorMessage(e)}`));
    }
  }
  removeDesktopHomes(ctx.runDir);
  result.notes.push(
    `desktop-external: each real desktop app (${ctx.desktopDatasets[0]} dataset) watched with \`nettop -s 1 -m tcp -t external\` over every process, started before the app (and V2's daemon) was spawned and run for ${sec} s, then filtered to the app, its WebKit processes, (V2) the daemon and their descendants; loopback excluded. Both apps run their shipped background fetches (V1's model pricing warmup, V2's model enrichment). A lower bound: a socket opened and closed between two 1 s samples is missed.`,
  );
}

// ---------------------------------------------------------------------------------------------
// The real V2 host behind a proxy (checks the shim's host <-> daemon traffic)

async function realHostCheck(ctx: SuiteContext, result: SuiteResult): Promise<void> {
  const sec = ctx.knobs.network.realHostSec;
  const v2 = ctx.apps.find((a) => a.id === 'v2');
  if (sec <= 0 || !v2) return;
  const ds = ctx.datasets.includes('small') ? 'small' : ctx.datasets[ctx.datasets.length - 1];
  if (!ds) return;
  const scenario = 'real-host-cold-load';
  const log = ctx.log.child('v2/real-host');
  let proxy: CountingProxy | null = null;
  let handle: Awaited<ReturnType<AppAdapter['launchDesktop']>> | null = null;
  const homesDir = desktopHomesRoot(ctx.runDir);
  try {
    const restored = await restoreHome({ paths: ctx.paths, dataset: ds, app: 'v2', runDir: ctx.runDir, homesRoot: homesDir, suffix: 'network-real', log });
    let shadow: ReturnType<typeof shadowHome> | null = null;
    handle = await v2.launchDesktop({
      home: restored.home,
      runDir: ctx.runDir,
      appHome: async (daemon) => {
        proxy = await CountingProxy.start({ targetHost: '127.0.0.1', targetPort: daemon.port, label: 'tendril-app->daemon' });
        shadow = shadowHome(daemon.home, homesDir, ds, proxy.port);
        return shadow.home;
      },
    });
    const p = proxy as CountingProxy | null;
    if (!p) throw new Error('the proxy in front of the daemon was not started');
    const t0 = performance.now();
    // Cold load: until the host's first burst has settled (as the shim's cold-load window).
    let first: ProxyCounters | null = null;
    while (performance.now() - t0 < Math.min(sec * 1000, 60_000)) {
      if (p.totalBytes() > 0) break;
      await sleep(SETTLE_POLL_MS);
    }
    const taps: Taps = { net: p, ui: p, pageUrl: '' };
    const st = await settle(taps);
    first = p.snapshot();
    const coldMs = Math.round(first.at - t0);
    await sleep(Math.max(0, sec * 1000 - (performance.now() - t0)));
    const all = p.snapshot();
    const adopted = await hasConnectionTo(handle.appPid, p.port);
    const rec = makeRecorder(result, v2, ds);
    const shimCold = result.metrics.find((m) => m.app === 'v2' && m.dataset === ds && m.scenario === 'cold-load' && m.metric === 'net_total_bytes');
    const shimReq = result.metrics.find((m) => m.app === 'v2' && m.dataset === ds && m.scenario === 'cold-load' && m.metric === 'net_requests');
    const med = (m: Metric | undefined) => (m && m.samples.length ? [...m.samples].sort((a, b) => a - b)[Math.floor(m.samples.length / 2)]! : null);
    const meta = {
      validation: true,
      what: 'the real Tendril.app host <-> daemon traffic, through a proxy via a shadow TENDRIL_HOME, from the launch until the first burst settled (1.5 s quiet); compare with the IPC shim cold-load net leg',
      windowMs: coldMs,
      settleCapped: st.capped,
      wholeWindow: { sec, bytes: all.up + all.down, requests: all.requests, connections: all.connsOpened, routes: topRoutes(all, TOP_ROUTES) },
      routes: topRoutes(first, TOP_ROUTES),
      shimColdLoadMedian: { bytes: med(shimCold), requests: med(shimReq) },
      shadow: (shadow as ReturnType<typeof shadowHome> | null)?.linked ?? null,
      includesBridgeSetup: 'the host connects its WebSocket and SSE bridges at launch, inside this window; the shim connects them at its own start, outside its cold-load window',
    };
    rec.add(scenario, 'net_total_bytes', 'bytes', first.up + first.down, meta);
    rec.add(scenario, 'net_requests', 'count', first.requests);
    rec.add(scenario, 'net_connections', 'count', first.connsOpened);
    log.info(`real tendril-app host <-> daemon cold load: ${first.up + first.down} B in ${first.requests} request(s) over ${coldMs} ms (shim cold-load median ${String(med(shimCold))} B, ${String(med(shimReq))} requests); whole ${sec} s: ${all.up + all.down} B`);
    if (adopted === false) result.notes.push('real-host-cold-load: tendril-app held no connection to the proxy at the end of the window, so it may not have used the proxied daemon');
    else if (adopted) result.notes.push(`real-host-cold-load: tendril-app was connected to the daemon through the proxy (shadow home; ${first.requests} request(s) in the cold-load window)`);
  } catch (e) {
    log.warn(`real host check failed: ${errorMessage(e)}`);
    result.failures.push({ app: 'v2', dataset: ds, scenario, error: errorMessage(e).split('\n')[0]! });
  } finally {
    if (handle) await handle.stop().catch((e) => log.warn(`stopping the desktop app failed: ${errorMessage(e)}`));
    await (proxy as CountingProxy | null)?.close();
    removeDesktopHomes(ctx.runDir);
  }
}

// ---------------------------------------------------------------------------------------------
// Suite

export async function run(ctx: SuiteContext): Promise<SuiteResult> {
  const result = newSuiteResult(SUITE, ctx.runId, ctx.profile);
  const k = ctx.knobs.network;
  result.notes.push(
    `Bytes are counted on the wire by a TCP proxy (lib/tcpproxy.ts) that follows HTTP/1.1 and WebSocket framing: application-layer bytes in each direction (HTTP heads and bodies, WebSocket frame headers and payloads, SSE streams), TCP/IP headers excluded. Assets are requests the browser marks Sec-Fetch-Dest document/script/style/font/image (or GET of a static file extension); data is everything else (total minus assets).`,
    `Leg "ui" (the like-for-like comparison) = what the page exchanges with its backend, assets and data counted separately: for V1 browser <-> V1 server; for V2 browser <-> shim, which in the real Tauri app is in-process IPC plus assets from the app bundle and never touches a socket. Leg "net" = architecture-internal loopback sockets: for V1 the same leg as "ui"; for V2 host <-> daemon only (the host is the IPC shim running the real tendril-app command handlers and bridges, reaching the daemon through a shadow TENDRIL_HOME whose .master points at the proxy), so it carries no assets and no IPC.`,
    `Per dataset and app: ${k.coldLoads} cold loads (fresh context) each followed by first visits of ${NAV_ORDER.join(', ')}; ${k.idleWindows} idle window(s) of ${k.idleWindowSec} s on a warm page; ${k.pushSamples} REST pushes (the PUT itself goes straight to the server and is not counted); ${k.sessions} scripted session(s) of load + every view + ${k.sessionPushes} pushes. A window ends when no byte has moved on either leg for ${QUIET_MS} ms (at most ${SETTLE_MAX_MS / 1000} s), so background traffic inside it (V2's 5 s job poll, SignalR keep-alives) is included; the idle scenario measures that background alone. Headless Chromium ${VIEWPORT.width}x${VIEWPORT.height}, as in the ui suite.`,
  );
  for (const [di, ds] of ctx.datasets.entries()) {
    const manifest = loadManifest(ctx.paths, ds);
    const order = di % 2 === 0 ? ctx.apps : [...ctx.apps].reverse();
    for (const app of order) {
      if (!manifest) {
        result.failures.push({ app: app.id, dataset: ds, scenario: '(session)', error: `dataset ${ds} is not built; run \`datasets\`` });
        continue;
      }
      ctx.log.info(`network: ${app.id} on ${ds}`);
      try {
        await runSession(ctx, result, app, ds, manifest);
      } catch (e) {
        ctx.log.warn(`network ${app.id}/${ds} failed: ${errorMessage(e)}`);
        result.failures.push({ app: app.id, dataset: ds, scenario: '(session)', error: errorMessage(e).split('\n')[0]! });
      }
    }
  }
  try {
    await desktopExternal(ctx, result);
  } catch (e) {
    result.notes.push(`desktop-external did not run: ${errorMessage(e)}`);
  }
  try {
    await realHostCheck(ctx, result);
  } catch (e) {
    result.notes.push(`real-host-cold-load did not run: ${errorMessage(e)}`);
  }
  if (ctx.apps.some((a) => a.id === 'v2')) result.notes.push(`V2 "ui" leg: role of the far end is the ${SHIM_LABEL}.`);
  return result;
}

