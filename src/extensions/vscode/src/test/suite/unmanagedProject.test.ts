import * as assert from 'assert';
import { fetchActiveJobsCount, fetchProjects, fetchRecentPlans, isWorkspaceManaged } from '../../server/masterDiscovery';
import { TendrilProjectSummary } from '../../server/types';

describe('Unmanaged Project Detection Suite', () => {
  describe('fetchProjects', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should read repo paths out of the V2 RepoRef objects', async () => {
      // `GET /api/projects` returns `ProjectConfig`, whose `repos` is `Vec<RepoRef>`:
      // `[{ path, baseBranch }]`. V1 returned a bare `string[]`, and stringifying a RepoRef gives
      // "[object Object]", so every workspace looked unmanaged.
      const mockProjects = [
        {
          name: 'ProjectAlpha',
          color: 'green',
          repos: [
            { path: '/repos/alpha', baseBranch: 'main' },
            { path: '/repos/alpha-docs' }
          ]
        },
        {
          // `color` is a non-optional String on the daemon side, empty when unset.
          name: 'ProjectBeta',
          color: '',
          repos: [{ path: '/repos/beta', baseBranch: 'develop' }]
        }
      ];

      globalThis.fetch = (async (url: RequestInfo | URL) => {
        assert.ok(String(url).includes('/api/projects'));
        return {
          ok: true,
          json: async () => mockProjects
        } as Response;
      }) as typeof fetch;

      const result = await fetchProjects('http://127.0.0.1:5010');
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].name, 'ProjectAlpha');
      assert.strictEqual(result[0].color, 'green');
      assert.deepStrictEqual(result[0].repos, ['/repos/alpha', '/repos/alpha-docs']);
      assert.strictEqual(result[1].name, 'ProjectBeta');
      assert.strictEqual(result[1].color, undefined);
      assert.deepStrictEqual(result[1].repos, ['/repos/beta']);
    });

    it('should still accept bare path strings', async () => {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          json: async () => [{ name: 'Legacy', repos: ['/repos/legacy'] }]
        }) as Response) as typeof fetch;

      const result = await fetchProjects('http://127.0.0.1:5010');
      assert.deepStrictEqual(result[0].repos, ['/repos/legacy']);
    });

    it('should send the bearer secret and the configured api key', async () => {
      let sent: Record<string, string> = {};
      globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        sent = (init?.headers ?? {}) as Record<string, string>;
        return { ok: true, json: async () => [] } as Response;
      }) as typeof fetch;

      await fetchProjects('http://127.0.0.1:5010', { secret: 'abc', apiKey: 'xyz' });

      assert.strictEqual(sent['Authorization'], 'Bearer abc');
      assert.strictEqual(sent['X-Api-Key'], 'xyz');
    });

    it('should return empty array on non-ok HTTP response', async () => {
      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 401
        } as Response;
      }) as typeof fetch;

      const result = await fetchProjects('http://127.0.0.1:5010');
      assert.deepStrictEqual(result, []);
    });
  });

  describe('fetchRecentPlans', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should read the nested snake_case PlanFile the V2 daemon returns', async () => {
      // V1 returned a flat camelCase plan; V2 returns `PlanFile { metadata, ... }` with an integer
      // `metadata.id`, so every field here comes out of `metadata` and the id is padded back to the
      // five-digit form Tendril displays everywhere else.
      const plans = [
        {
          metadata: {
            id: 399,
            project: 'Ivy-Tendril',
            level: 'Feature',
            title: 'Add dark mode support',
            state: 'Review',
            related_plans: [],
            depends_on: [],
            initial_prompt: 'add dark mode'
          },
          folder_name: '00399-AddDarkMode',
          revision_count: 2
        }
      ];

      let requestedUrl = '';
      globalThis.fetch = (async (url: RequestInfo | URL) => {
        requestedUrl = String(url);
        return { ok: true, json: async () => plans } as Response;
      }) as typeof fetch;

      const result = await fetchRecentPlans('http://127.0.0.1:5010', 5, { secret: 'abc' });

      assert.ok(requestedUrl.endsWith('/api/plans?limit=5'));
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, '00399');
      assert.strictEqual(result[0].title, 'Add dark mode support');
      assert.strictEqual(result[0].state, 'Review');
      assert.strictEqual(result[0].project, 'Ivy-Tendril');
      assert.strictEqual(result[0].level, 'Feature');
    });

    it('should return an empty list when the daemon rejects the request', async () => {
      globalThis.fetch = (async () => ({ ok: false, status: 401 }) as Response) as typeof fetch;
      assert.deepStrictEqual(await fetchRecentPlans('http://127.0.0.1:5010'), []);
    });
  });

  describe('fetchActiveJobsCount', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should count the running jobs the daemon reports', async () => {
      let requestedUrl = '';
      globalThis.fetch = (async (url: RequestInfo | URL) => {
        requestedUrl = String(url);
        return { ok: true, json: async () => [{ id: '00001' }, { id: '00002' }] } as Response;
      }) as typeof fetch;

      const count = await fetchActiveJobsCount('http://127.0.0.1:5010', { secret: 'abc' });

      assert.ok(requestedUrl.includes('status=Running'));
      assert.strictEqual(count, 2);
    });

    it('should read as zero when the request fails', async () => {
      globalThis.fetch = (async () => {
        throw new Error('connection refused');
      }) as typeof fetch;

      assert.strictEqual(await fetchActiveJobsCount('http://127.0.0.1:5010'), 0);
    });
  });

  describe('isWorkspaceManaged', () => {
    const projects: TendrilProjectSummary[] = [
      {
        name: 'Ivy-Tendril',
        repos: ['/Users/dev/git/ivy-tendril', 'C:\\repos\\Ivy-Tendril']
      },
      {
        name: 'SecondaryProject',
        repos: ['/Users/dev/git/secondary/']
      }
    ];

    it('should match workspace folder with exact match', () => {
      const status = isWorkspaceManaged('/Users/dev/git/ivy-tendril', projects);
      assert.strictEqual(status.isManaged, true);
      assert.strictEqual(status.projectName, 'Ivy-Tendril');
    });

    it('should match workspace folder handling case insensitivity and normalized separators', () => {
      // Different casing
      const caseStatus = isWorkspaceManaged('/users/dev/git/IVY-TENDRIL', projects);
      assert.strictEqual(caseStatus.isManaged, true);
      assert.strictEqual(caseStatus.projectName, 'Ivy-Tendril');

      // Trailing slashes
      const trailingSlashStatus = isWorkspaceManaged('/Users/dev/git/ivy-tendril/', projects);
      assert.strictEqual(trailingSlashStatus.isManaged, true);
      assert.strictEqual(trailingSlashStatus.projectName, 'Ivy-Tendril');

      // Windows paths with backslashes
      const windowsStatus = isWorkspaceManaged('c:\\repos\\ivy-tendril', projects);
      assert.strictEqual(windowsStatus.isManaged, true);
      assert.strictEqual(windowsStatus.projectName, 'Ivy-Tendril');

      // Subfolder inside registered repo
      const subfolderStatus = isWorkspaceManaged('/Users/dev/git/ivy-tendril/src/Ivy.Tendril', projects);
      assert.strictEqual(subfolderStatus.isManaged, true);
      assert.strictEqual(subfolderStatus.projectName, 'Ivy-Tendril');
    });

    it('should detect unmanaged status when workspace folder is not in registered projects list', () => {
      const unmanaged = isWorkspaceManaged('/Users/dev/git/unknown-new-project', projects);
      assert.strictEqual(unmanaged.isManaged, false);
      assert.strictEqual(unmanaged.projectName, undefined);
    });

    it('should return isManaged true for empty workspace path', () => {
      const empty = isWorkspaceManaged('', projects);
      assert.strictEqual(empty.isManaged, true);
    });
  });
});
