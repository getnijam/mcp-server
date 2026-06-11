/** Response shapes of the Nijam API endpoints this server reads (subset). */

export interface ApiProject {
  id: string;
  name: string;
  description: string | null;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  createdAt: string;
}

export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export interface ApiRun {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  hadFailure: boolean;
  environment: string | null;
  commitSha: string | null;
  branch: string | null;
  prNumber: string | null;
  repository: string | null;
  authorEmail: string | null;
  authorName: string | null;
  ciProvider: string | null;
  ciRunId: string | null;
  ciRunUrl: string | null;
  startedAt: string;
  finishedAt: string | null;
  stats: RunStats | null;
}

export interface RunListResponse {
  runs: ApiRun[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RunFileSummary {
  file: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

export interface RunDetailResponse {
  run: ApiRun;
  summary: {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
    durationSec: number | null;
  };
  files: RunFileSummary[];
}

export interface ApiArtifact {
  id: string;
  kind: 'trace' | 'screenshot' | 'video';
  contentType: string;
  sizeBytes: number;
  name: string | null;
  /** Presigned URL; null for traces (minted on demand via /v1/attachments/{id}/url). */
  url: string | null;
}

export interface ApiAttempt {
  id: string;
  retry: number;
  status: string;
  durationMs: number;
  errorMessage: string | null;
  shardIndex: number | null;
  startedAt: string;
  artifacts: ApiArtifact[];
}

export interface RunFileTest {
  testId: string;
  title: string;
  titlePath: string[];
  status: string;
  attempts: ApiAttempt[];
}

export interface RunFileTestsResponse {
  file: string;
  tests: RunFileTest[];
}

export interface TestCaseSummary {
  testId: string;
  title: string;
  titlePath: string[];
  file: string;
  status: string;
  durationMs: number;
  retries: number;
  line: number | null;
  lastRunAt: string;
}

export interface TestHistoryEntry {
  runId: string;
  status: string;
  commitSha: string | null;
  branch: string | null;
  durationMs: number;
  startedAt: string;
}

export interface TestDetailResponse {
  test: TestCaseSummary;
  history: TestHistoryEntry[];
  latestRun: {
    id: string;
    commitSha: string | null;
    branch: string | null;
    repository: string | null;
    ciProvider: string | null;
    ciRunUrl: string | null;
  } | null;
}

export interface FlakyTestsResponse {
  tests: Array<TestCaseSummary & { flakeCount: number }>;
  runWindow: number;
}
