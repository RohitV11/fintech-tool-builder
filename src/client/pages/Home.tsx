import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, type SessionUser } from "../api";

export function Home() {
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: SessionUser }>("/api/auth/me")
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) navigate("/login", { replace: true });
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  async function signOut() {
    await api<void>("/api/auth/logout", { method: "POST", body: "{}" });
    navigate("/login", { replace: true });
  }

  if (loading) return <main className="page-shell"><p>Loading your workspace…</p></main>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <main className="page-shell">
      <header className="topbar">
        <Link to="/" className="brand">Fintech Tool Builder</Link>
        <button className="quiet-button" onClick={signOut}>Sign out</button>
      </header>
      <section className="welcome-card">
        <div className="eyebrow">LOCAL DEMO WORKSPACE</div>
        <h1>Welcome, {user.displayName}</h1>
        <p className="muted">Your authenticated session is active.</p>
        <dl className="user-details">
          <div><dt>Username</dt><dd>{user.username}</dd></div>
          <div><dt>Role</dt><dd className="role-tag">{user.role}</dd></div>
        </dl>
      </section>
    </main>
  );
}
