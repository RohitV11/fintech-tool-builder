import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, type SessionUser } from "../api";

interface WorkspaceApp {
  id: string;
  name: string;
  createdAt: string;
  publishedRevisionId: string | null;
  revisionNumber: number | null;
  hasUnpublishedChanges?: boolean;
}

export function Home() {
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [apps, setApps] = useState<WorkspaceApp[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<{ user: SessionUser }>("/api/auth/me"),
      api<{ apps: WorkspaceApp[] }>("/api/apps"),
    ])
      .then(([session, result]) => {
        if (cancelled) return;
        setUser(session.user);
        setApps(result.apps);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) navigate("/login", { replace: true });
        else setError(error instanceof Error ? error.message : "Unable to load your apps");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, retryKey]);

  async function signOut() {
    await api<void>("/api/auth/logout", { method: "POST", body: "{}" });
    navigate("/login", { replace: true });
  }

  if (loading) return <main className="page-shell"><p className="loading-state">Loading your workspace…</p></main>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <main className="page-shell directory-page">
      <header className="topbar">
        <Link to="/" className="brand">Fintech Tool Builder</Link>
        <button className="quiet-button" onClick={signOut}>Sign out</button>
      </header>
      <div className="directory-heading">
        <div>
          <div className="eyebrow">LOCAL DEMO WORKSPACE · {user.role.toUpperCase()}</div>
          <h1>Welcome, {user.displayName}</h1>
          <p className="muted">Choose a published internal tool to get started.</p>
        </div>
        <span className="role-tag">{apps.length} {apps.length === 1 ? "app" : "apps"}</span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
        </div>
      )}
      <section className="app-directory" aria-label="Published apps">
        {apps.map((app) => (
          <Link
            className="app-card-link"
            key={app.id}
            to={`/apps/${encodeURIComponent(app.id)}`}
          >
            <span className="app-icon">{app.name.slice(0, 1).toUpperCase()}</span>
            <span className="app-card-copy">
              <strong>{app.name}</strong>
              <small>{app.revisionNumber ? `Published revision ${app.revisionNumber}` : "Draft app"}</small>
              {app.hasUnpublishedChanges && <small className="draft-indicator">Unpublished changes</small>}
            </span>
            <span className="app-arrow">→</span>
          </Link>
        ))}
        {apps.length === 0 && !error && (
          <div className="empty-directory">
            <h2>No published apps yet</h2>
            <p className="muted">Published tools will appear here when they are available.</p>
          </div>
        )}
      </section>
    </main>
  );
}
