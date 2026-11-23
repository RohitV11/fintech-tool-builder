import type { AppDatabase } from "../db.js";
import type { CatalogDataset, SafeCatalog } from "../../shared/catalog-types.js";

export class InvalidTransitionError extends Error {
  constructor(message = "This action is not allowed for the record's current state") {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export interface ActionDef {
  id: string;
  label: string;
  requiresReason: true;
  permission: "actions.execute";
  apply(db: AppDatabase, row: Record<string, unknown>): { after: Record<string, unknown> };
}

export interface DatasetQuery {
  search?: string;
  status?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface DatasetAdapter {
  id: "refunds" | "kyc" | "flags";
  label: string;
  simulatedNotice: string;
  fields: CatalogDataset["fields"];
  searchableFields: string[];
  statusField: string;
  statusValues: string[];
  sortKeys: string[];
  defaultSort: { key: string; dir: "asc" | "desc" };
  query(
    db: AppDatabase,
    args: DatasetQuery,
  ): { rows: Record<string, unknown>[]; total: number };
  get(db: AppDatabase, id: string): Record<string, unknown> | undefined;
  actions: ActionDef[];
}

const adapters = new Map<string, DatasetAdapter>();

export function registerDataset(adapter: DatasetAdapter): void {
  if (adapters.has(adapter.id)) throw new Error(`Dataset already registered: ${adapter.id}`);
  adapters.set(adapter.id, adapter);
}

export function getDataset(id: string): DatasetAdapter | undefined {
  return adapters.get(id);
}

export function listDatasets(): DatasetAdapter[] {
  return [...adapters.values()];
}

export function safeCatalog(): SafeCatalog {
  return {
    blocks: [
      { id: "record_table", label: "Record table" },
      { id: "record_details", label: "Record details" },
      { id: "action_button", label: "Action button" },
      { id: "audit_history", label: "Audit history" },
    ],
    datasets: listDatasets().map((dataset) => ({
      id: dataset.id,
      label: dataset.label,
      simulatedNotice: dataset.simulatedNotice,
      fields: dataset.fields,
      statusValues: dataset.statusValues,
      actions: dataset.actions.map(({ id, label }) => ({ id, label })),
    })),
  };
}

export function clearDatasetRegistryForTests(): void {
  adapters.clear();
}
