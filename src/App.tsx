import { App as AntApp, Spin } from "antd";
import SettingsProvider from "./components/SettingsProvider";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import AdminLayout from "./layouts/AdminLayout";
import RequireAuth from "./components/RequireAuth";
import RequireAdmin from "./components/RequireAdmin";
import ErrorBoundary from "./components/ErrorBoundary";
import OfflineBanner from "./components/OfflineBanner";
import ApiNetworkRetryBanner from "./components/ApiNetworkRetryBanner";
import ApiServerErrorBanner from "./components/ApiServerErrorBanner";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Tasks = lazy(() => import("./pages/Tasks"));
const TaskDetail = lazy(() => import("./pages/TaskDetail"));
const Sessions = lazy(() => import("./pages/Sessions"));
const Notes = lazy(() => import("./pages/Notes"));
const Experiments = lazy(() => import("./pages/Experiments"));
const NoteDetail = lazy(() => import("./pages/NoteDetail"));
const NoteGraph = lazy(() => import("./pages/NoteGraph"));
const NoteReviews = lazy(() => import("./pages/NoteReviews"));
const ExperimentDetail = lazy(() => import("./pages/ExperimentDetail"));
const ExperimentCompare = lazy(() => import("./pages/ExperimentCompare"));
const ExperimentDatasets = lazy(() => import("./pages/ExperimentDatasets"));
const EvaluationReviews = lazy(() => import("./pages/EvaluationReviews"));
const EvaluationCandidates = lazy(() => import("./pages/EvaluationCandidates"));
const EvaluationLeaderboard = lazy(() => import("./pages/EvaluationLeaderboard"));
const EvaluationSchedules = lazy(() => import("./pages/EvaluationSchedules"));
const EvaluationMetrics = lazy(() => import("./pages/EvaluationMetrics"));
const EvaluationAlerts = lazy(() => import("./pages/EvaluationAlerts"));
const ExperimentRegressionReport = lazy(() => import("./pages/ExperimentRegressionReport"));
const ExperimentChain = lazy(() => import("./pages/ExperimentChain"));
const SharedExperiment = lazy(() => import("./pages/SharedExperiment"));
const SharedEvaluationReport = lazy(() => import("./pages/SharedEvaluationReport"));
const ExperimentSchedules = lazy(() => import("./pages/ExperimentSchedules"));
const Prompts = lazy(() => import("./pages/Prompts"));
const PromptDetail = lazy(() => import("./pages/PromptDetail"));
const Accounts = lazy(() => import("./pages/Accounts"));
const AccountAudit = lazy(() => import("./pages/AccountAudit"));
const AccountActivity = lazy(() => import("./pages/AccountActivity"));
const PermissionMatrix = lazy(() => import("./pages/PermissionMatrix"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const MfaSetup = lazy(() => import('./pages/MfaSetup'));
const Settings = lazy(() => import("./pages/Settings"));
const ModelCosts = lazy(() => import("./pages/ModelCosts"));
const ModelCallAudit = lazy(() => import("./pages/ModelCallAudit"));
const ModelHealth = lazy(() => import("./pages/ModelHealth"));
const Alerts = lazy(() => import("./pages/Alerts"));
const ProjectAnalysis = lazy(() => import("./pages/ProjectAnalysis"));
const ProjectLearningReviews = lazy(() => import("./pages/ProjectLearningReviews"));

export default function App() {
  return (
    <ErrorBoundary>
    <SettingsProvider>
      <AntApp>
        <BrowserRouter>
          <OfflineBanner />
          <ApiNetworkRetryBanner />
          <ApiServerErrorBanner />
          <Suspense fallback={<div className="route-loading" role="status"><Spin size="large" tip="页面加载中…"><span className="route-loading-space" /></Spin></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route path="/share/experiments/:token" element={<SharedExperiment />} />
            <Route path="/share/evaluation-reports/:token" element={<SharedEvaluationReport />} />
            <Route element={<RequireAuth />}>
              <Route path="/mfa/setup" element={<MfaSetup />} />
              <Route element={<AdminLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/tasks/:id" element={<TaskDetail />} />
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/notes" element={<Notes />} />
                <Route path="/notes/graph" element={<NoteGraph />} />
                <Route path="/notes/reviews" element={<NoteReviews />} />
                <Route path="/notes/:id" element={<NoteDetail />} />
                <Route path="/experiments" element={<Experiments />} />
                <Route path="/experiments/compare" element={<ExperimentCompare />} />
                <Route path="/experiments/datasets" element={<ExperimentDatasets />} />
                <Route path="/evaluation/reviews" element={<EvaluationReviews />} />
                <Route element={<RequireAdmin />}>
                  <Route path="/evaluation/candidates" element={<EvaluationCandidates />} />
                  <Route path="/project-learning-reviews" element={<ProjectLearningReviews />} />
                  <Route path="/evaluation/alerts" element={<EvaluationAlerts />} />
                  <Route path="/accounts" element={<Accounts />} />
                  <Route path="/account-activity" element={<AccountActivity />} />
                  <Route path="/model-costs" element={<ModelCosts />} />
                  <Route path="/model-call-audit" element={<ModelCallAudit />} />
                  <Route path="/model-health" element={<ModelHealth />} />
                  <Route path="/alerts" element={<Alerts />} />
                </Route>
                <Route path="/evaluation/leaderboard" element={<EvaluationLeaderboard />} />
                <Route path="/evaluation/schedules" element={<EvaluationSchedules />} />
                <Route path="/evaluation/metrics" element={<EvaluationMetrics />} />
                <Route path="/experiments/reports/:id" element={<ExperimentRegressionReport />} />
                <Route path="/experiments/chains/:id" element={<ExperimentChain />} />
                <Route path="/experiments/schedules" element={<ExperimentSchedules />} />
                <Route path="/experiments/:id" element={<ExperimentDetail />} />
                <Route path="/prompts" element={<Prompts />} />
                <Route path="/prompts/:id" element={<PromptDetail />} />
                <Route path="/account-audit" element={<AccountAudit />} />
                <Route path="/permissions" element={<PermissionMatrix />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/project-analysis" element={<ProjectAnalysis />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
          </Suspense>
        </BrowserRouter>
      </AntApp>
    </SettingsProvider>
    </ErrorBoundary>
  );
}
