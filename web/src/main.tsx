import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import DayView from "./routes/DayView.tsx";
import RunView from "./routes/RunView.tsx";
import SettingsView from "./routes/SettingsView.tsx";

// HashRouter: działa z GitHub Pages i z pliku bez serwera SPA-fallback.
const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <DayView /> },
      { path: "zjazd/:runId", element: <RunView /> },
      { path: "ustawienia", element: <SettingsView /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
