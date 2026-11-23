export type FieldType = "text" | "money" | "status" | "boolean" | "datetime" | "int";

export interface CatalogField {
  key: string;
  label: string;
  type: FieldType;
}

export interface CatalogAction {
  id: string;
  label: string;
}

export interface CatalogDataset {
  id: string;
  label: string;
  simulatedNotice: string;
  fields: CatalogField[];
  statusValues: string[];
  actions: CatalogAction[];
}

export interface SafeCatalog {
  blocks: { id: string; label: string }[];
  datasets: CatalogDataset[];
}

export interface ValidationError {
  path: string;
  blockId?: string;
  message: string;
}
