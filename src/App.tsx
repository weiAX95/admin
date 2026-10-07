import { App as AntApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
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
import Accounts from "./pages/Accounts";
import Login from "./pages/Login";

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#9582ff",
          borderRadius: 10,
          controlHeight: 38,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          colorText: "#e8eaf4",
          colorTextSecondary: "#9ca3bb",
          colorLink: "#b5a7fa",
          colorLinkHover: "#d0c5ff",
          colorInfo: "#9582ff",
          colorSuccess: "#7dcca4",
          colorWarning: "#e6bb77",
          colorError: "#ec929f",
          colorBorder: "#30364c",
          colorBorderSecondary: "#252b40",
          colorBgContainer: "#141726",
          colorBgElevated: "#1a1e30",
          colorBgLayout: "#0b0d17",
        },
        components: {
          Card: { headerFontSize: 15, headerHeight: 56, paddingLG: 24 },
          Table: { headerBg: "#1b2032", headerColor: "#adb5cc", cellPaddingBlock: 18, rowHoverBg: "#1c2236" },
          Menu: { darkItemBg: "transparent", darkSubMenuItemBg: "transparent", darkItemSelectedBg: "#27233f", darkItemSelectedColor: "#c1b5ff", itemHeight: 46 },
          Button: { primaryShadow: "0 4px 14px rgba(124,108,255,0.18)" },
          Input: { activeShadow: "0 0 0 3px rgba(149,130,255,0.12)" },
          Select: { optionSelectedBg: "#302a4d" },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
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
                <Route path="/experiments/:id" element={<ExperimentDetail />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
