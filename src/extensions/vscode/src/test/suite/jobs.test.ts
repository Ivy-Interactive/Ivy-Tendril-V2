import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { JobRunner, JobStreamEvent } from '../../jobs/jobRunner';
import { getMasterFilePath } from '../../server/masterDiscovery';

/**
 * A `ServerManager` stand-in whose `.master` really exists on disk, because `JobRunner` reads the
 * bearer secret out of it rather than being handed one.
 */
function mockServerManager(home: string, secret = 'bearer-secret-abc'): any {
  fs.writeFileSync(
    getMasterFilePath(home),
    JSON.stringify({
      port: 5000,
      pid: process.pid,
      secret,
      host: '127.0.0.1',
      scheme: 'http',
      apiVersion: 1,
      capabilities: []
    }),
    'utf-8'
  );

  return {
    tendrilHome: home,
    getHealthInfo: async () => ({
      isAlive: true,
      baseUrl: 'http://127.0.0.1:5000',
      port: 5000,
      pid: process.pid,
      activeJobsCount: 0
    })
  };
}

describe('JobRunner Suite', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tendril-jobrunner-test-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe('subscribeJobEvents', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should parse SSE stream and dispatch onEvent callbacks', async () => {
      const ssePayload = [
        // The V2 daemon names every data frame `event: event`, where V1 sent unnamed frames. An
        // EventSource wired to `onmessage` would receive none of these and simply hang.
        'event: event\ndata: {"kind":"text","text":"Hello world"}\n\n',
        'event: event\ndata: {"kind":"tool_call","tool_name":"cargo build"}\n\n',
        'event: end\ndata: {"status":"Completed"}\n\n'
      ].join('');

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload));
          controller.close();
        }
      });

      const requestedUrls: string[] = [];
      let streamHeaders: any = {};

      global.fetch = (async (url: string, init?: any) => {
        requestedUrls.push(url);
        if (String(url).endsWith('/events')) {
          streamHeaders = init?.headers;
          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' }
          });
        }
        // The re-read of the job record after the stream closes.
        return new Response(JSON.stringify({ id: '00418', status: 'Completed', details: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }) as any;

      const runner = new JobRunner(mockServerManager(home));
      const events: JobStreamEvent[] = [];

      const result = await runner.subscribeJobEvents('00418', (evt) => {
        events.push(evt);
      });

      assert.strictEqual(requestedUrls[0], 'http://127.0.0.1:5000/api/jobs/00418/events');
      assert.strictEqual(streamHeaders['Accept'], 'text/event-stream');
      assert.strictEqual(
        streamHeaders['Authorization'],
        'Bearer bearer-secret-abc',
        'Every /api route except ping requires the .master secret; V1 sent no bearer token at all'
      );
      assert.strictEqual(events.length, 3);
      assert.strictEqual(events[0].kind, 'text');
      assert.strictEqual(events[0].text, 'Hello world');
      assert.strictEqual(events[1].kind, 'tool_call');
      assert.strictEqual(events[1].tool_name, 'cargo build');
      assert.strictEqual(events[2].kind, 'end');
      assert.strictEqual(events[2].status, 'Completed');
      assert.strictEqual(result.id, '00418');
      assert.strictEqual(result.status, 'Completed');
    });

    it('should pad an unpadded job id before putting it in the URL', async () => {
      // `GET /api/jobs/:id` is `WHERE Id = ?`, an exact match; V1 padded server-side.
      const requestedUrls: string[] = [];
      global.fetch = (async (url: string) => {
        requestedUrls.push(url);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: end\ndata: {"status":"Completed"}\n\n'));
            controller.close();
          }
        });
        if (String(url).endsWith('/events')) {
          return new Response(stream, { status: 200 });
        }
        return new Response(JSON.stringify({ id: '00418', status: 'Completed' }), { status: 200 });
      }) as any;

      const runner = new JobRunner(mockServerManager(home));
      await runner.subscribeJobEvents('418', () => {});

      assert.strictEqual(requestedUrls[0], 'http://127.0.0.1:5000/api/jobs/00418/events');
    });

    it('should handle multi-chunk SSE stream delivery', async () => {
      const chunk1 = 'event: event\ndata: {"kind":"text","te';
      const chunk2 = 'xt":"split payload"}\n\n';
      const chunk3 = 'event: end\ndata: {"status":"Failed"}\n\n';

      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(chunk1));
          controller.enqueue(new TextEncoder().encode(chunk2));
          controller.enqueue(new TextEncoder().encode(chunk3));
          controller.close();
        }
      });

      global.fetch = (async (url: string) => {
        if (String(url).endsWith('/events')) {
          return new Response(stream, { status: 200 });
        }
        return new Response(JSON.stringify({ id: '00418', status: 'Failed' }), { status: 200 });
      }) as any;

      const runner = new JobRunner(mockServerManager(home));
      const events: JobStreamEvent[] = [];

      const result = await runner.subscribeJobEvents('00418', (evt) => {
        events.push(evt);
      });

      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].text, 'split payload');
      assert.strictEqual(events[1].status, 'Failed');
      assert.strictEqual(result.status, 'Failed');
    });

    it('should skip the daemons keep-alive comment frames', async () => {
      // `stream_job_events` sends a 15s keep-alive, which arrives as a bare `:` comment frame.
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(':\n\n'));
          controller.enqueue(new TextEncoder().encode('event: end\ndata: {"status":"Completed"}\n\n'));
          controller.close();
        }
      });

      global.fetch = (async (url: string) => {
        if (String(url).endsWith('/events')) {
          return new Response(stream, { status: 200 });
        }
        return new Response(JSON.stringify({ id: '00418', status: 'Completed' }), { status: 200 });
      }) as any;

      const runner = new JobRunner(mockServerManager(home));
      const events: JobStreamEvent[] = [];
      await runner.subscribeJobEvents('00418', evt => events.push(evt));

      assert.strictEqual(events.length, 1, 'A keep-alive must not surface as an event');
      assert.strictEqual(events[0].kind, 'end');
    });

    it('should abort stream when cancellation token triggers', async () => {
      const cts = new vscode.CancellationTokenSource();

      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const stream = new ReadableStream({
        start(controller) {
          streamController = controller;
          controller.enqueue(new TextEncoder().encode('event: event\ndata: {"kind":"text","text":"start"}\n\n'));
        }
      });

      global.fetch = (async (_url: string, init?: any) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            try {
              streamController?.error(new DOMException('The operation was aborted.', 'AbortError'));
            } catch {}
          });
        }
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        });
      }) as any;

      const runner = new JobRunner(mockServerManager(home));
      runner.getJobStatus = async (jobId) => ({ id: jobId, status: 'Running' });

      const promise = runner.subscribeJobEvents('00418', () => {
        cts.cancel();
      }, cts.token);

      const result = await promise;
      assert.strictEqual(result.id, '00418');
      assert.strictEqual(result.status, 'Running');
    });

    it('should append kind query parameters when kinds are provided', async () => {
      const requestedUrls: string[] = [];

      global.fetch = (async (url: string) => {
        requestedUrls.push(url);
        if (String(url).includes('/events')) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: end\ndata: {"status":"Completed"}\n\n'));
              controller.close();
            }
          });
          return new Response(stream, { status: 200 });
        }
        return new Response(JSON.stringify({ id: '00438', status: 'Completed' }), { status: 200 });
      }) as any;

      const runner = new JobRunner(mockServerManager(home));
      await runner.subscribeJobEvents('00438', () => {}, undefined, ['tool_call', 'tool_result']);

      assert.strictEqual(
        requestedUrls[0],
        'http://127.0.0.1:5000/api/jobs/00438/events?kind=tool_call&kind=tool_result'
      );
    });
  });

  describe('getJobStatus', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should pad the id, authenticate, and read the plan id out of details', async () => {
      let requestedUrl = '';
      let headers: any = {};

      global.fetch = (async (url: string, init?: any) => {
        requestedUrl = url;
        headers = init?.headers;
        return new Response(
          JSON.stringify({
            id: '00458',
            status: 'Completed',
            message: 'Plan created',
            // V2 nests the whole JobItem under `details`; V1 returned planId at the top level.
            details: { reportedPlanId: '00399', planFile: '/plans/00399-AddDarkMode' }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any;

      const runner = new JobRunner(mockServerManager(home));
      const status = await runner.getJobStatus('458');

      assert.strictEqual(requestedUrl, 'http://127.0.0.1:5000/api/jobs/00458');
      assert.strictEqual(headers['Authorization'], 'Bearer bearer-secret-abc');
      assert.strictEqual(status.id, '00458');
      assert.strictEqual(status.status, 'Completed');
      assert.strictEqual(status.planId, '00399');
    });

    it('should fall back to the plan folder when no plan id was reported', async () => {
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            id: '00458',
            status: 'Running',
            details: { planFile: '/plans/00399-AddDarkMode' }
          }),
          { status: 200 }
        )) as any;

      const runner = new JobRunner(mockServerManager(home));
      assert.strictEqual((await runner.getJobStatus('00458')).planId, '00399');
    });
  });

  describe('listJobs', () => {
    it('should parse the JSON array tendril job list --json prints', async () => {
      // V1's CLI spelled this `--format json`, so `--json` was an unknown option there and every
      // call failed into an empty list. V2 has a real `--json` flag that prints the daemon's
      // JobItem array, whose fields are camelCase.
      const runner = new JobRunner();
      (runner as any).executeCli = async () => ({
        stdout: JSON.stringify([
          {
            id: '01864',
            type: 'ExecutePlan',
            project: 'Ivy-Tendril',
            status: 'Running',
            statusMessage: 'Implementing changes',
            planFile: '/plans/00399-AddDarkMode',
            startedAt: '2026-09-16T10:00:00Z',
            durationSeconds: 42
          },
          {
            id: '01865',
            type: 'CreatePlan',
            project: 'Ivy-Tendril',
            status: 'Completed',
            reportedPlanId: '00400'
          }
        ]),
        stderr: ''
      });

      const jobs = await runner.listJobs();

      assert.strictEqual(jobs.length, 2);
      assert.strictEqual(jobs[0].id, '01864');
      assert.strictEqual(jobs[0].type, 'ExecutePlan');
      assert.strictEqual(jobs[0].status, 'Running');
      assert.strictEqual(jobs[0].message, 'Implementing changes');
      assert.strictEqual(jobs[0].planId, '00399');
      assert.strictEqual(jobs[0].duration, '42s');
      assert.strictEqual(jobs[1].planId, '00400');
      assert.strictEqual(jobs[1].message, undefined);
    });

    it('should return an empty list rather than throw when the CLI fails', async () => {
      const runner = new JobRunner();
      (runner as any).executeCli = async () => {
        throw new Error('no .master file found');
      };

      assert.deepStrictEqual(await runner.listJobs(), []);
    });
  });

  describe('job start output parsing', () => {
    it('should read the job id out of the V2 confirmation line', async () => {
      // V2's `StartOutcome::render` prints "Job started: ID 00458"; V1 printed "Job started: 00458".
      // Without the optional `ID` the capture matched the literal word "ID".
      const runner = new JobRunner();
      (runner as any).executeCli = async () => ({ stdout: 'Job started: ID 00458\n', stderr: '' });

      const result = await runner.startCreatePlan('add dark mode', 'Ivy-Tendril');
      assert.strictEqual(result.jobId, '00458');
    });

    it('should read the job id out of the reconciled confirmation line', async () => {
      const runner = new JobRunner();
      (runner as any).executeCli = async () => ({
        stdout: 'Job started: ID 00459 (confirmation was lost; found in the job list)\n',
        stderr: ''
      });

      assert.strictEqual((await runner.startExecutePlan('00399')).jobId, '00459');
    });

    it('should still read V1s unprefixed confirmation line', async () => {
      const runner = new JobRunner();
      (runner as any).executeCli = async () => ({ stdout: 'Job started: 00460\n', stderr: '' });

      assert.strictEqual((await runner.startRetryPlan('00399', 'fix tests')).jobId, '00460');
    });
  });
});
