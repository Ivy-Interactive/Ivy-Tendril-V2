import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import "@testing-library/jest-dom";

import { TendrilDashboard } from "./TendrilDashboard";
import type { DashboardKpiDto } from "./types";

const identified: DashboardKpiDto[] = [
  { id: "featuresShipped", label: "Features Shipped", value: "128", hint: "last 60 days" },
  { id: "forecastMonth", label: "Forecast This Month", value: "$620 – $940" },
];

const unidentified: DashboardKpiDto[] = [
  { label: "Merge Rate", value: "96.4%", delta: "+2.1%", direction: "up" },
];

function renderDashboard(kpis: DashboardKpiDto[], events: string[]) {
  const eventHandler = vi.fn();
  render(
    <TendrilDashboard
      id="dashboard-under-test"
      events={events}
      eventHandler={eventHandler}
      kpis={kpis}
    />,
  );
  return eventHandler;
}

describe("dashboard KPI selection", () => {
  it("reports OnSelectKpi with the tile's id as the sole argument", async () => {
    const eventHandler = renderDashboard(identified, ["OnSelectKpi"]);

    await userEvent.click(screen.getByRole("button", { name: /Features Shipped/ }));

    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler).toHaveBeenCalledWith("OnSelectKpi", "dashboard-under-test", [
      "featuresShipped",
    ]);

    await userEvent.click(screen.getByRole("button", { name: /Forecast This Month/ }));

    expect(eventHandler).toHaveBeenLastCalledWith("OnSelectKpi", "dashboard-under-test", [
      "forecastMonth",
    ]);
  });

  it("leaves a KPI without an id inert rather than a focusable control", async () => {
    // An unidentified tile has nothing to drill into. Rendering it as a button would advertise a
    // click target that does nothing and put a dead stop in the tab order.
    renderDashboard(unidentified, ["OnSelectKpi"]);

    expect(screen.queryByRole("button", { name: /Merge Rate/ })).not.toBeInTheDocument();
    expect(screen.getByText("Merge Rate")).toBeInTheDocument();
    expect(screen.getByText("96.4%")).toBeInTheDocument();
  });

  it("stays silent when the host has not subscribed to OnSelectKpi", async () => {
    // The host declares which events it handles. An unsubscribed event must not fire, the same rule
    // every other dashboard event follows.
    const eventHandler = renderDashboard(identified, ["OnJobs"]);

    await userEvent.click(screen.getByRole("button", { name: /Features Shipped/ }));

    expect(eventHandler).not.toHaveBeenCalled();
  });

  it("renders the hint under the value and omits it when absent", () => {
    renderDashboard(identified, ["OnSelectKpi"]);

    expect(screen.getByText("last 60 days")).toBeInTheDocument();

    const withoutHint = screen.getByRole("button", { name: /Forecast This Month/ });
    expect(withoutHint.querySelector(".tdb-kpi-hint")).toBeNull();
  });
});
