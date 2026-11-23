import { describe, expect, it } from "vitest";
import type { SafeCatalog } from "../../src/shared/catalog-types.js";
import { AppDefinitionSchema } from "../../src/shared/schema.js";
import { refundAppDefinition } from "../../src/server/seed-apps/refunds.js";
import { validateDefinition } from "../../src/shared/validate.js";
import "../../src/server/datasets/refunds.js";
import { safeCatalog } from "../../src/server/datasets/registry.js";

const catalog: SafeCatalog = safeCatalog();

function copyDefinition() {
  return structuredClone(refundAppDefinition);
}

describe("validateDefinition", () => {
  it("accepts the seeded refund definition", () => {
    expect(validateDefinition(refundAppDefinition, catalog)).toEqual({ ok: true });
  });

  it("accepts legacy table configs without a status-badge setting", () => {
    const definition = copyDefinition();
    const table = definition.blocks.find((block) => block.type === "record_table");
    if (table?.type === "record_table") {
      const legacyConfig = { ...table.config };
      delete (legacyConfig as Partial<typeof legacyConfig>).showStatusBadge;
      table.config = legacyConfig;
    }

    expect(validateDefinition(definition, catalog)).toEqual({ ok: true });
    const parsed = AppDefinitionSchema.parse(definition);
    const parsedTable = parsed.blocks.find((block) => block.type === "record_table");
    expect(parsedTable?.type === "record_table" && parsedTable.config.showStatusBadge).toBe(false);
  });

  it("rejects a broken source table reference", () => {
    const definition = copyDefinition();
    const details = definition.blocks.find((block) => block.type === "record_details");
    if (details?.type === "record_details") details.config.sourceTableId = "missing-table";

    const result = validateDefinition(definition, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path.endsWith("sourceTableId"))).toBe(true);
    }
  });

  it("rejects an unknown dataset field", () => {
    const definition = copyDefinition();
    const table = definition.blocks.find((block) => block.type === "record_table");
    if (table?.type === "record_table") table.config.columns.push("internal_secret");

    const result = validateDefinition(definition, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.message.includes("internal_secret"))).toBe(true);
    }
  });

  it("rejects an action incompatible with its dataset", () => {
    const definition = copyDefinition();
    const action = definition.blocks.find((block) => block.type === "action_button");
    if (action?.type === "action_button") action.config.actionId = "flags.enable";

    const result = validateDefinition(definition, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path.endsWith("actionId"))).toBe(true);
    }
  });

  it("rejects overlapping and out-of-grid layouts", () => {
    const overlapping = copyDefinition();
    const table = overlapping.blocks.find((block) => block.type === "record_table");
    const details = overlapping.blocks.find((block) => block.type === "record_details");
    if (table && details) details.layout = { ...table.layout };
    const overlapResult = validateDefinition(overlapping, catalog);
    expect(
      !overlapResult.ok &&
        overlapResult.errors.some((error) => error.message.includes("overlaps")),
    ).toBe(true);

    const outsideGrid = copyDefinition();
    const action = outsideGrid.blocks.find((block) => block.type === "action_button");
    if (action) action.layout = { x: 10, y: 13, w: 3, h: 4 };
    const layoutResult = validateDefinition(outsideGrid, catalog);
    expect(
      !layoutResult.ok &&
        layoutResult.errors.some((error) => error.message.includes("12-column grid")),
    ).toBe(true);
  });

  it("rejects strict-schema unknown keys", () => {
    const definition = { ...copyDefinition(), unexpected: "no" };
    const result = validateDefinition(definition, catalog);
    expect(result.ok).toBe(false);
  });
});
