import { App as AntApp } from "antd";
import SettingsProvider from "./components/SettingsProvider";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./layouts/AdminLayout";
import RequireAuth from "./components/RequireAuth";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Sessions from "./pages/Sessions";
import Notes from "./pages/Notes";
import Experiments from "./pages/Experiments";
import NoteDetail from "./pages/NoteDetail";
import NoteGraph from "./pages/NoteGraph";
import NoteReviews from "./pages/NoteReviews";
import ExperimentDetail from "./pages/ExperimentDetail";
import ExperimentCompare from "./pages/ExperimentCompare";
import ExperimentDatasets from "./pages/ExperimentDatasets";
import EvaluationReviews from "./pages/EvaluationReviews";
import EvaluationCandidates from "./pages/EvaluationCandidates";
import EvaluationLeaderboard from "./pages/EvaluationLeaderboard";
import EvaluationSchedules from "./pages/EvaluationSchedules";
import EvaluationMetrics from "./pages/EvaluationMetrics";
import EvaluationAlerts from "./pages/EvaluationAlerts";
import ExperimentRegressionReport from "./pages/ExperimentRegressionReport";
import ExperimentChain from "./pages/ExperimentChain";
import SharedExperiment from "./pages/SharedExperiment";
import SharedEvaluationReport from "./pages/SharedEvaluationReport";
import ExperimentSchedules from "./pages/ExperimentSchedules";
import Prompts from "./pages/Prompts";
import PromptDetail from "./pages/PromptDetail";
import Accounts from "./pages/Accounts";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import ModelCosts from "./pages/ModelCosts";
import ModelCallAudit from "./pages/ModelCallAudit";
import ModelHealth from "./pages/ModelHealth";
import ProjectAnalysis from "./pages/ProjectAnalysis";

export default function App() {
  return (
    <SettingsProvider>
      <AntApp>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/share/experiments/:token" element={<SharedExperiment />} />
            <Route path="/share/evaluation-reports/:token" element={<SharedEvaluationReport />} />
            <Route element={<RequireAuth />}>
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
                <Route path="/evaluation/candidates" element={<EvaluationCandidates />} />
                <Route path="/evaluation/leaderboard" element={<EvaluationLeaderboard />} />
                <Route path="/evaluation/schedules" element={<EvaluationSchedules />} />
                <Route path="/evaluation/metrics" element={<EvaluationMetrics />} />
                <Route path="/evaluation/alerts" element={<EvaluationAlerts />} />
                <Route path="/experiments/reports/:id" element={<ExperimentRegressionReport />} />
                <Route path="/experiments/chains/:id" element={<ExperimentChain />} />
                <Route path="/experiments/schedules" element={<ExperimentSchedules />} />
                <Route path="/experiments/:id" element={<ExperimentDetail />} />
                <Route path="/prompts" element={<Prompts />} />
                <Route path="/prompts/:id" element={<PromptDetail />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/model-costs" element={<ModelCosts />} />
                <Route path="/model-call-audit" element={<ModelCallAudit />} />
                <Route path="/model-health" element={<ModelHealth />} />
                <Route path="/project-analysis" element={<ProjectAnalysis />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AntApp>
    </SettingsProvider>
  );
}
