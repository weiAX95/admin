import { http } from './client';

export interface ProjectRepository {
  id: string;
  ownerId: string;
  fullName: string;
  private: boolean;
  githubRepositoryId: number | null;
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
export interface ProjectGithubIdentityPreview {
  current: { fullName: string; commitSha: string };
  candidate: { githubRepositoryId: number; fullName: string; branch: string; commitSha: string };
}
export const previewProjectGithubIdentity = (id: string) => http.get<ProjectGithubIdentityPreview>(`/project-repositories/${id}/identity-preview`);
export const confirmProjectGithubIdentity = (id: string, candidate: ProjectGithubIdentityPreview['candidate']) => http.post<ProjectRepository>(`/project-repositories/${id}/identity-confirm`, {
  expectedGithubRepositoryId: candidate.githubRepositoryId,
  expectedFullName: candidate.fullName,
  expectedCommitSha: candidate.commitSha,
});
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
  branch: string;
  id: string;
  repositoryId: string;
  githubRepositoryId: number | null;
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
  findings: { id: string; requirementId: string | null; featureKey: string | null; moduleKey: string | null; title: string; status: 'implemented' | 'partial' | 'not_found' | 'unverified'; detail: string; evidence: null | { type: 'code' | 'test' | 'document' | 'config'; path: string; line: number; excerpt: string; gitSha: string }; feedback: { id: string; correctedStatus: 'implemented' | 'partial' | 'not_found' | 'unverified'; reason: string; author: string; createdAt: string }[] }[];
  suggestions: { id: string; findingId: string | null; topic: string; reason: string; practice: string; acceptance: string; adjustment: null | { practice: string; acceptance: string; rationale: string; version: number; updatedAt: string }; impact: 'high' | 'medium' | 'low' | null; impactReason: string | null; prerequisites: string[]; dependsOnIndexes: number[] | null; status: 'pending' | 'accepted' | 'ignored' | 'stale'; decision: null | { status: 'accepted' | 'ignored'; taskId: string | null; targetMode: 'created' | 'existing' | null; decidedAt: string }; semanticDuplicate: null | { taskId: string; reason: string; title: string | null; available: boolean }; possibleDuplicates: { taskId: string; title: string; exact: boolean; sourceMatch?: true; similarity: number }[] }[];
}
export interface ProjectModuleFile { path: string; gitSha: string; category: string; status: ProjectScanFile['status']; reason: string | null }
export const listProjectAnalyses = (repositoryId: string, before?: string) => http.get<{ items: ProjectAnalysisJob[]; nextCursor: string | null }>(`/project-repositories/${repositoryId}/analyses`, { before });
export const listProjectModuleFiles = (repositoryId: string, analysisId: string, moduleKey: string, after?: string) => http.get<{ items: ProjectModuleFile[]; nextCursor: string | null }>(`/project-repositories/${repositoryId}/analyses/${analysisId}/module-files`, { moduleKey, after });
export interface ProjectPrerequisiteMapping {
  name: string;
  suggestionId: string | null;
  taskIds: string[];
  state: 'done' | 'pending' | 'unmapped' | 'ambiguous';
  source: 'auto' | 'manual' | 'manual_stale';
  version: number;
  mappedTaskId: string | null;
  verifiedCapabilityLevel: 'understanding' | 'practice' | 'both' | null;
}
export interface ProjectVerifiedCapability {
  level: 'understanding' | 'practice' | 'both';
  understanding: { evidenceId: string; analysisId: string; commitSha: string; reviewedAt: string } | null;
  practice: { evidenceId: string; analysisId: string; commitSha: string; reviewedAt: string } | null;
}
export interface ProjectLearningRoadmap {
  repositoryId: string; analysisId: string; commitSha: string; previousAnalysisId: string | null; stale: boolean; nextTaskId: string | null; nextSuggestionId: string | null; nextSuggestionReason: string | null; evidenceScope: string; evidenceTruncated: boolean; capabilitySignalsTruncated: boolean;
  tasks: { id: string; title: string; status: string; progress: number | null; priority: string | null; phase: string | null; requirementId: string | null; dependencyIds: string[]; dependencyLevel: number; externalBlockingCount: number; notes: { id: string; title: string; sourceSessionId: string | null }[]; experiments: { id: string; title: string; recordKind: string }[] }[];
  suggestions: { id: string; topic: string; reason: string; practice: string; acceptance: string; adjustment: null | { practice: string; acceptance: string; rationale: string }; impact: 'high' | 'medium' | 'low' | null; prerequisites: string[]; prerequisiteMappings: ProjectPrerequisiteMapping[]; verifiedCapability: ProjectVerifiedCapability | null; status: 'pending' | 'accepted' | 'ignored'; requirementId: string | null; newSincePrevious: boolean | null; linkedTaskIds: string[]; evidence: ProjectLearningEvidence[]; evidenceCount: number }[];
}
export const getProjectLearningRoadmap = (repositoryId: string, analysisId: string) => http.get<ProjectLearningRoadmap>(`/project-repositories/${repositoryId}/roadmap/${analysisId}`);
export interface ProjectLearningReview { state: 'pending' | 'verified' | 'needs_revision'; coreCorrect: boolean | null; boundaryVerified: boolean | null; rationale: string | null; requestedAt: string; reviewedAt: string | null; reviewerName: string | null }
export interface ProjectLearningEvidence { id: string; kind: 'understanding' | 'practice'; response: string; artifactUrl: string | null; createdAt: string; review?: ProjectLearningReview | null }
export const addProjectLearningEvidence = (repositoryId: string, analysisId: string, body: { suggestionId: string; kind: ProjectLearningEvidence['kind']; response: string; artifactUrl?: string }) => http.post<ProjectLearningEvidence>(`/project-repositories/${repositoryId}/roadmap/${analysisId}/evidence`, body);
export const listProjectLearningEvidence = (repositoryId: string, analysisId: string, suggestionId: string, before?: string) =>
  http.get<{ items: ProjectLearningEvidence[]; nextCursor: string | null }>(`/project-repositories/${repositoryId}/roadmap/${analysisId}/evidence`, { suggestionId, before });
