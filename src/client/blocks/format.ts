import type { CatalogField } from "../../shared/catalog-types";

export function formatValue(
  value: unknown,
  field: CatalogField | undefined,
  record: Record<string, unknown>,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field?.type === "money" && typeof value === "number") {
    const currency = typeof record.currency === "string" ? record.currency : "USD";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(value / 100);
    } catch {
      return `${(value / 100).toFixed(2)} ${currency}`;
    }
  }
  if (field?.type === "datetime" && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  if (field?.type === "boolean" && typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function statusClass(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

export function recordSummary(record: Record<string, unknown>): string {
  const reference =
    record.customer_ref ??
    record.key ??
    record.case_id ??
    record.id ??
    "Selected record";
  const amount =
    typeof record.amount_cents === "number"
      ? formatValue(record.amount_cents, { key: "amount_cents", label: "Amount", type: "money" }, record)
      : undefined;
  return [String(reference), amount, String(record.status ?? record.state ?? "")].filter(Boolean).join(" · ");
}
