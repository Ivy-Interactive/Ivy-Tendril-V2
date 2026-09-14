import * as path from 'path';
import { run } from './suite/index';
import { createIsolatedTendrilHome } from './testHome';
import { TEST_ISOLATION_ENV } from '../server/homeGuard';

async function main(): Promise<void> {
  try {
    if (process.env.VSCODE_TEST_ELECTRON === '1') {
      const { runTests } = await import('@vscode/test-electron');
      const extensionDevelopmentPath = path.resolve(__dirname, '../../');
      const extensionTestsPath = path.resolve(__dirname, './suite/index');
      // The Extension Host is a separate process, so the isolated home is passed explicitly rather
      // than relying on environment inheritance.
      const home = createIsolatedTendrilHome();
      try {
        await runTests({
          extensionDevelopmentPath,
          extensionTestsPath,
          extensionTestsEnv: { TENDRIL_HOME: home.path, [TEST_ISOLATION_ENV]: '1' },
          launchArgs: ['--user-data-dir', path.join(home.path, 'vscode-user'), '--disable-extensions']
        });
      } finally {
        home.dispose();
      }
    } else {
      console.log('Running Tendril extension test suite...');
      await run();
      console.log('All tests passed successfully.');
    }
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

void main();
