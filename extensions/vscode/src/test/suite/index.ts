import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';
import { vscodeMock } from '../vscodeMock';
import { createIsolatedTendrilHome, stubTendrilExecutablePath } from '../testHome';

// If running in standalone Node environment without VS Code Extension Host:
try {
  require.resolve('vscode');
} catch {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') {
      return vscodeMock;
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };
}

export async function run(): Promise<void> {
  // Isolate TENDRIL_HOME before any test file is loaded: module-level code must already see the
  // temp home, and nothing in the suite may reach the developer's real ~/.tendril.
  const home = createIsolatedTendrilHome();
  const stubExecutable = stubTendrilExecutablePath(home.path);
  vscodeMock.workspace.__setConfig({
    'tendril.homeDirectory': home.path,
    'tendril.executablePath': stubExecutable,
    'tendril.server.stopOnExit': true
  });

  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 10000
  });

  const testsRoot = path.resolve(__dirname, '.');

  const files = await glob('**/**.test.js', { cwd: testsRoot });
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  try {
    await new Promise<void>((resolve, reject) => {
      try {
        mocha.run(failures => {
          if (failures > 0) {
            reject(new Error(`${failures} tests failed.`));
          } else {
            resolve();
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  } finally {
    home.dispose();
  }
}
