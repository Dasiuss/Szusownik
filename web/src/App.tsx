import { Outlet } from "react-router-dom";

export default function App() {
  // Bez nazwy aplikacji w nagłówkach (wymagania-PWA §2). Sam content.
  return (
    <div className="mx-auto max-w-3xl px-3 pb-10 pt-4">
      <Outlet />
    </div>
  );
}
