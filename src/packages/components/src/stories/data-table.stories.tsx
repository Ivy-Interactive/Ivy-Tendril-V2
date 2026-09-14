import type { Meta, StoryObj } from "@storybook/react";
import { MoreHorizontal, Pencil } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  type DataTableColumn,
  type DataTableRowAction,
} from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";

const meta: Meta = {
  title: "UI/DataTable",
};

export default meta;

interface Deployment {
  id: string;
  service: string;
  environment: string;
  status: "Healthy" | "Degraded" | "Failed";
  requests: number;
  owner: string;
}

const services = [
  "auth-api",
  "billing-api",
  "search-api",
  "notifier",
  "scheduler",
  "gateway",
  "reporting",
  "webhooks",
];
const environments = ["production", "staging", "preview"];
const statuses: Deployment["status"][] = ["Healthy", "Degraded", "Failed"];
const owners = ["Platform", "Payments", "Growth", "Data"];

const deployments: Deployment[] = Array.from({ length: 40 }, (_, index) => ({
  id: `d${index + 1}`,
  service: `${services[index % services.length]}-${index + 1}`,
  environment: environments[index % environments.length],
  status: statuses[index % statuses.length],
  requests: (index + 1) * 137 + (index % 7) * 29,
  owner: owners[index % owners.length],
}));

const statusVariant: Record<Deployment["status"], "success" | "warning" | "destructive"> = {
  Healthy: "success",
  Degraded: "warning",
  Failed: "destructive",
};

const rowActions: DataTableRowAction<Deployment>[] = [
  { tag: "edit", label: "Edit owner", icon: <Pencil aria-hidden="true" />, tooltip: "Edit owner" },
  {
    tag: "more",
    label: "More actions",
    icon: <MoreHorizontal aria-hidden="true" />,
    children: [
      { tag: "redeploy", label: "Redeploy" },
      { tag: "logs", label: "View logs" },
      { tag: "sep", label: "—", variant: "separator" },
      { tag: "delete", label: "Delete", variant: "destructive" },
    ],
  },
];

const FullFeaturedDemo = () => {
  // The table never mutates its rows: committed edits are applied here and passed back in.
  const [rows, setRows] = React.useState(deployments);
  const [filter, setFilter] = React.useState("");
  const [lastAction, setLastAction] = React.useState<string>("none");

  const columns: DataTableColumn<Deployment>[] = [
    { name: "service", header: "Service", width: "200px" },
    { name: "environment", header: "Environment", help: "Deployment target" },
    {
      name: "status",
      header: "Status",
      cell: (value) => (
        <Badge variant={statusVariant[value as Deployment["status"]]}>
          {value as Deployment["status"]}
        </Badge>
      ),
    },
    {
      name: "requests",
      header: "Requests",
      align: "Right",
      cell: (value) => (value as number).toLocaleString(),
      footer: rows.reduce((total, row) => total + row.requests, 0).toLocaleString(),
    },
    { name: "owner", header: "Owner", editable: true, help: "Double-click to edit" },
  ];

  const needle = filter.trim().toLowerCase();
  const visibleRows = needle
    ? rows.filter((row) => row.service.toLowerCase().includes(needle))
    : rows;

  return (
    <div className="flex w-[900px] flex-col gap-2">
      <DataTable
        columns={columns}
        rows={visibleRows}
        getRowId={(row) => row.id}
        caption="Recent deployments"
        selectable
        editable
        showColumnOptions
        defaultPageSize={10}
        rowActions={rowActions}
        onRowAction={({ tag, id }) => setLastAction(`${tag} on ${id}`)}
        onCellCommit={({ id, value }) => {
          setRows((current) =>
            current.map((row) => (row.id === id ? { ...row, owner: value } : row)),
          );
        }}
        toolbar={{
          left: (
            <Input
              aria-label="Filter services"
              className="w-64"
              placeholder="Filter services..."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          ),
        }}
      />
      <p className="text-sm text-muted-foreground">Last row action: {lastAction}</p>
    </div>
  );
};

export const FullFeatured: StoryObj = {
  render: () => <FullFeaturedDemo />,
};

const simpleColumns: DataTableColumn<Deployment>[] = [
  { name: "service", header: "Service" },
  { name: "environment", header: "Environment" },
  { name: "requests", header: "Requests", align: "Right" },
];

export const Empty: StoryObj = {
  render: () => (
    <div className="w-[700px]">
      <DataTable columns={simpleColumns} rows={[]} getRowId={(row) => row.id} />
    </div>
  ),
};

export const Loading: StoryObj = {
  render: () => (
    <div className="w-[700px]">
      <DataTable
        columns={simpleColumns}
        rows={deployments.slice(0, 5)}
        getRowId={(row) => row.id}
        loading
      />
    </div>
  ),
};
