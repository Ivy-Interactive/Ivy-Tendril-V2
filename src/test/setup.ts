import "@testing-library/jest-dom";

// jsdom has no ResizeObserver, but components-storybook's AgentViewer installs
// one to drive auto-scroll. Without this stub any test that renders a job
// session dies with "ResizeObserver is not defined" before asserting anything.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = ResizeObserverStub;
}
