import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type SessionUser } from "../api";
import type { AppDefinition, ActionButtonBlock } from "../../shared/schema";
import type { SafeCatalog } from "../../shared/catalog-types";

interface RefundRecord {
  id: string;
  version: number;
  customer_ref?: string;
  amount_cents?: number;
  currency?: string;
  reason_submitted?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

interface RuntimeResponse {
  app: { id: string; name: string };
  revisionId: string;
  revisionNumber: number;
  definition: AppDefinition;
}

interface AuditEvent {
  auditEventId: string;
  at: string;
  actionId: string;
  reason: string;
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function money(cents: unknown, currency: unknown): string {
  if (typeof cents !== "number" || typeof currency !== "string") return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function dateTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function RefundPage() {
  const { appId = "" } = useParams();
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<RefundRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState<RefundRecord | null>(null);
  const [details, setDetails] = useState<RefundRecord | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<{
    block: ActionButtonBlock;
    idempotencyKey: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pageSize = useMemo(() => {
    const table = runtime?.definition.blocks.find((block) => block.type === "record_table");
    return table?.type === "record_table" ? table.config.pageSize : 10;
  }, [runtime]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<RuntimeResponse>(`/api/apps/${encodeURIComponent(appId)}/runtime`),
      api<{ user: SessionUser }>("/api/auth/me"),
      api<SafeCatalog>("/api/catalog"),
    ])
      .then(([app, session, catalog]) => {
        if (cancelled) return;
        setRuntime(app);
        setUser(session.user);
        const dataset = catalog.datasets.find((entry) => entry.id === app.definition.datasetId);
        setNotice(dataset?.simulatedNotice ?? "");
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load the app");
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    const query = new URLSearchParams({
      page: String(page),
      status,
    });
    if (search) query.set("search", search);
    api<{ rows: RefundRecord[]; total: number }>(
      `/api/apps/${encodeURIComponent(appId)}/blocks/refund-table/records?${query}`,
    )
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
          setTotal(result.total);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load refunds");
      });
    return () => {
      cancelled = true;
    };
  }, [appId, page, pageSize, refreshKey, runtime, search, status]);

  useEffect(() => {
    if (!selected || !runtime) {
      setDetails(null);
      setEvents([]);
      return;
    }
    let cancelled = false;
    const base = `/api/apps/${encodeURIComponent(appId)}/blocks`;
    Promise.all([
      api<{ record: RefundRecord }>(
        `${base}/refund-details/records/${encodeURIComponent(selected.id)}`,
      ),
      api<{ events: AuditEvent[] }>(
        `${base}/refund-audit/audit?recordId=${encodeURIComponent(selected.id)}`,
      ),
    ])
      .then(([recordResult, auditResult]) => {
        if (cancelled) return;
        setDetails(recordResult.record);
        setEvents(auditResult.events);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load record history");
      });
    return () => {
      cancelled = true;
    };
  }, [appId, refreshKey, runtime, selected]);

  const actionBlocks = useMemo(
    () =>
      runtime?.definition.blocks.filter(
        (block): block is ActionButtonBlock => block.type === "action_button",
      ) ?? [],
    [runtime],
  );

  const reloadRuntime = useCallback(() => {
    window.location.reload();
  }, []);

  function searchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function openAction(block: ActionButtonBlock) {
    setReason("");
    setDialogError("");
    setDialog({ block, idempotencyKey: crypto.randomUUID() });
  }

