import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NijamApiError, type NijamClient } from './client.js';
import { listProjects, resolveProjectId, slugify } from './projects.js';
import type {
  ApiArtifact,
  ApiRun,
  FlakyTestsResponse,
  RunDetailResponse,
  RunFileTest,
  RunFileTestsResponse,
  RunListResponse,
  TestDetailResponse,
} from './types.js';

/** Statuses that count as "failing" for a test's final verdict in a run. */
const FAILING = new Set(['failed', 'timedout', 'interrupted']);
const isFailing = (status: string): boolean => FAILING.has(status.toLowerCase());

/** Spec files fetched per run when scanning for tests (keeps huge runs bounded). */
const MAX_FILE_FETCHES = 15;

const PROJECT_PARAM = z
  .string()
  .min(1)
  .describe('Project id (UUID), slug (e.g. "web-checkout"), or name, call get_projects to list them');

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Uniform error surface: API envelope messages + resolver hints become tool errors. */
function guarded<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof NijamApiError) return fail(`${err.code}: ${err.message}`);
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)} … [truncated ${text.length - max} chars]`;
}

/** The run fields a model actually reasons about (drops ids/internals it doesn't). */
function trimRun(run: ApiRun) {
  return {
    id: run.id,
    project: run.projectName,
    status: run.status,
    hadFailure: run.hadFailure,
    branch: run.branch,
    commitSha: run.commitSha,
    prNumber: run.prNumber,
    environment: run.environment,
    author: run.authorEmail,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    stats: run.stats,
    ciRunUrl: run.ciRunUrl,
  };
}

async function latestRun(
  client: NijamClient,
  projectRef: string,
  branch?: string,
): Promise<ApiRun | null> {
  const projectId = await resolveProjectId(client, projectRef);
  const { runs } = await client.get<RunListResponse>(`/v1/projects/${projectId}/runs`, {
    page: 1,
    pageSize: 1,
    branch,
  });
  return runs[0] ?? null;
}

/** Fetch per-test details for `files` of a run, bounded by MAX_FILE_FETCHES. */
async function fetchRunTests(
  client: NijamClient,
  runId: string,
  files: string[],
): Promise<{ tests: Array<RunFileTest & { file: string }>; truncated: boolean }> {
  const scanned = files.slice(0, MAX_FILE_FETCHES);
  const byFile = await Promise.all(
    scanned.map((file) =>
      client.get<RunFileTestsResponse>(`/v1/runs/${runId}/tests`, { file }),
    ),
  );
  const tests = byFile.flatMap((f) => f.tests.map((t) => ({ ...t, file: f.file })));
  return { tests, truncated: files.length > scanned.length };
}

/** Mint URLs for trace artifacts (presigned lazily by the API); soft-fails to null. */
async function withTraceUrls(client: NijamClient, artifacts: ApiArtifact[]): Promise<ApiArtifact[]> {
  return Promise.all(
    artifacts.map(async (a) => {
      if (a.kind !== 'trace' || a.url) return a;
      try {
        const { url } = await client.get<{ url: string }>(`/v1/attachments/${a.id}/url`);
        return { ...a, url };
      } catch {
        return a; // artifact storage unavailable, keep metadata, url stays null
      }
    }),
  );
}

export function registerTools(server: McpServer, client: NijamClient): void {
  server.registerTool(
    'get_projects',
    {
      description:
        'List the Nijam projects this API key can access (id, slug, name). Call this first to resolve a project reference, every other tool takes the id or slug it returns.',
      inputSchema: {},
    },
    guarded(async () => {
      const projects = await listProjects(client);
      if (projects.length === 0) {
        return ok({ projects: [], note: 'This API key has no visible projects.' });
      }
      return ok({
        projects: projects.map((p) => ({
          id: p.id,
          slug: slugify(p.name),
          name: p.name,
          description: p.description,
          defaultBranch: p.defaultBranch,
        })),
      });
    }),
  );

  server.registerTool(
    'get_latest_run',
    {
      description:
        'Get the most recent test run of a project (optionally on one branch): status, pass/fail/flaky counts, commit, CI link.',
      inputSchema: {
        project: PROJECT_PARAM,
        branch: z.string().optional().describe('Only consider runs on this branch'),
      },
    },
    guarded(async ({ project, branch }) => {
      const run = await latestRun(client, project, branch);
      if (!run) {
        const where = branch ? ` on branch "${branch}"` : '';
        return ok({ run: null, note: `No runs found for this project${where} yet.` });
      }
      return ok({ run: trimRun(run) });
    }),
  );

  server.registerTool(
    'list_runs',
    {
      description:
        'List test runs of a project, newest first, filterable by status (passed/failed/flaky), branch; paginated.',
      inputSchema: {
        project: PROJECT_PARAM,
        status: z.enum(['all', 'passed', 'failed', 'flaky']).optional(),
        branch: z.string().optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
      },
    },
    guarded(async ({ project, status, branch, page, page_size }) => {
      const projectId = await resolveProjectId(client, project);
      const res = await client.get<RunListResponse>(`/v1/projects/${projectId}/runs`, {
        status,
        branch,
        page,
        pageSize: page_size,
      });
      return ok({
        runs: res.runs.map(trimRun),
        total: res.total,
        page: res.page,
        totalPages: res.totalPages,
      });
    }),
  );

  server.registerTool(
    'get_run',
    {
      description:
        'Get one run by id: overall status, aggregate stats, and the per-spec-file pass/fail breakdown.',
      inputSchema: { run_id: z.string().uuid() },
    },
    guarded(async ({ run_id }) => {
      const detail = await client.get<RunDetailResponse>(`/v1/runs/${run_id}`);
      return ok({ run: trimRun(detail.run), summary: detail.summary, files: detail.files });
    }),
  );

  server.registerTool(
    'list_failing_tests',
    {
      description:
        'List the failing tests of a run with their error messages. Pass run_id, or pass project (and optionally branch) to use its latest run.',
      inputSchema: {
        run_id: z.string().uuid().optional(),
        project: PROJECT_PARAM.optional(),
        branch: z.string().optional().describe('With project: use the latest run on this branch'),
      },
    },
    guarded(async ({ run_id, project, branch }) => {
      let runId = run_id;
      if (!runId) {
        if (!project) return fail('Pass run_id, or project (optionally with branch).');
        const run = await latestRun(client, project, branch);
        if (!run) return ok({ run: null, note: 'No runs found for this project yet.' });
        runId = run.id;
      }

      const detail = await client.get<RunDetailResponse>(`/v1/runs/${runId}`);
      const failingFiles = detail.files.filter((f) => f.failed > 0).map((f) => f.file);
      if (failingFiles.length === 0) {
        return ok({
          run: trimRun(detail.run),
          failingTests: [],
          note: `No failing tests, run is "${detail.run.status}" (${detail.summary.flaky} flaky).`,
        });
      }

      const { tests, truncated } = await fetchRunTests(client, runId, failingFiles);
      const failing = tests
        .filter((t) => isFailing(t.status))
        .map((t) => {
          const lastFailed = [...t.attempts].reverse().find((a) => isFailing(a.status));
          return {
            testId: t.testId,
            title: t.title,
            file: t.file,
            status: t.status,
            attempts: t.attempts.length,
            error: lastFailed?.errorMessage ? truncate(lastFailed.errorMessage, 700) : null,
          };
        });

      return ok({
        run: trimRun(detail.run),
        failingTestCount: failing.length,
        failingTests: failing,
        ...(truncated && {
          note: `Only the first ${MAX_FILE_FETCHES} failing spec files were scanned (${failingFiles.length} total), use get_run for the full file list.`,
        }),
      });
    }),
  );

  server.registerTool(
    'get_failure',
    {
      description:
        'Get the full failure detail of one test in a run: every attempt with its error message, duration, and artifacts (screenshots/videos/trace links). Identify the test by test_id or a title substring.',
      inputSchema: {
        run_id: z.string().uuid(),
        test_id: z.string().optional(),
        title: z.string().optional().describe('Case-insensitive title substring, if test_id is unknown'),
      },
    },
    guarded(async ({ run_id, test_id, title }) => {
      if (!test_id && !title) return fail('Pass test_id or title.');

      const detail = await client.get<RunDetailResponse>(`/v1/runs/${run_id}`);
      // Failing files first, that's where the sought test almost always lives.
      const ordered = [...detail.files].sort((a, b) => b.failed - a.failed).map((f) => f.file);
      const { tests, truncated } = await fetchRunTests(client, run_id, ordered);

      const wantedTitle = title?.toLowerCase();
      const found = tests.find((t) => {
        if (test_id) return t.testId === test_id;
        return t.title.toLowerCase().includes(wantedTitle!);
      });
      if (!found) {
        const scope = truncated ? ` in the first ${MAX_FILE_FETCHES} spec files of this run` : ' in this run';
        return fail(`No test matching ${test_id ?? `"${title}"`}${scope}. Use list_failing_tests to see test ids.`);
      }

      const attempts = await Promise.all(
        found.attempts.map(async (a) => ({
          retry: a.retry,
          status: a.status,
          durationMs: a.durationMs,
          startedAt: a.startedAt,
          errorMessage: a.errorMessage ? truncate(a.errorMessage, 4000) : null,
          artifacts: (await withTraceUrls(client, a.artifacts)).map((art) => ({
            kind: art.kind,
            name: art.name,
            contentType: art.contentType,
            sizeBytes: art.sizeBytes,
            url: art.url,
          })),
        })),
      );

      return ok({
        runId: run_id,
        testId: found.testId,
        title: found.title,
        titlePath: found.titlePath,
        file: found.file,
        status: found.status,
        attempts,
      });
    }),
  );

  server.registerTool(
    'get_test_history',
    {
      description:
        "One test's result across the last 30 finalized runs of a project, status, duration, commit and branch per run. Good for spotting when it started failing.",
      inputSchema: {
        project: PROJECT_PARAM,
        test_id: z.string().min(1).describe('Stable test id (from list_failing_tests / list_flaky_tests)'),
      },
    },
    guarded(async ({ project, test_id }) => {
      const projectId = await resolveProjectId(client, project);
      const detail = await client.get<TestDetailResponse>(
        `/v1/projects/${projectId}/tests/${encodeURIComponent(test_id)}`,
      );
      return ok(detail);
    }),
  );

  server.registerTool(
    'is_test_flaky',
    {
      description:
        'Verdict on whether one test is flaky: checks its current status and how often it flaked (passed only after failing attempts) across the recent run history.',
      inputSchema: {
        project: PROJECT_PARAM,
        test_id: z.string().min(1).describe('Stable test id (from list_failing_tests / list_flaky_tests)'),
      },
    },
    guarded(async ({ project, test_id }) => {
      const projectId = await resolveProjectId(client, project);
      const detail = await client.get<TestDetailResponse>(
        `/v1/projects/${projectId}/tests/${encodeURIComponent(test_id)}`,
      );
      const flakyRuns = detail.history.filter((h) => h.status === 'flaky');
      const isFlaky = detail.test.status === 'flaky' || flakyRuns.length > 0;

      let explanation: string;
      if (flakyRuns.length > 0) {
        explanation = `Flaked in ${flakyRuns.length} of the last ${detail.history.length} runs (passed only after failing attempts).`;
      } else if (detail.test.status === 'flaky') {
        explanation = 'Marked flaky in its most recent run.';
      } else {
        explanation = `No flakes in the last ${detail.history.length} runs, current status is "${detail.test.status}".`;
      }

      return ok({
        testId: detail.test.testId,
        title: detail.test.title,
        isFlaky,
        currentStatus: detail.test.status,
        flakyRunsInWindow: flakyRuns.length,
        windowSize: detail.history.length,
        lastFlakyAt: flakyRuns[0]?.startedAt ?? null,
        explanation,
      });
    }),
  );

  server.registerTool(
    'list_flaky_tests',
    {
      description:
        'List the tests that were flaky in the last 10 finalized runs of a project, with how often each flaked, the "what should we fix first" view.',
      inputSchema: { project: PROJECT_PARAM },
    },
    guarded(async ({ project }) => {
      const projectId = await resolveProjectId(client, project);
      const res = await client.get<FlakyTestsResponse>(`/v1/projects/${projectId}/flaky-tests`);
      return ok({
        runWindow: res.runWindow,
        flakyTests: res.tests.map((t) => ({
          testId: t.testId,
          title: t.title,
          file: t.file,
          flakeCount: t.flakeCount,
          lastRunAt: t.lastRunAt,
        })),
      });
    }),
  );
}
