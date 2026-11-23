import {
  ActionButtonConfigSchema,
  type ActionButtonBlock,
  type Block,
  type RecordTableBlock,
} from "../../shared/schema";
import type { InspectorProps, RendererProps } from "./types";

export function ActionButtonInspector({ config, onChange, dataset, definition }: InspectorProps) {
  const actionConfig = config as ActionButtonBlock["config"];
  const tables = definition.blocks.filter(
    (block): block is RecordTableBlock => block.type === "record_table",
  );
  const update = (next: ActionButtonBlock["config"]) => onChange(next as Block["config"]);

  return (
    <div className="inspector-fields">
      <label>
        Button label
        <input
          value={actionConfig.label}
          onChange={(event) => update({ ...actionConfig, label: event.target.value })}
        />
      </label>
      <label>
        Action
        <select
          value={actionConfig.actionId}
          onChange={(event) => update({ ...actionConfig, actionId: event.target.value })}
        >
          <option value="">Select an action</option>
          {dataset.actions.map((action) => (
            <option key={action.id} value={action.id}>{action.label}</option>
          ))}
        </select>
      </label>
      <label>
        Source table
        <select
          value={actionConfig.sourceTableId}
          onChange={(event) => update({ ...actionConfig, sourceTableId: event.target.value })}
        >
          <option value="">Select a table</option>
          {tables.map((table) => <option key={table.id} value={table.id}>{table.config.title}</option>)}
        </select>
      </label>
    </div>
  );
}

export function ActionButtonRenderer({ block: rawBlock, ctx }: RendererProps) {
  const block = rawBlock as ActionButtonBlock;
  const recordId = ctx.selection[block.config.sourceTableId] ?? null;
  const record = ctx.selectedRecords[block.config.sourceTableId];
  const availableActions = Array.isArray(record?.availableActions)
    ? record.availableActions.filter((actionId): actionId is string => typeof actionId === "string")
    : undefined;
  const actionAvailable = availableActions?.includes(block.config.actionId) ?? false;
  const permitted = ctx.user.role === "reviewer";
  const enabled =
    ctx.mode === "runtime" && permitted && !ctx.stale && Boolean(recordId && record && actionAvailable);
  const title = (() => {
    if (ctx.mode === "preview") return "Disabled in preview";
    if (!permitted) return "Reviewer role required";
    if (ctx.stale) return "Reload the published app before deciding";
    if (!recordId) return `Select a record in ${tableTitle(ctx, block.config.sourceTableId)}`;
    if (!record || !availableActions) return "Checking current status";
    if (!actionAvailable) return "Not available for current status";
    return undefined;
  })();

  if (ctx.mode === "design") {
    return (
      <section className="block-panel action-block">
        <div className="block-heading"><h2>{block.config.label}</h2></div>
        <button className="primary-button" disabled>{block.config.label}</button>
      </section>
    );
  }

  return (
    <section className="block-panel action-block">
      <div className="block-heading"><h2>{block.config.label}</h2></div>
      {!recordId && (
        <p className="empty-state">Select a record in {tableTitle(ctx, block.config.sourceTableId)}.</p>
      )}
      <button
        className={block.config.actionId.endsWith(".reject") ? "danger-button" : "primary-button"}
        disabled={!enabled}
        title={title}
        onClick={() => {
          if (record) ctx.openAction(block, record);
        }}
      >
        {block.config.label}
      </button>
      {record && availableActions && !actionAvailable && (
        <p className="role-explanation">Not available for current status</p>
      )}
      {!permitted && <p className="role-explanation">Reviewer role required</p>}
    </section>
  );
}

function tableTitle(ctx: RendererProps["ctx"], tableId: string): string {
  const table = ctx.definition.blocks.find(
    (block): block is RecordTableBlock => block.type === "record_table" && block.id === tableId,
  );
  return table?.config.title ?? "the table";
}

export const actionButtonConfigSchema = ActionButtonConfigSchema;
