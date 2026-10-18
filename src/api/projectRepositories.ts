import { http } from './client';

export interface ProjectRepository {
  id: string;
  ownerId: string;
  fullName: string;
  private: boolean;
  webhookScanEnabled: boolean;
  autoAnalysisEnabled: boolean;
  autoAnalysisModelId: string | null;
  autoAnalysisTokenBudget: number | null;
  autoAnalysisCostBudgetUsd: number | null;
  url: string;
  branch: string;
  goal: string;
  requirementBaseline: string;
  baselineVersionId: string | null;
  commitSha: string;
  lastCheckedAt: string;
  lastAnalysisAt: string | null;
  lastAnalyzedCommitSha: string | null;
  createdAt: string;
  updatedAt: string;
}

export const listProjectRepositories = () => http.get<{ items: ProjectRepository[] }>('/project-repositories');
export interface ProjectGithubConnection { configured: boolean; connected: boolean; githubLogin: string | null; accessExpiresAt: string | null; refreshExpiresAt: string | null }
export const getProjectGithubConnection = () => http.get<ProjectGithubConnection>('/project-github');
export const startProjectGithubConnection = () => http.post<{ url: string }>('/project-github/start', {});
export const disconnectProjectGithub = () => http.del<{ connected: false }>('/project-github');
export interface GithubAvailableRepository { fullName: string; private: boolean; defaultBranch: string | null }
export const listGithubAvailableRepositories = () => http.get<{ items: GithubAvailableRepository[]; truncated: boolean }>('/project-github/repositories');
export const createProjectRepository = (body: { url: string; branch?: string; goal: string; requirementBaseline?: string; useGithubApp?: boolean }) => http.post<ProjectRepository>('/project-repositories', body);
export const updateProjectRepository = (item: ProjectRepository, body: { goal: string; requirementBaseline: string }) => http.patch<ProjectRepository>(`/project-repositories/${item.id}`, {
  ...body, expectedGoal: item.goal, expectedRequirementBaseline: item.requirementBaseline, expectedBaselineVersionId: item.baselineVersionId,
});
export const refreshProjectRepository = (id: string) => http.post<ProjectRepository>(`/project-repositories/${id}/refresh`, {});
export const updateProjectWebhookScan = (item: ProjectRepository, enabled: boolean) => http.patch<ProjectRepository>(`/project-repositories/${item.id}/webhook-scan`, { enabled, expectedEnabled: item.webhookScanEnabled });
export const updateProjectAutoAnalysis = (item: ProjectRepository, config: { enabled: boolean; modelId?: string; tokenBudget?: number; costBudgetUsd?: number; confirmRecurringCost?: boolean }) => http.patch<ProjectRepository>(`/project-repositories/${item.id}/auto-analysis`, { ...config, expectedEnabled: item.autoAnalysisEnabled });
export interface ProjectLinkedTask { id: string; title: string; status: string; progress: number | null; ownerId?: string; requirementId: string | null }
export const listProjectLinkedTasks = (repositoryId: string) => http.get<{ items: ProjectLinkedTask[]; requirements: { id: string; text: string }[]; baselineVersionId: string | null }>(`/project-repositories/${repositoryId}/tasks`);
export const linkProjectTask = (repositoryId: string, taskId: string, requirementId: string | null, expectedBaselineVersionId: string | null) => http.post<ProjectLinkedTask>(`/project-repositories/${repositoryId}/tasks`, { taskId, requirementId, expectedBaselineVersionId });
export const updateProjectLinkedTaskRequirement = (repositoryId: string, taskId: string, requirementId: string | null, expectedBaselineVersionId: string | null) => http.patch<ProjectLinkedTask>(`/project-repositories/${repositoryId}/tasks/${encodeURIComponent(taskId)}`, { requirementId, expectedBaselineVersionId });
export const unlinkProjectTask = (repositoryId: string, taskId: string) => http.del<{ deleted: boolean; taskId: string }>(`/project-repositories/${repositoryId}/tasks/${encodeURIComponent(taskId)}`);
export interface ProjectRequirementBaseline { id: string; repositoryId: string; version: number; contentSha256: string; createdAt: string; content?: string }
export const listProjectRequirementBaselines = (repositoryId: string) => http.get<{ items: ProjectRequirementBaseline[] }>(`/project-repositories/${repositoryId}/baselines`);
export const getProjectRequirementBaseline = (repositoryId: string, baselineId: string) => http.get<ProjectRequirementBaseline>(`/project-repositories/${repositoryId}/baselines/${baselineId}`);
export const createProjectRequirementBaseline = (repositoryId: string, content: string, currentVersionId: string | null) => http.post<ProjectRequirementBaseline>(`/project-repositories/${repositoryId}/baselines`, { content, currentVersionId });

