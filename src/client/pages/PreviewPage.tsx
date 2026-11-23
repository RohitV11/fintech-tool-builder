import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AppDefinition, Block } from "../../shared/schema";
import type { SafeCatalog } from "../../shared/catalog-types";
import { ApiError, api, type SessionUser } from "../api";
import { blockRegistry } from "../blocks/registry";
import type { RendererContext } from "../blocks/types";

interface DraftResponse {
  definition: AppDefinition;
  version: number;
}

export function PreviewPage() {
  const { appId = "" } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [catalog, setCatalog] = useState<SafeCatalog | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [selection, setSelection] = useState<Record<string, string | null>>({});
  const [selectedRecords, setSelectedRecords] = useState<
    Record<string, Record<string, unknown> | undefined>
  >({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<DraftResponse>(`/api/apps/${encodeURIComponent(appId)}/draft`),
      api<{ user: SessionUser }>("/api/auth/me"),
      api<SafeCatalog>("/api/catalog"),
    ])
      .then(([draftResponse, session, catalogResponse]) => {
        if (cancelled) return;
        if (session.user.role !== "builder") {
          navigate("/", { replace: true });
          return;
        }
        setDraft(draftResponse);
        setUser(session.user);
        setCatalog(catalogResponse);
        setSelection({});
        setSelectedRecords({});
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(cause instanceof Error ? cause.message : "Unable to load this preview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId, retryKey, navigate]);

  const definition = draft?.definition ?? null;
  const dataset = useMemo(
    () => catalog?.datasets.find((entry) => entry.id === definition?.datasetId) ?? null,
    [catalog, definition],
  );
  const select = useCallback(
    (tableId: string, recordId: string | null, record?: Record<string, unknown>) => {
      setSelection((current) => ({ ...current, [tableId]: recordId }));
      setSelectedRecords((current) => ({
        ...current,
        [tableId]: recordId && record ? record : undefined,
      }));
    },
    [],
  );
  const bumpRefresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const ctx = useMemo<RendererContext | null>(() => {
    if (!definition || !dataset || !user) return null;
    return {
      appId,
      revisionId: null,
      mode: "preview",
      dataset,
      definition,
      selection,
      selectedRecords,
      select,
      user,
      stale: false,
      refreshKey,
      bumpRefresh,
      openAction: () => undefined,
    };
  }, [
    appId,
    bumpRefresh,
    dataset,
    definition,
    refreshKey,
    select,
    selectedRecords,
    selection,
    user,
  ]);

  if (loading) {
    return <main className="page-shell"><p className="loading-state">Loading preview…</p></main>;
  }
  if (error || !draft || !definition || !dataset || !user || !ctx) {
    return (
      <main className="page-shell">
        <div className="inline-error" role="alert">
          <span>{error || "The draft preview could not be loaded."}</span>
          <button onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
        </div>
        <Link to={`/apps/${encodeURIComponent(appId)}/edit`}>Back to builder</Link>
      </main>
    );
  }

  const orderedBlocks = [...definition.blocks].sort(
    (left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x,
  );

  return (
    <main className="page-shell runtime-page">
      <header className="topbar">
        <Link to="/" className="brand">Fintech Tool Builder</Link>
        <span className="role-tag">{user.displayName} · builder</span>
      </header>
      <div className="breadcrumbs">
        <Link to="/">Apps</Link><span>/</span><Link to={`/apps/${encodeURIComponent(appId)}/edit`}>Builder</Link>
        <span>/</span>Preview
      </div>
      <div className="runtime-heading">
        <div>
          <div className="eyebrow">DRAFT PREVIEW · VERSION {draft.version}</div>
          <h1>{definition.name}</h1>
        </div>
        <Link className="quiet-button" to={`/apps/${encodeURIComponent(appId)}/edit`}>Back to builder</Link>
      </div>
      <div className="notice-banner warning" role="status">
        <span>Previewing the saved draft. Actions are disabled.</span>
        <Link to={`/apps/${encodeURIComponent(appId)}/edit`}>Edit draft</Link>
      </div>
      <div className="notice-banner">{dataset.simulatedNotice}</div>
      <div className="runtime-grid">
        {orderedBlocks.map((block) => {
          const Renderer = blockRegistry[block.type].Renderer;
          return (
            <div
              className="runtime-block"
              key={block.id}
              data-block-id={block.id}
              style={{
                gridColumn: `${block.layout.x + 1} / span ${block.layout.w}`,
                gridRow: `${block.layout.y + 1} / span ${block.layout.h}`,
                minHeight: `${block.layout.h * 30 + (block.layout.h - 1) * 12}px`,
              }}
            >
              <Renderer block={block as Block} ctx={ctx} />
            </div>
          );
        })}
        {orderedBlocks.length === 0 && (
          <p className="empty-state">This draft does not contain any blocks yet.</p>
        )}
      </div>
    </main>
  );
}