export const requestProjectLearningReview = (repositoryId: string, analysisId: string, evidenceId: string) =>
  http.post<{ evidenceId: string; state: ProjectLearningReview['state']; requestedAt: string; reviewedAt: string | null }>(`/project-repositories/${repositoryId}/roadmap/${analysisId}/evidence/${evidenceId}/review-request`, {});
export const setProjectPrerequisiteTask = (repositoryId: string, analysisId: string, suggestionId: string, index: number, body: { taskId: string | null; expectedVersion: number }) =>
  http.put<{ suggestionId: string; prerequisiteIndex: number; mappedTaskId: string | null; source: 'auto' | 'manual'; version: number; updatedAt: string | null }>(`/project-repositories/${repositoryId}/roadmap/${analysisId}/prerequisites/${suggestionId}/${index}`, body);
export const adjustProjectSuggestion = (repositoryId: string, analysisId: string, suggestionId: string, body: { practice: string; acceptance: string; rationale: string; expectedVersion: number }) => http.patch<ProjectAnalysisReport['suggestions'][number]['adjustment']>(`/project-repositories/${repositoryId}/analyses/${analysisId}/suggestions/${suggestionId}/adjust`, body);
export type ProjectComparedFinding = Pick<ProjectAnalysisReport['findings'][number], 'id' | 'requirementId' | 'featureKey' | 'title' | 'status' | 'detail' | 'evidence'>;
export interface ProjectReportComparison {
  older: ProjectAnalysisJob & { fullName: string }; newer: ProjectAnalysisJob & { fullName: string };
  comparable: boolean; limitations: string[];
  suggestionReviewEligible: boolean; suggestionReviewUnavailableReason: string | null;
  findingMatchEligible: boolean;
  findingMatchCandidates: { older: ProjectComparedFinding[]; newer: ProjectComparedFinding[] };
  confirmedFindingMatches: { id: string; before: ProjectComparedFinding; after: ProjectComparedFinding; reason: string; reviewer: string; createdAt: string }[];
  changes: { requirementId: string; kind: 'completion_signal' | 'possible_regression' | 'new_gap' | 'improved_gap' | 'changed'; before: ProjectComparedFinding; after: ProjectComparedFinding }[];
  findingReview: {
    sameStatusChanges: { requirementId: string; changedFields: ('title' | 'detail' | 'evidence')[]; before: ProjectComparedFinding; after: ProjectComparedFinding }[];
    featureKeyCandidates: { featureKey: string; before: ProjectComparedFinding; after: ProjectComparedFinding; statusChanged: boolean; evidenceChanged: boolean }[];
    unmatchedGroups: {
      reason: 'new_only' | 'old_only' | 'ambiguous_multiple' | 'missing_requirement_id' | 'incomparable_scope';
      requirementId: string | null; before: ProjectComparedFinding[]; after: ProjectComparedFinding[];
    }[];
  };
  suggestions: { added: { topic: string; practice: string }[]; removed: { topic: string; practice: string }[] };
}
export const compareProjectAnalyses = (repositoryId: string, olderId: string, newerId: string) => http.get<ProjectReportComparison>(`/project-repositories/${repositoryId}/analyses/compare/${olderId}/${newerId}`);
export const confirmProjectFindingMatch = (repositoryId: string, olderId: string, newerId: string, body: { olderFindingId: string; newerFindingId: string; reason: string }) =>
  http.post<{ id: string }>(`/project-repositories/${repositoryId}/analyses/compare/${olderId}/${newerId}/finding-matches`, body);
