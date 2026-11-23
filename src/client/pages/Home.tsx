import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type { SafeCatalog } from "../../shared/catalog-types";
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
  const [catalog, setCatalog] = useState<SafeCatalog | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [newAppOpen, setNewAppOpen] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newDatasetId, setNewDatasetId] = useState("");
  const [workingAppId, setWorkingAppId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<{ user: SessionUser }>("/api/auth/me"),
      api<{ apps: WorkspaceApp[] }>("/api/apps"),
      api<SafeCatalog>("/api/catalog"),
    ])
      .then(([session, result, safeCatalog]) => {
        if (cancelled) return;
        setUser(session.user);
        setApps(result.apps);
        setCatalog(safeCatalog);
        setNewDatasetId((current) => current || safeCatalog.datasets[0]?.id || "");
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

  async function createApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newAppName.trim() || !newDatasetId) return;
    setWorkingAppId("new");
    setError("");
    try {
      const result = await api<{ app: { id: string } }>("/api/apps", {
        method: "POST",
        body: JSON.stringify({ name: newAppName.trim(), datasetId: newDatasetId }),
      });
      navigate(`/apps/${encodeURIComponent(result.app.id)}/edit`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create this app");
      setWorkingAppId("");
    }
  }

  async function duplicateApp(source: WorkspaceApp) {
    setWorkingAppId(source.id);
    setError("");
    try {
      const sourceDraft = await api<{ definition: { datasetId: string } }>(
        `/api/apps/${encodeURIComponent(source.id)}/draft`,
      );
      const result = await api<{ app: { id: string } }>("/api/apps", {
        method: "POST",
        body: JSON.stringify({
          name: `${source.name} copy`,
          datasetId: sourceDraft.definition.datasetId,
          duplicateFromAppId: source.id,
        }),
      });
      navigate(`/apps/${encodeURIComponent(result.app.id)}/edit`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to duplicate this app");
      setWorkingAppId("");
    }
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
          <p className="muted">
            {user.role === "builder"
              ? "Create, edit, and publish internal tools."
              : "Choose a published internal tool to get started."}
          </p>
        </div>
        <div className="directory-heading-actions">
          <span className="role-tag">{apps.length} {apps.length === 1 ? "app" : "apps"}</span>
          {user.role === "builder" && (
            <button
              className="primary-button compact"
              onClick={() => {
                setNewAppName("");
                setNewAppOpen(true);
              }}
            >
              New app
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
        </div>
      )}
      <section className="app-directory" aria-label="Published apps">
        {apps.map((app) => (
          <article className="app-card" key={app.id}>
            <Link
              className="app-card-link"
              to={
                app.publishedRevisionId
                  ? `/apps/${encodeURIComponent(app.id)}`
                  : `/apps/${encodeURIComponent(app.id)}/edit`
              }
            >
              <span className="app-icon">{app.name.slice(0, 1).toUpperCase()}</span>
              <span className="app-card-copy">
                <strong>{app.name}</strong>
                <small>{app.revisionNumber ? `Published revision ${app.revisionNumber}` : "Draft app"}</small>
                {app.hasUnpublishedChanges && <small className="draft-indicator">Unpublished changes</small>}
              </span>
              <span className="app-arrow">→</span>
            </Link>
            {user.role === "builder" && (
              <div className="app-card-actions">
                <Link className="quiet-button" to={`/apps/${encodeURIComponent(app.id)}/edit`}>Edit</Link>
                <button
                  className="quiet-button"
                  disabled={Boolean(workingAppId)}
                  onClick={() => duplicateApp(app)}
                >
                  {workingAppId === app.id ? "Duplicating…" : "Duplicate"}
                </button>
              </div>
            )}
          </article>
        ))}
        {apps.length === 0 && !error && (
          <div className="empty-directory">
            <h2>No published apps yet</h2>
            <p className="muted">Published tools will appear here when they are available.</p>
          </div>
        )}
      </section>
      {newAppOpen && user.role === "builder" && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="dialog-card new-app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-app-title"
            onSubmit={createApp}
          >
            <h2 id="new-app-title">Create an app</h2>
            <label>
              App name
              <input
                autoFocus
                required
                maxLength={80}
                value={newAppName}
                onChange={(event) => setNewAppName(event.target.value)}
              />
            </label>
            <label>
              Dataset
              <select
                required
                value={newDatasetId}
                onChange={(event) => setNewDatasetId(event.target.value)}
              >
                {catalog?.datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.label}</option>
                ))}
              </select>
            </label>
            <div className="dialog-actions">
              <button
                className="quiet-button"
                type="button"
                disabled={workingAppId === "new"}
                onClick={() => setNewAppOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button compact"
                type="submit"
                disabled={workingAppId === "new" || !newAppName.trim()}
              >
                {workingAppId === "new" ? "Creating…" : "Create app"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
