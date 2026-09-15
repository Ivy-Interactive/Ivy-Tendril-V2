import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ServerManager } from '../../server/serverManager';
import { waitForMaster } from '../testHome';
const vscodeMock = vscode as any;

function makeTempHome(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Server Readiness Suite', () => {
  describe('waitForMaster', () => {
    it('resolves once .master appears mid-poll', async () => {
      const home = makeTempHome('readiness-midpoll-');
      const masterFile = path.join(home, '.master');

      const writeTimer = setTimeout(() => {
        fs.writeFileSync(
          masterFile,
          JSON.stringify({ pid: process.pid, port: 4242, scheme: 'http', heartbeat: new Date().toISOString() })
        );
      }, 200);

      try {
        const start = Date.now();
        const master = await waitForMaster(home, 5000);
        const elapsed = Date.now() - start;

        assert.strictEqual(master.pid, process.pid);
        assert.strictEqual(master.port, 4242);
        assert.ok(elapsed < 5000, `Should resolve well before the 5000ms deadline (took ${elapsed}ms)`);
      } finally {
        clearTimeout(writeTimer);
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('rejects with a diagnostic on deadline', async () => {
      const home = makeTempHome('readiness-timeout-');
      fs.writeFileSync(path.join(home, 'marker-file.txt'), 'unrelated');

      try {
        await assert.rejects(
          () => waitForMaster(home, 300),
          (err: Error) => {
            assert.ok(err.message.includes(home), `Message must name the home: ${err.message}`);
            assert.ok(err.message.includes('300'), `Message must name the timeout: ${err.message}`);
            assert.ok(
              err.message.includes('marker-file.txt'),
              `Message must include the directory listing: ${err.message}`
            );
            return true;
          }
        );
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('tolerates a torn/partial .master', async () => {
      const home = makeTempHome('readiness-torn-');
      const masterFile = path.join(home, '.master');

      fs.writeFileSync(masterFile, '{"pid":');

      const completeTimer = setTimeout(() => {
        fs.writeFileSync(
          masterFile,
          JSON.stringify({ pid: process.pid, port: 5151, scheme: 'http', heartbeat: new Date().toISOString() })
        );
      }, 150);

      try {
        const master = await waitForMaster(home, 5000);
        assert.strictEqual(master.pid, process.pid);
        assert.strictEqual(master.port, 5151);
      } finally {
        clearTimeout(completeTimer);
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe('readiness gate rejects an un-pinged .master', () => {
    let originalConfig: Record<string, unknown>;

    beforeEach(() => {
      originalConfig = vscodeMock.workspace.__getConfig();
    });

    afterEach(() => {
      vscodeMock.workspace.__resetConfig();
      vscodeMock.workspace.__setConfig(originalConfig);
    });

    it('does not report ready when the recorded port answers nothing', async () => {
      const home = makeTempHome('readiness-deadport-');

      // Bind an ephemeral port, capture it, then close it immediately so nothing answers there.
      const deadPort = await new Promise<number>((resolve, reject) => {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1', () => {
          const address = probe.address();
          const port = typeof address === 'object' && address ? address.port : 0;
          probe.close(() => resolve(port));
        });
        probe.on('error', reject);
      });

      fs.writeFileSync(
        path.join(home, '.master'),
        JSON.stringify({
          pid: process.pid,
          port: deadPort,
          scheme: 'http',
          heartbeat: new Date().toISOString()
        })
      );

      vscodeMock.workspace.__setConfig({
        'tendril.homeDirectory': home,
        'tendril.server.autoStart': false,
        'tendril.server.pollTimeout': 1000
      });

      try {
        const manager = new ServerManager();
        await assert.rejects(
          () => manager.ensureServerRunning(),
          /autoStart is disabled/,
          'A .master that does not answer /api/ping must never be treated as the ready result'
        );
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });
});
