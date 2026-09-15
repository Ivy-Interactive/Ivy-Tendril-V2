import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  assertIsolatedTendrilHome,
  defaultTendrilHome,
  isRealTendrilHome,
  TEST_ISOLATION_ENV
} from '../../server/homeGuard';
import { JobRunner } from '../../jobs/jobRunner';
import { ServerManager } from '../../server/serverManager';
import { readStubInvocations } from '../testHome';
const vscodeMock = vscode as any;

describe('Tendril Home Guard Suite', () => {
  const realHome = defaultTendrilHome();

  describe('isRealTendrilHome', () => {
    it('should recognise the real Tendril home and reject temp homes', () => {
      assert.strictEqual(isRealTendrilHome(realHome), true);
      assert.strictEqual(isRealTendrilHome(realHome + path.sep), true);
      assert.strictEqual(isRealTendrilHome(path.join(os.homedir(), '.tendril-other')), false);
      assert.strictEqual(isRealTendrilHome(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'))), false);
      assert.strictEqual(isRealTendrilHome(''), false);
    });
  });

  describe('isolated home environment', () => {
    it('should pin every home-overriding variable inside the temp home', () => {
      const isolatedHome = process.env.TENDRIL_HOME as string;

      assert.ok(isolatedHome, 'The suite must run with TENDRIL_HOME set');
      assert.strictEqual(isRealTendrilHome(isolatedHome), false, 'TENDRIL_HOME must be a temp home');
      // TENDRIL_PLANS and TENDRIL_CONFIG outrank the home-derived paths, so an inherited value from
      // the developer's shell would send writes back to the live Plans directory regardless.
      assert.strictEqual(process.env.TENDRIL_PLANS, path.join(isolatedHome, 'Plans'));
      assert.strictEqual(process.env.TENDRIL_CONFIG, path.join(isolatedHome, 'config.yaml'));
    });
  });

  describe('assertIsolatedTendrilHome', () => {
    let originalHome: string | undefined;
    let originalFlag: string | undefined;

    beforeEach(() => {
      originalHome = process.env.TENDRIL_HOME;
      originalFlag = process.env[TEST_ISOLATION_ENV];
    });

    afterEach(() => {
      if (originalHome === undefined) {
        delete process.env.TENDRIL_HOME;
      } else {
        process.env.TENDRIL_HOME = originalHome;
      }
      if (originalFlag === undefined) {
        delete process.env[TEST_ISOLATION_ENV];
      } else {
        process.env[TEST_ISOLATION_ENV] = originalFlag;
      }
    });

    it('should throw and name the path when the home is the real Tendril home', () => {
      process.env[TEST_ISOLATION_ENV] = '1';
      process.env.TENDRIL_HOME = realHome;

      assert.throws(
        () => assertIsolatedTendrilHome(realHome, 'start a Tendril server'),
        (err: Error) => {
          assert.ok(err.message.includes(realHome), `Message must name the home: ${err.message}`);
          assert.ok(err.message.includes('Refusing to start a Tendril server'));
          assert.ok(err.message.includes('TENDRIL_HOME'));
          return true;
        }
      );
    });

    it('should throw when TENDRIL_HOME is unset or empty, so the home is defaulted', () => {
      process.env[TEST_ISOLATION_ENV] = '1';
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-unset-'));

      delete process.env.TENDRIL_HOME;
      assert.throws(
        () => assertIsolatedTendrilHome(tempHome, 'start a Tendril server'),
        /TENDRIL_HOME is not set/
      );

      process.env.TENDRIL_HOME = '   ';
      assert.throws(
        () => assertIsolatedTendrilHome(tempHome, 'start a Tendril server'),
        /TENDRIL_HOME is not set/
      );
    });

    it('should not throw for an isolated temp home', () => {
      process.env[TEST_ISOLATION_ENV] = '1';
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-ok-'));
      process.env.TENDRIL_HOME = tempHome;

      assert.doesNotThrow(() => assertIsolatedTendrilHome(tempHome, 'start a Tendril server'));
    });

    it('should not throw for the real home when the isolation flag is absent (production)', () => {
      delete process.env[TEST_ISOLATION_ENV];
      delete process.env.TENDRIL_HOME;

      assert.doesNotThrow(() => assertIsolatedTendrilHome(realHome, 'start a Tendril server'));
    });
  });

  describe('product paths refuse the real home under isolation', () => {
    const isolatedHome = process.env.TENDRIL_HOME as string;

    beforeEach(() => {
      vscodeMock.workspace.__setConfig({ 'tendril.homeDirectory': realHome });
    });

    afterEach(() => {
      vscodeMock.workspace.__setConfig({ 'tendril.homeDirectory': isolatedHome });
    });

    it('should reject ServerManager.startServer without spawning anything', async () => {
      const before = readStubInvocations(isolatedHome).length;
      const manager = new ServerManager();

      await assert.rejects(
        () => manager.startServer(),
        (err: Error) => {
          assert.ok(err.message.includes('Refusing to start a Tendril server'), err.message);
          assert.ok(err.message.includes(realHome), err.message);
          return true;
        }
      );

      assert.strictEqual(
        readStubInvocations(isolatedHome).length,
        before,
        'No executable may be spawned when the guard trips'
      );
      manager.dispose();
    });

    it('should reject ServerManager.executeCli without spawning anything', async () => {
      const before = readStubInvocations(isolatedHome).length;
      const manager = new ServerManager();

      await assert.rejects(
        () => manager.executeCli(['job', 'start', 'CreatePlan']),
        /Refusing to run 'tendril job start CreatePlan'/
      );

      assert.strictEqual(readStubInvocations(isolatedHome).length, before);
      manager.dispose();
    });

    it('should reject JobRunner.executeCli without spawning anything', async () => {
      const before = readStubInvocations(isolatedHome).length;
      const runner = new JobRunner();

      await assert.rejects(
        () => runner.executeCli(['job', 'list']),
        (err: Error) => {
          assert.ok(err.message.includes("Refusing to run 'tendril job list'"), err.message);
          assert.ok(err.message.includes(realHome), err.message);
          return true;
        }
      );

      assert.strictEqual(readStubInvocations(isolatedHome).length, before);
    });
  });
});
