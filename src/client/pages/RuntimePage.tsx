import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AppDefinition, ActionButtonBlock, Block } from "../../shared/schema";
import type { SafeCatalog } from "../../shared/catalog-types";
import { ApiError, api, type SessionUser } from "../api";
import { blockRegistry } from "../blocks/registry";
import type { RendererContext } from "../blocks/types";
import { recordSummary } from "../blocks/format";

interface RuntimeResponse {
  app: { id: string; name: string };
  revisionId: string;
  revisionNumber: number;
  definition: AppDefinition;
}

interface ActionDialog {
  block: ActionButtonBlock;
  record: Record<string, unknown>;
  idempotencyKey: string;
}

export function RuntimePage() {
  const { appId = "" } = useParams();
  const navigate = useNavigate();
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [catalog, setCatalog] = useState<SafeCatalog | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadKey, setLoadKey] = useState(0);
  const [selection, setSelection] = useState<Record<string, string | null>>({});
  const [selectedRecords, setSelectedRecords] = useState<
    Record<string, Record<string, unknown> | undefined>
  >({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [stale, setStale] = useState(false);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [reason, setReason] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    Promise.all([
      api<RuntimeResponse>(`/api/apps/${encodeURIComponent(appId)}/runtime`),
      api<{ user: SessionUser }>("/api/auth/me"),
      api<SafeCatalog>("/api/catalog"),
    ])
      .then(([runtimeResponse, session, catalogResponse]) => {
        if (cancelled) return;
        setRuntime(runtimeResponse);
        setUser(session.user);
        setCatalog(catalogResponse);
        setSelection({});
        setSelectedRecords({});
        setStale(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(cause instanceof Error ? cause.message : "Unable to load the app");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId, loadKey, navigate]);

  const dataset = useMemo(
    () => catalog?.datasets.find((entry) => entry.id === runtime?.definition.datasetId) ?? null,
    [catalog, runtime],
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
  const openAction = useCallback((block: ActionButtonBlock, record: Record<string, unknown>) => {
    setReason("");
    setDialogError("");
    setDialog({ block, record, idempotencyKey: crypto.randomUUID() });
  }, []);

  const ctx = useMemo<RendererContext | null>(() => {
    if (!runtime || !dataset || !user) return null;
    return {
      appId,
      revisionId: runtime.revisionId,
      mode: "runtime",
      dataset,
      definition: runtime.definition,
      selection,
      selectedRecords,
      select,
      user,
      stale,
      refreshKey,
      bumpRefresh,
      openAction,
    };
  }, [
    appId,
    bumpRefresh,
    dataset,
    openAction,
    refreshKey,
    runtime,
    select,
    selectedRecords,
    selection,
    stale,
    user,
  ]);

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || !runtime) return;
    setSubmitting(true);
    setDialogError("");
    try {
      const result = await api<{
        record: Record<string, unknown>;
        auditEventId: string;
      }>(
        `/api/apps/${encodeURIComponent(appId)}/blocks/${encodeURIComponent(dialog.block.id)}/execute`,
        {
          method: "POST",
          body: JSON.stringify({
            recordId: String(dialog.record.id),
            expectedVersion: Number(dialog.record.version),
            reason,
            revisionId: runtime.revisionId,
            idempotencyKey: dialog.idempotencyKey,
          }),
        },
      );
      select(dialog.block.config.sourceTableId, String(result.record.id), result.record);
      setDialog(null);
      setReason("");
      bumpRefresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STALE_REVISION") {
        setStale(true);
      } else {
        setDialogError(cause instanceof Error ? cause.message : "Unable to submit this decision");
      }
      bumpRefresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className="page-shell"><p className="loading-state">Loading app…</p></main>;
  }
  if (loadError || !runtime || !user || !dataset || !ctx) {
    return (
      <main className="page-shell">
        <div className="inline-error" role="alert">
          <span>{loadError || "The app could not be loaded."}</span>
          <button onClick={() => setLoadKey((value) => value + 1)}>Retry</button>
        </div>
        <Link to="/">Back to apps</Link>
      </main>
    );
  }

  const orderedBlocks = [...runtime.definition.blocks].sort(
    (left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x,
  );

  return (
    <main className="page-shell runtime-page">
      <header className="topbar">
        <Link to="/" className="brand">Fintech Tool Builder</Link>
        <span className="role-tag">{user.displayName} · {user.role}</span>
      </header>
      <div className="breadcrumbs"><Link to="/">Apps</Link><span>/</span>{runtime.app.name}</div>
      <div className="runtime-heading">
        <div>
          <div className="eyebrow">PUBLISHED APP · REVISION {runtime.revisionNumber}</div>
          <h1>{runtime.app.name}</h1>
        </div>
        <Link className="quiet-button" to="/">Back to apps</Link>
      </div>
      {stale && (
        <div className="notice-banner warning" role="status">
          <span>This app was republished — reload to continue.</span>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      <div className="notice-banner">{dataset.simulatedNotice}</div>
      <div className="runtime-grid">
        {orderedBlocks.map((block) => {
          const entry = blockRegistry[block.type];
          const Renderer = entry.Renderer;
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
          <p className="empty-state">This app does not contain any blocks yet.</p>
        )}
      </div>
      {dialog && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-title"
            onSubmit={submitAction}
          >
            <div className="eyebrow">CONFIRM DECISION</div>
            <h2 id="decision-title">{dialog.block.config.label}?</h2>
            <p className="muted">{recordSummary(dialog.record)}</p>
            <label>
              Reason
              <textarea
                autoFocus
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Enter a reason (3–500 characters)"
              />
            </label>
            {dialogError && <p className="error-message" role="alert">{dialogError}</p>}
            <div className="dialog-actions">
              <button
                className="quiet-button"
                type="button"
                disabled={submitting}
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                className={dialog.block.config.actionId.endsWith(".reject") ? "danger-button" : "primary-button"}
                disabled={submitting || reason.trim().length < 3 || stale}
                type="submit"
              >
                {submitting ? "Submitting…" : "Confirm"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
