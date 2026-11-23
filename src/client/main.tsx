import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { EditPage } from "./pages/EditPage";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { PreviewPage } from "./pages/PreviewPage";
import { RuntimePage } from "./pages/RuntimePage";
import "./styles.css";
import "./runtime.css";

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/", element: <Home /> },
  { path: "/apps/:appId", element: <RuntimePage /> },
  { path: "/apps/:appId/edit", element: <EditPage /> },
  { path: "/apps/:appId/preview", element: <PreviewPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
