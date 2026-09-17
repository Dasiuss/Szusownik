import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import DayView from "./routes/DayView.tsx";
import DaySummaryView from "./routes/DaySummaryView.tsx";
import HistoryView from "./routes/HistoryView.tsx";
import RunView from "./routes/RunView.tsx";
import SettingsView from "./routes/SettingsView.tsx";

// HashRouter: działa z GitHub Pages i z pliku bez serwera SPA-fallback.
const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <DayView /> },
      { path: "dzien/:dayKey/calosc", element: <DaySummaryView /> },
      { path: "dzien/:dayKey", element: <DayView /> },
      { path: "historia", element: <HistoryView /> },
      { path: "zjazd/:runId", element: <RunView /> },
      { path: "urzadzenie", element: <SettingsView /> },
      { path: "ustawienia", element: <SettingsView /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