  async function submitAction() {
    if (!dialog || !selected || !runtime) return;
    setSubmitting(true);
    setDialogError("");
    try {
      const result = await api<{ record: RefundRecord; auditEventId: string }>(
        `/api/apps/${encodeURIComponent(appId)}/blocks/${encodeURIComponent(dialog.block.id)}/execute`,
        {
          method: "POST",
          body: JSON.stringify({
            recordId: selected.id,
            expectedVersion: selected.version,
            reason,
            revisionId: runtime.revisionId,
            idempotencyKey: dialog.idempotencyKey,
          }),
        },
      );
      setSelected(result.record);
      setDialog(null);
      setRefreshKey((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STALE_REVISION") {
        setNotice("This app was republished — reload to continue.");
      } else {
        setDialogError(cause instanceof Error ? cause.message : "Unable to submit this decision");
      }
      setRefreshKey((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (error && !runtime) {
    return <main className="page-shell"><p className="error-message" role="alert">{error}</p></main>;
  }
  if (!runtime || !user) return <main className="page-shell"><p>Loading refund queue…</p></main>;

  return (
    <main className="page-shell refund-page">
      <header className="topbar">
        <Link to="/" className="brand">Fintech Tool Builder</Link>
        <span className="role-tag">{user.displayName} · {user.role}</span>
      </header>
      <div className="breadcrumbs"><Link to="/">Apps</Link><span>/</span>{runtime.app.name}</div>
      <div className="refund-heading">
        <div>
          <div className="eyebrow">PUBLISHED APP · REVISION {runtime.revisionNumber}</div>
          <h1>{runtime.app.name}</h1>
          <p className="muted">Review synthetic refund requests and record a decision.</p>
        </div>
        <Link className="quiet-button" to="/">Back to apps</Link>
      </div>
      {notice && <div className={`notice-banner${notice.startsWith("This app") ? " warning" : ""}`} role="status">{notice}{notice.startsWith("This app") && <button onClick={reloadRuntime}>Reload</button>}</div>}
      {error && <div className="inline-error" role="alert">{error}<button onClick={() => { setError(""); setRefreshKey((value) => value + 1); }}>Retry</button></div>}

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Refund requests</h2><p className="muted">{total} matching synthetic records</p></div>
          <form className="table-controls" onSubmit={searchSubmit}>
            <input aria-label="Search refunds" placeholder="Search customer or currency" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
            <select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <button className="primary-button compact" type="submit">Search</button>
          </form>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Customer</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {rows.map((record) => (
                <tr
                  key={record.id}
                  className={selected?.id === record.id ? "selected-row" : ""}
                  onClick={() => setSelected(record)}
                  onKeyDown={(event) => { if (event.key === "Enter") setSelected(record); }}
                  tabIndex={0}
                  aria-selected={selected?.id === record.id}
                >
                  <td><strong>{record.customer_ref}</strong><small>{record.id}</small></td>
                  <td>{money(record.amount_cents, record.currency)}</td>
                  <td><span className={`status-pill ${record.status}`}>{record.status}</span></td>
                  <td>{dateTime(record.created_at)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td className="empty-state" colSpan={4}>No records match</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>Page {page} of {totalPages}</span>
          <div><button className="quiet-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="quiet-button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div>
        </div>
      </section>

      <div className="record-columns">
        <section className="panel record-panel">
          <div className="panel-heading"><div><h2>Request details</h2><p className="muted">{selected ? selected.id : "Select a record to review"}</p></div></div>
          {!details ? <p className="empty-state">Select a record in Refund requests.</p> : (
            <>
              <dl className="detail-grid">
                <div><dt>Customer reference</dt><dd>{details.customer_ref}</dd></div>
                <div><dt>Amount</dt><dd>{money(details.amount_cents, details.currency)}</dd></div>
                <div><dt>Status</dt><dd><span className={`status-pill ${details.status}`}>{details.status}</span></dd></div>
                <div><dt>Record version</dt><dd>{details.version}</dd></div>
                <div className="wide"><dt>Submitted reason</dt><dd>{details.reason_submitted || "No reason supplied"}</dd></div>
                <div className="wide"><dt>Created</dt><dd>{dateTime(details.created_at)}</dd></div>
              </dl>
              <div className="action-row">
                {actionBlocks.map((block) => (
                  <button
                    key={block.id}
                    className={block.config.actionId.endsWith(".reject") ? "danger-button" : "primary-button"}
                    disabled={!selected || user.role !== "reviewer" || Boolean(notice.startsWith("This app"))}
                    title={user.role !== "reviewer" ? "Reviewer role required" : undefined}
                    onClick={() => openAction(block)}
                  >
                    {block.config.label}
                  </button>
                ))}
                {user.role !== "reviewer" && <span className="muted small">Reviewer role required</span>}
              </div>
            </>
          )}
        </section>
        <section className="panel audit-panel">
          <div className="panel-heading"><div><h2>Decision history</h2><p className="muted">Persistent, permission-protected audit events</p></div></div>
          {!selected ? <p className="empty-state">Select a record to view its history.</p> : !events.length ? <p className="empty-state">No decisions recorded for this request.</p> : (
            <ol className="audit-list">
              {events.map((event) => (
                <li key={event.auditEventId}>
                  <div className="audit-meta"><strong>{event.actionId.endsWith(".approve") ? "Approved" : "Rejected"}</strong><time>{dateTime(event.at)}</time></div>
                  <p>{event.reason}</p>
                  <small>By {event.actor}</small>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {dialog && selected && (
        <div className="modal-backdrop" role="presentation">
          <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="decision-title">
            <div className="eyebrow">CONFIRM DECISION</div>
            <h2 id="decision-title">{dialog.block.config.label}?</h2>
            <p className="muted">{selected.customer_ref} · {money(selected.amount_cents, selected.currency)} · {selected.status}</p>
            <label>Reason <textarea autoFocus minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Enter a reason (3–500 characters)" /></label>
            {dialogError && <p className="error-message" role="alert">{dialogError}</p>}
            <div className="dialog-actions"><button className="quiet-button" disabled={submitting} onClick={() => setDialog(null)}>Cancel</button><button className={dialog.block.config.actionId.endsWith(".reject") ? "danger-button" : "primary-button"} disabled={submitting || reason.trim().length < 3} onClick={submitAction}>{submitting ? "Submitting…" : "Confirm"}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
