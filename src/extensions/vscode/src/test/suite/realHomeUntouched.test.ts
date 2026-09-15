import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TEST_ISOLATION_ENV } from '../../server/homeGuard';

const CHILD_ENV = 'TENDRIL_ISOLATION_CHILD';

/**
 * Runs the whole extension suite as a child process with HOME pointed at a fake home containing a
 * seeded ~/.tendril/.master, and proves the run never touches it. This is the regression test for
 * the incident where the suite spawned a real server that seized the developer's live .master.
 */
describe('Real Tendril Home Untouched Suite', () => {
  it('should leave a seeded ~/.tendril/.master untouched across a full suite run', function (done) {
    if (process.env[CHILD_ENV] === '1') {
      this.skip();
      return;
    }

    this.timeout(300000);

    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tendril-fake-home-'));
    const fakeTendrilHome = path.join(fakeHome, '.tendril');
    fs.mkdirSync(fakeTendrilHome, { recursive: true });

    const masterFile = path.join(fakeTendrilHome, '.master');
    const seeded = JSON.stringify(
      {
        pid: process.pid,
        port: 5010,
        scheme: 'http',
        host: '127.0.0.1',
        secret: 'production-secret-do-not-touch',
        startedAt: new Date().toISOString(),
        heartbeat: new Date().toISOString()
      },
      null,
      2
    );
    fs.writeFileSync(masterFile, seeded);
    const seededStat = fs.statSync(masterFile);
    const seededEntries = fs.readdirSync(fakeTendrilHome).sort();

    const runTestJs = path.resolve(__dirname, '../runTest.js');
    const extensionRoot = path.resolve(__dirname, '../../..');

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      [CHILD_ENV]: '1'
    };
    // The child must isolate itself: nothing about the home may be inherited.
    delete childEnv.TENDRIL_HOME;
    delete childEnv.TENDRIL_PLANS;
    delete childEnv.TENDRIL_CONFIG;
    delete childEnv[TEST_ISOLATION_ENV];

    const child = cp.spawn(process.execPath, [runTestJs], {
      cwd: extensionRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', err => done(err));

    child.on('exit', (code: number | null) => {
      try {
        assert.strictEqual(
          code,
          0,
          `Child suite must pass.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
        );

        assert.strictEqual(
          fs.readFileSync(masterFile, 'utf-8'),
          seeded,
          'Seeded .master content must be byte-identical after the suite run'
        );
        assert.strictEqual(
          fs.statSync(masterFile).mtimeMs,
          seededStat.mtimeMs,
          'Seeded .master must not have been rewritten'
        );
        assert.deepStrictEqual(
          fs.readdirSync(fakeTendrilHome).sort(),
          seededEntries,
          'No new files may appear under the (fake) real Tendril home'
        );

        fs.rmSync(fakeHome, { recursive: true, force: true });
        done();
      } catch (err) {
        done(err as Error);
      }
    });
  });
});
