import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TendrilProcessViewer } from "./TendrilProcessViewer.tsx";

afterEach(() => {
  cleanup();
});

describe("TendrilProcessViewer", () => {
  it("renders basic pipeline boxes and initial state", () => {
    const eventHandler = vi.fn();
    render(
      <TendrilProcessViewer
        id="test-process"
        eventHandler={eventHandler}
        events={["OnCreate", "OnDrafts", "OnReview", "OnJobs"]}
      />,
    );

    expect(screen.getByText("New Plan")).toBeInTheDocument();
    expect(screen.getByText("Drafts")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();

    const createBtn = screen.getByText("New Plan").closest("button");
    expect(createBtn).toHaveClass("tpv-pulse");
  });

  it("displays stage counts and active transition counts", () => {
    const eventHandler = vi.fn();
    render(
      <TendrilProcessViewer
        id="test-process"
        eventHandler={eventHandler}
        events={["OnCreate", "OnDrafts", "OnReview", "OnJobs"]}
        draftCount={3}
        reviewCount={4}
        creatingPlansCount={5}
        updatingPlansCount={6}
        executingPlansCount={7}
        retryingPlansCount={8}
        creatingPrCount={9}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText(/PR\s*9/)).toBeInTheDocument();

    const createBtn = screen.getByText("New Plan").closest("button");
    expect(createBtn).not.toHaveClass("tpv-pulse");
  });

  it("fires corresponding event callbacks on click", () => {
    const eventHandler = vi.fn();
    render(
      <TendrilProcessViewer
        id="test-process"
        eventHandler={eventHandler}
        events={["OnCreate", "OnDrafts", "OnReview", "OnJobs"]}
        creatingPlansCount={5}
      />,
    );

    fireEvent.click(screen.getByText("New Plan"));
    expect(eventHandler).toHaveBeenCalledWith("OnCreate", "test-process", []);

    fireEvent.click(screen.getByText("Drafts"));
    expect(eventHandler).toHaveBeenCalledWith("OnDrafts", "test-process", []);

    fireEvent.click(screen.getByText("Review"));
    expect(eventHandler).toHaveBeenCalledWith("OnReview", "test-process", []);

    // Arrow click for creating plans
    const countBtn = screen.getByText("5").closest("button");
    if (countBtn) {
      fireEvent.click(countBtn);
      expect(eventHandler).toHaveBeenCalledWith("OnJobs", "test-process", []);
    }
  });

  it("respects enabled events filter", () => {
    const eventHandler = vi.fn();
    render(
      <TendrilProcessViewer id="test-process" eventHandler={eventHandler} events={["OnReview"]} />,
    );

    fireEvent.click(screen.getByText("New Plan"));
    expect(eventHandler).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Review"));
    expect(eventHandler).toHaveBeenCalledWith("OnReview", "test-process", []);
  });
});
