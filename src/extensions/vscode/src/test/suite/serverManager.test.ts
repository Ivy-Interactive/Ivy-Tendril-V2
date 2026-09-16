import * as assert from 'assert';
import * as net from 'net';
import {
  buildServerArgs,
  DEFAULT_SERVER_PORT,
  findAvailablePort,
  isPortInUse
} from '../../server/serverManager';

describe('ServerManager Suite', () => {
  describe('buildServerArgs', () => {
    it('should launch the V2 daemon with tendril run, not V1s --web flag', () => {
      // `--web` and `--find-available-port` are Ivy-Framework flags that the Rust CLI does not
      // define, so either one is a clap parse error and the spawn dies on startup.
      const args = buildServerArgs(5015);
      assert.deepStrictEqual(args, ['run', '--port=5015', '--host=127.0.0.1']);
    });

    it('should always name a concrete port', () => {
      // `MasterGuard::acquire` records the *requested* port in `.master`, so `--port=0` would
      // publish `port: 0` while the listener sat on an ephemeral port and nothing could find it.
      for (const port of [0, -1, undefined]) {
        const args = buildServerArgs(port as number);
        assert.deepStrictEqual(args, ['run', `--port=${DEFAULT_SERVER_PORT}`, '--host=127.0.0.1']);
      }
    });
  });

  describe('findAvailablePort', () => {
    it('should skip a port that is already bound', async () => {
      const taken = await new Promise<net.Server>((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => resolve(probe));
      });

      const address = taken.address();
      const takenPort = typeof address === 'object' && address ? address.port : 0;

      try {
        assert.strictEqual(await isPortInUse(takenPort), true);
        const found = await findAvailablePort(takenPort, 16);
        assert.ok(found > takenPort, `Expected a port above ${takenPort}, got ${found}`);
        assert.strictEqual(await isPortInUse(found), false);
      } finally {
        await new Promise<void>(resolve => taken.close(() => resolve()));
      }
    });

    it('should reject with an actionable message rather than return an unusable port', async () => {
      // Above the port range, so the search has nothing to try and must say what to do instead.
      await assert.rejects(() => findAvailablePort(70000, 4), /No free port found/);
      await assert.rejects(() => findAvailablePort(70000, 4), /tendril\.server\.port/);
    });
  });
});
