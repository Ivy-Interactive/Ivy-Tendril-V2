import * as os from 'os';
import * as path from 'path';

export const TEST_ISOLATION_ENV = 'TENDRIL_TEST_ISOLATION';

export function defaultTendrilHome(): string {
  return path.join(os.homedir(), '.tendril');
}

export function isTestIsolationEnabled(): boolean {
  return process.env[TEST_ISOLATION_ENV] === '1';
}

export function isRealTendrilHome(home: string): boolean {
  if (!home || home.trim().length === 0) {
    return false;
  }

  const normalize = (p: string): string => {
    const resolved = path.resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' || process.platform === 'darwin'
      ? resolved.toLowerCase()
      : resolved;
  };

  return normalize(home) === normalize(defaultTendrilHome());
}

/**
 * Refuses to touch the developer's real Tendril home from a test run.
 *
 * A no-op unless TENDRIL_TEST_ISOLATION=1, so production behaviour is unchanged. Under the flag it
 * throws when the resolved home is the real ~/.tendril, or when TENDRIL_HOME is unset/empty (which
 * means the home was defaulted rather than pinned by the test harness).
 */
export function assertIsolatedTendrilHome(home: string, action: string): void {
  if (!isTestIsolationEnabled()) {
    return;
  }

  const envHome = process.env.TENDRIL_HOME;
  const envHomeIsSet = typeof envHome === 'string' && envHome.trim().length > 0;

  if (!envHomeIsSet) {
    throw new Error(
      `TENDRIL_HOME is not set, so the Tendril home defaulted to ${defaultTendrilHome()}. ` +
        `Test suites must set TENDRIL_HOME to a temp directory (see src/test/testHome.ts). ` +
        `Refusing to ${action} against the real Tendril home ${defaultTendrilHome()}.`
    );
  }

  if (isRealTendrilHome(home)) {
    throw new Error(
      `Test suites must set TENDRIL_HOME to a temp directory (see src/test/testHome.ts). ` +
        `Refusing to ${action} against the real Tendril home ${path.resolve(home)}.`
    );
  }
}