export const removeProjectFindingMatch = (repositoryId: string, olderId: string, newerId: string, matchId: string) =>
  http.del<{ removed: true }>(`/project-repositories/${repositoryId}/analyses/compare/${olderId}/${newerId}/finding-matches/${matchId}`);
export type ProjectSuggestionReviewOutcome = 'matched' | 'follow_up' | 'no_longer_relevant';
export interface ProjectSuggestionReviewPair {
  olderAnalysisId: string;
  newerAnalysisId: string;
  olderCommitSha: string;
  newerCommitSha: string;
  limitations: string[];
  stale: boolean;
  items: {
    older: { id: string; topic: string; practice: string; acceptance: string; status: string; requirementId: string | null; taskId: string | null };
    candidates: { id: string; topic: string; practice: string; acceptance: string; requirementId: string | null; similarity: number; sameRequirement: boolean }[];
    review: { newerSuggestionId: string | null; outcome: ProjectSuggestionReviewOutcome; note: string; version: number; reviewedAt: string } | null;
  }[];
}
export const getProjectSuggestionReviews = (repositoryId: string, olderAnalysisId: string, newerAnalysisId: string) =>
  http.get<ProjectSuggestionReviewPair>(`/project-repositories/${repositoryId}/analyses/${newerAnalysisId}/suggestion-reviews`, { olderAnalysisId });
export const saveProjectSuggestionReview = (repositoryId: string, olderAnalysisId: string, newerAnalysisId: string, olderSuggestionId: string, body: { newerSuggestionId: string | null; outcome: ProjectSuggestionReviewOutcome; note: string; expectedVersion: number }) =>
  http.post<NonNullable<ProjectSuggestionReviewPair['items'][number]['review']>>(`/project-repositories/${repositoryId}/analyses/${newerAnalysisId}/suggestion-reviews/${olderSuggestionId}`, { olderAnalysisId, ...body });
export interface PrivateProjectDisclosure { digest: string; provider: string; model: string; destination: string; fileCount: number; paths: string[]; duplicateCandidateCount: number; duplicateCandidates: { taskId: string; title: string; topic: string; practice: string; acceptance: string }[]; truncatedCount: number; scanFileLimit: number; scanByteLimit: number; scanCoverageComplete: boolean }
export const previewPrivateProjectAnalysis = (repositoryId: string, scanId: string, modelId: string) => http.post<PrivateProjectDisclosure>(`/project-repositories/${repositoryId}/analyses/disclosure`, { scanId, modelId });
export const startProjectAnalysis = (repositoryId: string, scanId: string, modelId: string, budget: { tokenBudget: number | null; costBudgetUsd: number | null }, privateConsent?: { disclosureDigest: string }, autoApproval = false) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses`, { scanId, modelId, ...budget, ...(privateConsent ? { privateConsent: true, disclosureDigest: privateConsent.disclosureDigest } : {}), ...(autoApproval ? { autoApproval: true } : {}) });
export const getProjectAnalysis = (repositoryId: string, analysisId: string) => http.get<ProjectAnalysisReport>(`/project-repositories/${repositoryId}/analyses/${analysisId}`);
export const cancelProjectAnalysis = (repositoryId: string, analysisId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses/${analysisId}/cancel`, {});
export const retryProjectAnalysis = (repositoryId: string, analysisId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses/${analysisId}/retry`, {});
export interface ProjectSuggestionTaskPreview { taskId: string; title: string; version: number; changes: { fieldName: 'description'; oldValue: string; newValue: string; addedValue: string }[] }
export const previewProjectSuggestionTask = (repositoryId: string, analysisId: string, suggestionId: string, taskId: string) => http.get<ProjectSuggestionTaskPreview>(`/project-repositories/${repositoryId}/analyses/${analysisId}/suggestions/${suggestionId}/preview`, { taskId });
export const decideProjectSuggestion = (repositoryId: string, analysisId: string, suggestionId: string, action: 'accept' | 'ignore', target?: { targetTaskId: string; expectedTaskVersion: number }) => http.post<{ suggestionId: string; status: 'accepted' | 'ignored'; taskId: string | null; targetMode: 'created' | 'existing' | null; decidedAt: string }>(`/project-repositories/${repositoryId}/analyses/${analysisId}/suggestions/${suggestionId}/${action}`, target || {});
export const addProjectFindingFeedback = (repositoryId: string, analysisId: string, findingId: string, correctedStatus: ProjectAnalysisReport['findings'][number]['status'], reason: string) => http.post(`/project-repositories/${repositoryId}/analyses/${analysisId}/findings/${findingId}/feedback`, { correctedStatus, reason });
