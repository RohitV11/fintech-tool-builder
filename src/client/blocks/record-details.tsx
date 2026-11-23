import { useEffect, useState } from "react";
import {
  RecordDetailsConfigSchema,
  type Block,
  type RecordDetailsBlock,
  type RecordTableBlock,
} from "../../shared/schema";
import { api } from "../api";
import { formatValue, statusClass } from "./format";
import type { InspectorProps, RendererProps } from "./types";

export function RecordDetailsInspector({ config, onChange, dataset, definition }: InspectorProps) {
  const detailsConfig = config as RecordDetailsBlock["config"];
  const selectedFields = new Set(detailsConfig.fields);
  const tables = definition.blocks.filter(
    (block): block is RecordTableBlock => block.type === "record_table",
  );
  const update = (next: RecordDetailsBlock["config"]) => onChange(next as Block["config"]);

  return (
    <div className="inspector-fields">
      <label>
        Title
        <input
          value={detailsConfig.title}
          onChange={(event) => update({ ...detailsConfig, title: event.target.value })}
        />
      </label>
      <label>
        Source table
        <select
          value={detailsConfig.sourceTableId}
          onChange={(event) => update({ ...detailsConfig, sourceTableId: event.target.value })}
        >
          <option value="">Select a table</option>
          {tables.map((table) => <option key={table.id} value={table.id}>{table.config.title}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>Fields</legend>
        {dataset.fields.map((field) => (
          <label className="check-label" key={field.key}>
            <input
              type="checkbox"
              checked={selectedFields.has(field.key)}
              onChange={(event) => {
                const fields = event.target.checked
                  ? [...detailsConfig.fields, field.key]
                  : detailsConfig.fields.filter((selected) => selected !== field.key);
                update({ ...detailsConfig, fields });
              }}
            />
            {field.label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function RecordDetailsRenderer({ block: rawBlock, ctx }: RendererProps) {
  const block = rawBlock as RecordDetailsBlock;
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const statusField = ctx.dataset.fields.find((field) => field.type === "status")?.key;
  const table = ctx.definition.blocks.find(
    (candidate) => candidate.type === "record_table" && candidate.id === block.config.sourceTableId,
  );
  const selectedId = ctx.selection[block.config.sourceTableId] ?? null;

  useEffect(() => {
    if (ctx.mode === "design" || !selectedId) {
      setRecord(null);
      return;
    }
    let cancelled = false;
    const base =
      ctx.mode === "preview"
        ? `/api/apps/${encodeURIComponent(ctx.appId)}/draft/blocks/${encodeURIComponent(block.id)}/records`
        : `/api/apps/${encodeURIComponent(ctx.appId)}/blocks/${encodeURIComponent(block.id)}/records`;
    setLoading(true);
    setError("");
    api<{ record: Record<string, unknown> }>(`${base}/${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (!cancelled) {
          setRecord(result.record);
          ctx.select(block.config.sourceTableId, selectedId, result.record);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load record details");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    block.config.sourceTableId,
    block.id,
    ctx.appId,
    ctx.mode,
    ctx.refreshKey,
    ctx.select,
    retryKey,
    selectedId,
  ]);

  if (ctx.mode === "design") {
    return (
      <section className="block-panel">
        <div className="block-heading"><h2>{block.config.title}</h2></div>
        <p className="block-placeholder">Record details appear in preview.</p>
      </section>
    );
  }

  return (
    <section className="block-panel">
      <div className="block-heading">
        <div>
          <h2>{block.config.title}</h2>
          <p className="muted">{record ? String(record.id) : "Selected record details"}</p>
        </div>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setRetryKey((value) => value + 1)}>Retry</button>
        </div>
      )}
      {!selectedId ? (
        <p className="empty-state">Select a record in {table?.type === "record_table" ? table.config.title : "the table"}.</p>
      ) : loading && !record ? (
        <p className="empty-state">Loading record details…</p>
      ) : record ? (
        <dl className="detail-grid">
          {block.config.fields.map((key) => {
            const field = ctx.dataset.fields.find((candidate) => candidate.key === key);
            return (
              <div key={key} className={field?.type === "text" ? "detail-wide" : undefined}>
                <dt>{field?.label ?? key}</dt>
                <dd>
                  {key === statusField || key === "state" ? (
                    <span className={`status-pill ${statusClass(record[key])}`}>
                      {formatValue(record[key], field, record)}
                    </span>
                  ) : formatValue(record[key], field, record)}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : !error ? (
        <p className="empty-state">No record details are available.</p>
      ) : null}
    </section>
  );
}

export const recordDetailsConfigSchema = RecordDetailsConfigSchema;
