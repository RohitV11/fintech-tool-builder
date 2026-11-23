import { useEffect, useState, type FormEvent } from "react";
import {
  RecordTableConfigSchema,
  type Block,
  type RecordTableBlock,
} from "../../shared/schema";
import { api } from "../api";
import type { InspectorProps, RendererProps } from "./types";
import { formatValue, statusClass } from "./format";

interface TableResponse {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export function RecordTableInspector({ config, onChange, dataset }: InspectorProps) {
  const tableConfig = config as RecordTableBlock["config"];
  const columns = new Set(tableConfig.columns);
  const update = (next: RecordTableBlock["config"]) => onChange(next as Block["config"]);

  return (
    <div className="inspector-fields">
      <label>
        Title
        <input
          value={tableConfig.title}
          onChange={(event) => update({ ...tableConfig, title: event.target.value })}
        />
      </label>
      <label>
        Default status
        <select
          value={tableConfig.defaultStatusFilter ?? ""}
          onChange={(event) =>
            update({ ...tableConfig, defaultStatusFilter: event.target.value || null })
          }
        >
          <option value="">All statuses</option>
          {dataset.statusValues.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>
      <label>
        Page size
        <select
          value={tableConfig.pageSize}
          onChange={(event) =>
            update({
              ...tableConfig,
              pageSize: Number(event.target.value) as 5 | 10 | 25,
            })
          }
        >
          {[5, 10, 25].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={tableConfig.showStatusBadge ?? false}
          onChange={(event) =>
            update({ ...tableConfig, showStatusBadge: event.target.checked })
          }
        />
        Show status badge
      </label>
      <fieldset>
        <legend>Columns</legend>
        {dataset.fields.map((field) => (
          <label className="check-label" key={field.key}>
            <input
              type="checkbox"
              checked={columns.has(field.key)}
              onChange={(event) => {
                const nextColumns = event.target.checked
                  ? [...tableConfig.columns, field.key]
                  : tableConfig.columns.filter((column) => column !== field.key);
                update({ ...tableConfig, columns: nextColumns });
              }}
            />
            {field.label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function RecordTableRenderer({ block: rawBlock, ctx }: RendererProps) {
  const block = rawBlock as RecordTableBlock;
  const [result, setResult] = useState<TableResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(block.config.defaultStatusFilter ?? "");
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const selectedId = ctx.selection[block.id] ?? null;
  const statusField = ctx.dataset.fields.find((field) => field.type === "status")?.key;

  useEffect(() => {
    if (ctx.mode === "design") return;
    let cancelled = false;
    const query = new URLSearchParams({ page: String(page) });
    if (search) query.set("search", search);
    if (status) query.set("status", status);
    if (ctx.mode === "runtime" && ctx.revisionId) query.set("revisionId", ctx.revisionId);
    const base =
      ctx.mode === "preview"
        ? `/api/apps/${encodeURIComponent(ctx.appId)}/draft/blocks/${encodeURIComponent(block.id)}/records`
        : `/api/apps/${encodeURIComponent(ctx.appId)}/blocks/${encodeURIComponent(block.id)}/records`;
    setLoading(true);
    setError("");
    void fetchTable(`${base}?${query.toString()}`)
      .then((response) => {
        if (cancelled) return;
        setResult(response);
        const selectedRecord = response.rows.find((row) => row.id === selectedId);
        if (selectedId && selectedRecord) ctx.select(block.id, selectedId, selectedRecord);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load records");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    block.id,
    ctx.appId,
    ctx.mode,
    ctx.refreshKey,
    ctx.revisionId,
    ctx.select,
    page,
    retryKey,
    search,
    selectedId,
    status,
  ]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  }

  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / block.config.pageSize));
  const table = ctx.definition.blocks.find(
    (candidate) => candidate.type === "record_table" && candidate.id === block.id,
  );
  const title = table?.type === "record_table" ? table.config.title : block.config.title;

  if (ctx.mode === "design") {
    return (
      <section className="block-panel">
        <div className="block-heading"><h2>{title}</h2></div>
        <p className="block-placeholder">Records appear in preview.</p>
      </section>
    );
  }

  return (
    <section className="block-panel">
      <div className="block-heading">
        <div><h2>{title}</h2><p className="muted">{total} matching records</p></div>
        <form className="block-table-controls" onSubmit={submitSearch}>
          <input
            aria-label={`Search ${title}`}
            placeholder="Search records"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <select
            aria-label={`Filter ${title} by status`}
            value={status}
            onChange={(event) => { setStatus(event.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            {ctx.dataset.statusValues.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <button className="primary-button compact" type="submit">Search</button>
        </form>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Record</th>
              {block.config.columns.map((key) => (
                <th key={key}>{ctx.dataset.fields.find((field) => field.key === key)?.label ?? key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((record) => (
              <tr
                key={String(record.id)}
                className={selectedId === record.id ? "selected-row" : ""}
                onClick={() => ctx.select(block.id, String(record.id), record)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    ctx.select(block.id, String(record.id), record);
                  }
                }}
                tabIndex={0}
                aria-selected={selectedId === record.id}
              >
                <th scope="row">{String(record.id)}</th>
                {block.config.columns.map((key) => {
                  const value = record[key];
                  const field = ctx.dataset.fields.find((candidate) => candidate.key === key);
                  if (key === statusField || key === "state") {
                    const status = formatValue(value, field, record);
                    return (
                      <td key={key}>
                        {block.config.showStatusBadge ? (
                          <span className={`status-pill ${statusClass(value)}`}>{status}</span>
                        ) : status}
                      </td>
                    );
                  }
                  return (
                    <td key={key}>
                      {formatValue(value, field, record)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td className="empty-state" colSpan={block.config.columns.length + 1}>No records match</td></tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td className="empty-state" colSpan={block.config.columns.length + 1}>Loading records…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="block-pagination">
        <span>Page {page} of {pageCount}</span>
        <div>
          <button className="quiet-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <button className="quiet-button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      </div>
    </section>
  );
}

async function fetchTable(url: string): Promise<TableResponse> {
  return api<TableResponse>(url);
}

export const recordTableConfigSchema = RecordTableConfigSchema;
