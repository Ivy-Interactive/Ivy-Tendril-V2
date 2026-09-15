import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebounce } from "./use-debounce";

const renderDebounced = (fn: (value: string) => void, delay: number) => {
  let debounced: ((value: string) => void) | undefined;
  const Probe = () => {
    debounced = useDebounce(fn, delay);
    return null;
  };
  render(createElement(Probe));
  if (!debounced) throw new Error("hook did not return a debounced function");
  return debounced;
};

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses rapid calls into one invocation with the last arguments", () => {
    const fn = vi.fn();
    const debounced = renderDebounced(fn, 100);

    for (const value of ["a", "b", "c", "d", "e"]) {
      debounced(value);
      vi.advanceTimersByTime(10);
    }

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("e");
  });

  it("fires again for a call made after the delay has elapsed", () => {
    const fn = vi.fn();
    const debounced = renderDebounced(fn, 100);

    debounced("first");
    vi.advanceTimersByTime(100);
    debounced("second");
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "first");
    expect(fn).toHaveBeenNthCalledWith(2, "second");
  });
});
