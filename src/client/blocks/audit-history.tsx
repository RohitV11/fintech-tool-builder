import { useEffect, useState } from "react";
import {
  AuditHistoryConfigSchema,
  type AuditHistoryBlock,
  type Block,
  type RecordTableBlock,
} from "../../shared/schema";
import { api } from "../api";
import { formatValue } from "./format";
import type { InspectorProps, RendererProps } from "./types";

interface AuditEvent {
  auditEventId: string;
  at: string;
  actionId: string;
  reason: string | null;
  actor: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export function AuditHistoryInspector({ config, onChange, definition }: InspectorProps) {
  const auditConfig = config as AuditHistoryBlock["config"];
  const tables = definition.blocks.filter(
    (block): block is RecordTableBlock => block.type === "record_table",
  );
  const update = (next: AuditHistoryBlock["config"]) => onChange(next as Block["config"]);

  return (
    <div className="inspector-fields">
      <label>
        Title
        <input
          value={auditConfig.title}
          onChange={(event) => update({ ...auditConfig, title: event.target.value })}
        />
      </label>
      <label>
        Source table
        <select
          value={auditConfig.sourceTableId}
          onChange={(event) => update({ ...auditConfig, sourceTableId: event.target.value })}
        >
          <option value="">Select a table</option>
          {tables.map((table) => <option key={table.id} value={table.id}>{table.config.title}</option>)}
        </select>
      </label>
    </div>
  );
}

export function AuditHistoryRenderer({ block: rawBlock, ctx }: RendererProps) {
  const block = rawBlock as AuditHistoryBlock;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const selectedId = ctx.selection[block.config.sourceTableId] ?? null;
  const table = ctx.definition.blocks.find(
    (candidate) => candidate.type === "record_table" && candidate.id === block.config.sourceTableId,
  );

  useEffect(() => {
    if (ctx.mode === "design" || !selectedId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    const base =
      ctx.mode === "preview"
        ? `/api/apps/${encodeURIComponent(ctx.appId)}/draft/blocks/${encodeURIComponent(block.id)}/audit`
        : `/api/apps/${encodeURIComponent(ctx.appId)}/blocks/${encodeURIComponent(block.id)}/audit`;
    setLoading(true);
    setError("");
    api<{ events: AuditEvent[] }>(`${base}?recordId=${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (!cancelled) setEvents(result.events);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load audit history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [block.id, ctx.appId, ctx.mode, ctx.refreshKey, retryKey, selectedId]);

  if (ctx.mode === "design") {
    return (
      <section className="block-panel">
        <div className="block-heading"><h2>{block.config.title}</h2></div>
        <p className="block-placeholder">Audit events appear in preview.</p>
      </section>
    );
  }

  return (
    <section className="block-panel">
      <div className="block-heading"><h2>{block.config.title}</h2></div>
      {error && (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
        </div>
      )}
      {!selectedId ? (
        <p className="empty-state">Select a record in {table?.type === "record_table" ? table.config.title : "the table"}.</p>
      ) : loading && events.length === 0 ? (
        <p className="empty-state">Loading audit history…</p>
      ) : events.length === 0 ? (
        <p className="empty-state">No audit events for this record.</p>
      ) : (
        <ol className="audit-list">
          {events.map((event) => (
            <li key={event.auditEventId}>
              <div className="audit-meta">
                <strong>{event.actionId}</strong>
                <time>{formatValue(event.at, { key: "at", label: "Time", type: "datetime" }, {})}</time>
              </div>
              {event.reason && <p>{event.reason}</p>}
              <small>By {event.actor}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export const auditHistoryConfigSchema = AuditHistoryConfigSchema;
