import type { AppDefinition } from "../../shared/schema.js";

export const refundAppDefinition: AppDefinition = {
  schemaVersion: 1,
  name: "Refund approvals",
  datasetId: "refunds",
  blocks: [
    {
      id: "refund-table",
      type: "record_table",
      layout: { x: 0, y: 0, w: 12, h: 12 },
      config: {
        title: "Refund requests",
        columns: ["customer_ref", "amount_cents", "currency", "status", "created_at"],
        defaultStatusFilter: "pending",
        pageSize: 10,
        showStatusBadge: true,
      },
    },
    {
      id: "refund-details",
      type: "record_details",
      layout: { x: 0, y: 13, w: 6, h: 7 },
      config: {
        title: "Request details",
        fields: ["customer_ref", "amount_cents", "currency", "reason_submitted", "status"],
        sourceTableId: "refund-table",
      },
    },
    {
      id: "approve-refund",
      type: "action_button",
      layout: { x: 6, y: 13, w: 3, h: 4 },
      config: {
        label: "Approve",
        actionId: "refunds.approve",
        sourceTableId: "refund-table",
      },
    },
    {
      id: "reject-refund",
      type: "action_button",
      layout: { x: 9, y: 13, w: 3, h: 4 },
      config: {
        label: "Reject",
        actionId: "refunds.reject",
        sourceTableId: "refund-table",
      },
    },
    {
      id: "refund-audit",
      type: "audit_history",
      layout: { x: 0, y: 21, w: 12, h: 8 },
      config: {
        title: "Decision history",
        sourceTableId: "refund-table",
      },
    },
  ],
};
