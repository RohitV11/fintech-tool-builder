import {
  ActionButtonConfigSchema,
  AuditHistoryConfigSchema,
  RecordDetailsConfigSchema,
  RecordTableConfigSchema,
  type Block,
} from "../../shared/schema";
import {
  ActionButtonInspector,
  ActionButtonRenderer,
} from "./action-button";
import {
  AuditHistoryInspector,
  AuditHistoryRenderer,
} from "./audit-history";
import {
  RecordDetailsInspector,
  RecordDetailsRenderer,
} from "./record-details";
import {
  RecordTableInspector,
  RecordTableRenderer,
} from "./record-table";
import type { BlockRegistryEntry } from "./types";

export const blockRegistry: Record<Block["type"], BlockRegistryEntry> = {
  record_table: {
    type: "record_table",
    label: "Record table",
    configSchema: RecordTableConfigSchema,
    defaults: (dataset) => ({
      title: dataset.label,
      columns: dataset.fields.slice(0, 4).map((field) => field.key),
      defaultStatusFilter: null,
      pageSize: 10,
      showStatusBadge: false,
    }),
    defaultSize: { w: 12, h: 10 },
    Inspector: RecordTableInspector,
    Renderer: RecordTableRenderer,
  },
  record_details: {
    type: "record_details",
    label: "Record details",
    configSchema: RecordDetailsConfigSchema,
    defaults: (dataset) => ({
      title: "Record details",
      fields: dataset.fields.slice(0, 4).map((field) => field.key),
      sourceTableId: "",
    }),
    defaultSize: { w: 6, h: 8 },
    Inspector: RecordDetailsInspector,
    Renderer: RecordDetailsRenderer,
  },
  action_button: {
    type: "action_button",
    label: "Action button",
    configSchema: ActionButtonConfigSchema,
    defaults: (dataset) => ({
      label: dataset.actions[0]?.label ?? "Action",
      actionId: dataset.actions[0]?.id ?? "",
      sourceTableId: "",
    }),
    defaultSize: { w: 3, h: 4 },
    Inspector: ActionButtonInspector,
    Renderer: ActionButtonRenderer,
  },
  audit_history: {
    type: "audit_history",
    label: "Audit history",
    configSchema: AuditHistoryConfigSchema,
    defaults: () => ({ title: "Audit history", sourceTableId: "" }),
    defaultSize: { w: 12, h: 8 },
    Inspector: AuditHistoryInspector,
    Renderer: AuditHistoryRenderer,
  },
};

export function getBlockRegistryEntry(type: string): BlockRegistryEntry | undefined {
  return Object.hasOwn(blockRegistry, type)
    ? blockRegistry[type as Block["type"]]
    : undefined;
}