export interface ProjectScan {
  id: string;
  repositoryId: string;
  commitSha: string;
  treeSha: string | null;
  status: 'queued' | 'scanning' | 'completed' | 'partial' | 'failed';
  coverageComplete: boolean;
  forceFull: boolean;
  triggerSource: 'manual' | 'webhook';
  autoAnalysisState: 'none' | 'pending' | 'processing' | 'approval_required' | 'queued' | 'skipped' | 'failed';
  autoAnalysisError: string | null;
  autoAnalysisId: string | null;
  baselineCommitSha: string | null;
  budgetFileLimit: number;
  budgetByteLimit: number;
  readCount: number;
  attemptedCount: number;
  reusedCount: number;
  cacheSourceCommitSha: string | null;
  excludedCount: number;
  failedCount: number;
  unscannedCount: number;
  unscannedSubtrees: number;
  totalBytes: number;
  retryCount: number;
  nextAttemptAt: string | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface ProjectScanFile { path: string; gitSha: string; size: number | null; category: string; status: 'read' | 'excluded' | 'failed' | 'unscanned'; reason: string | null; contentSha256: string | null }
export const listProjectScans = (repositoryId: string) => http.get<{ items: ProjectScan[] }>(`/project-repositories/${repositoryId}/scans`);
export type ProjectScanChange = { kind: 'added' | 'modified' | 'deleted' | 'renamed'; path: string; oldPath: string | null; oldGitSha: string | null; newGitSha: string | null };
export const startProjectScan = (repositoryId: string, budget: { budgetFileLimit: number; budgetByteLimit: number; forceFull: boolean }) => http.post<ProjectScan>(`/project-repositories/${repositoryId}/scans`, budget);
export const getProjectScan = (repositoryId: string, scanId: string) => http.get<ProjectScan & { files: ProjectScanFile[]; changes: ProjectScanChange[] }>(`/project-repositories/${repositoryId}/scans/${scanId}`);
export const getProjectScanFile = (repositoryId: string, scanId: string, path: string) => http.get<{ path: string; gitSha: string; contentSha256: string | null; content: string }>(`/project-repositories/${repositoryId}/scans/${scanId}/files?path=${encodeURIComponent(path)}`);

export interface ProjectAnalysisJob {
  id: string; repositoryId: string; scanId: string; commitSha: string; branch: string;
  triggerSource: 'manual' | 'webhook';
  baselineVersionId: string | null;
  modelId: string; model: string; status: 'queued' | 'analyzing' | 'completed' | 'failed' | 'canceled';
  attempts: number; maxAttempts: number; canceledAt: string | null;
  errorCode: string | null; summary: string | null; selectedFileCount: number;
  availableFileCount: number; analysisCoverageComplete: boolean;
  reusedCallCount: number;
  tokenBudget: number | null; costBudgetUsd: number | null;
  promptTokens: number | null; completionTokens: number | null; costUsd: number | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}
export interface ProjectAnalysisReport extends ProjectAnalysisJob {
  fullName: string; goal: string; requirementBaseline: string; staleReasons: string[];
  reusedCalls: { moduleKey: string; sourceCommitSha: string | null }[];
  executionScope: { plannedCount: number; completedCount: number; remainingModules: string[]; selectedFileCount: number } | null;
  scanScope: { forceFull: boolean; baselineCommitSha: string | null; comparisonComplete: boolean; changes: Partial<Record<ProjectScanChange['kind'], number>>; gaps: { fileBudget: number; byteBudget: number; legacyBudget: number; unindexed: number; unscannedSubtrees: number; failed: number } };
  requirements: { id: string; text: string }[];
  modules: { moduleKey: string; indexedCount: number; readCount: number; selectedCount: number; truncatedCount: number; excludedCount: number; failedCount: number; unscannedCount: number; summary: string | null }[];
  flows: { id: string; moduleKey: string | null; title: string; steps: { description: string; evidence: { type: 'code' | 'test'; path: string; line: number; excerpt: string; gitSha: string } }[] }[];
  technologies: { name: string; packageName: string; evidence: { path: string; line: number; excerpt: string; gitSha: string } }[];
  linkedTasks: { id: string; requirementId: string | null; title: string; status: string; progress: number | null; ownerId: string | null; taskVersion: number | null; capturedAt: string; currentlyAvailable: boolean }[];
  findings: { id: string; requirementId: string | null; moduleKey: string | null; title: string; status: 'implemented' | 'partial' | 'not_found' | 'unverified'; detail: string; evidence: null | { type: 'code' | 'test' | 'document'; path: string; line: number; excerpt: string; gitSha: string }; feedback: { id: string; correctedStatus: 'implemented' | 'partial' | 'not_found' | 'unverified'; reason: string; author: string; createdAt: string }[] }[];
  suggestions: { id: string; findingId: string | null; topic: string; reason: string; practice: string; acceptance: string; impact: 'high' | 'medium' | 'low' | null; impactReason: string | null; prerequisites: string[]; status: 'pending' | 'accepted' | 'ignored' | 'stale'; decision: null | { status: 'accepted' | 'ignored'; taskId: string | null; targetMode: 'created' | 'existing' | null; decidedAt: string }; possibleDuplicates: { taskId: string; title: string; exact: boolean; similarity: number }[] }[];
}
export const listProjectAnalyses = (repositoryId: string, before?: string) => http.get<{ items: ProjectAnalysisJob[]; nextCursor: string | null }>(`/project-repositories/${repositoryId}/analyses`, { before });
export interface ProjectLearningRoadmap {
  repositoryId: string; analysisId: string; commitSha: string; previousAnalysisId: string | null; stale: boolean; nextTaskId: string | null; evidenceScope: string; evidenceTruncated: boolean;
  tasks: { id: string; title: string; status: string; progress: number | null; priority: string | null; phase: string | null; requirementId: string | null; dependencyIds: string[]; dependencyLevel: number; externalBlockingCount: number; notes: { id: string; title: string; sourceSessionId: string | null }[]; experiments: { id: string; title: string; recordKind: string }[] }[];
  suggestions: { id: string; topic: string; reason: string; practice: string; acceptance: string; impact: 'high' | 'medium' | 'low' | null; prerequisites: string[]; status: 'pending' | 'accepted' | 'ignored'; requirementId: string | null; newSincePrevious: boolean | null; linkedTaskIds: string[]; evidence: ProjectLearningEvidence[]; evidenceCount: number }[];
}
export const getProjectLearningRoadmap = (repositoryId: string, analysisId: string) => http.get<ProjectLearningRoadmap>(`/project-repositories/${repositoryId}/roadmap/${analysisId}`);
export interface ProjectLearningEvidence { id: string; kind: 'understanding' | 'practice'; response: string; artifactUrl: string | null; createdAt: string }
export const addProjectLearningEvidence = (repositoryId: string, analysisId: string, body: { suggestionId: string; kind: ProjectLearningEvidence['kind']; response: string; artifactUrl?: string }) => http.post<ProjectLearningEvidence>(`/project-repositories/${repositoryId}/roadmap/${analysisId}/evidence`, body);
export interface ProjectReportComparison {
  older: ProjectAnalysisJob & { fullName: string }; newer: ProjectAnalysisJob & { fullName: string };
  comparable: boolean; limitations: string[];
  changes: { requirementId: string; kind: 'completion_signal' | 'possible_regression' | 'new_gap' | 'improved_gap' | 'changed'; before: Pick<ProjectAnalysisReport['findings'][number], 'requirementId' | 'title' | 'status' | 'detail' | 'evidence'>; after: Pick<ProjectAnalysisReport['findings'][number], 'requirementId' | 'title' | 'status' | 'detail' | 'evidence'> }[];
  suggestions: { added: { topic: string; practice: string }[]; removed: { topic: string; practice: string }[] };
}
export const compareProjectAnalyses = (repositoryId: string, olderId: string, newerId: string) => http.get<ProjectReportComparison>(`/project-repositories/${repositoryId}/analyses/compare/${olderId}/${newerId}`);
export interface PrivateProjectDisclosure { digest: string; provider: string; model: string; destination: string; fileCount: number; paths: string[]; truncatedCount: number; scanFileLimit: number; scanByteLimit: number; scanCoverageComplete: boolean }
export const previewPrivateProjectAnalysis = (repositoryId: string, scanId: string, modelId: string) => http.post<PrivateProjectDisclosure>(`/project-repositories/${repositoryId}/analyses/disclosure`, { scanId, modelId });
export const startProjectAnalysis = (repositoryId: string, scanId: string, modelId: string, budget: { tokenBudget: number | null; costBudgetUsd: number | null }, privateConsent?: { disclosureDigest: string }, autoApproval = false) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses`, { scanId, modelId, ...budget, ...(privateConsent ? { privateConsent: true, disclosureDigest: privateConsent.disclosureDigest } : {}), ...(autoApproval ? { autoApproval: true } : {}) });
export const getProjectAnalysis = (repositoryId: string, analysisId: string) => http.get<ProjectAnalysisReport>(`/project-repositories/${repositoryId}/analyses/${analysisId}`);
export const cancelProjectAnalysis = (repositoryId: string, analysisId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses/${analysisId}/cancel`, {});
export const retryProjectAnalysis = (repositoryId: string, analysisId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses/${analysisId}/retry`, {});
export interface ProjectSuggestionTaskPreview { taskId: string; title: string; version: number; changes: { fieldName: 'description'; oldValue: string; newValue: string; addedValue: string }[] }
export const previewProjectSuggestionTask = (repositoryId: string, analysisId: string, suggestionId: string, taskId: string) => http.get<ProjectSuggestionTaskPreview>(`/project-repositories/${repositoryId}/analyses/${analysisId}/suggestions/${suggestionId}/preview`, { taskId });
export const decideProjectSuggestion = (repositoryId: string, analysisId: string, suggestionId: string, action: 'accept' | 'ignore', target?: { targetTaskId: string; expectedTaskVersion: number }) => http.post<{ suggestionId: string; status: 'accepted' | 'ignored'; taskId: string | null; targetMode: 'created' | 'existing' | null; decidedAt: string }>(`/project-repositories/${repositoryId}/analyses/${analysisId}/suggestions/${suggestionId}/${action}`, target || {});
export const addProjectFindingFeedback = (repositoryId: string, analysisId: string, findingId: string, correctedStatus: ProjectAnalysisReport['findings'][number]['status'], reason: string) => http.post(`/project-repositories/${repositoryId}/analyses/${analysisId}/findings/${findingId}/feedback`, { correctedStatus, reason });
