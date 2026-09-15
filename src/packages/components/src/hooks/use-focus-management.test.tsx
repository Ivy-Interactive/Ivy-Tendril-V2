import { useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import {
  _resetFocusRegistryForTesting,
  useFocusManagement,
  useFocusable,
  type FocusManager,
} from "./use-focus-management";

/** Captures a group's manager so a test can drive it directly. */
const Group = ({ groupId, onReady }: { groupId: string; onReady: (m: FocusManager) => void }) => {
  const manager = useFocusManagement(groupId);
  onReady(manager);
  return null;
};

const Focusable = ({
  groupId,
  priority,
  label,
}: {
  groupId: string;
  priority: number;
  label: string;
}) => {
  const { ref } = useFocusable(groupId, priority);
  return <button ref={ref} aria-label={label} />;
};

describe("useFocusManagement", () => {
  beforeEach(() => {
    _resetFocusRegistryForTesting();
  });

  afterEach(() => {
    _resetFocusRegistryForTesting();
  });

  it("walks a group in priority order and never crosses into another group", () => {
    let a: FocusManager | undefined;
    let b: FocusManager | undefined;
    const { getByLabelText } = render(
      <>
        <Group groupId="a" onReady={(m) => (a = m)} />
        <Group groupId="b" onReady={(m) => (b = m)} />
        {/* Declared out of priority order on purpose. */}
        <Focusable groupId="a" priority={2} label="a-last" />
        <Focusable groupId="a" priority={0} label="a-first" />
        <Focusable groupId="a" priority={1} label="a-middle" />
        <Focusable groupId="b" priority={0} label="b-first" />
        <Focusable groupId="b" priority={1} label="b-second" />
      </>,
    );

    const first = getByLabelText("a-first");
    const middle = getByLabelText("a-middle");
    const last = getByLabelText("a-last");

    a?.focusFirst();
    expect(first).toHaveFocus();

    a?.focusNext();
    expect(middle).toHaveFocus();
    a?.focusNext();
    expect(last).toHaveFocus();
    // From the last element the walk wraps to the first.
    a?.focusNext();
    expect(first).toHaveFocus();

    // From the first element, focusPrevious wraps to the last.
    a?.focusPrevious();
    expect(last).toHaveFocus();
    a?.focusPrevious();
    expect(middle).toHaveFocus();

    a?.focusLast();
    expect(last).toHaveFocus();

    // focusIndex addresses the walk by position, in priority order rather than declaration order,
    // and ignores an index nobody occupies instead of throwing.
    a?.focusIndex(1);
    expect(middle).toHaveFocus();
    a?.focusIndex(0);
    expect(first).toHaveFocus();
    a?.focusIndex(9);
    expect(first).toHaveFocus();

    // Group b's elements are never reached by group a's manager.
    expect(getByLabelText("b-first")).not.toHaveFocus();
    expect(getByLabelText("b-second")).not.toHaveFocus();

    b?.focusFirst();
    expect(getByLabelText("b-first")).toHaveFocus();
  });

  it("honours an explicit priority argument to registerElement", () => {
    let manager: FocusManager | undefined;
    render(<Group groupId="direct" onReady={(m) => (manager = m)} />);

    const high = document.createElement("button");
    const low = document.createElement("button");
    document.body.append(high, low);
    try {
      // Registered first but with the lower priority (higher number), so it must sort second.
      manager?.registerElement(low, 2);
      manager?.registerElement(high, 0);

      manager?.focusFirst();
      expect(high).toHaveFocus();
      manager?.focusLast();
      expect(low).toHaveFocus();
    } finally {
      high.remove();
      low.remove();
    }
  });

  it("drops an element on unregisterElement and ignores a duplicate registration", () => {
    let manager: FocusManager | undefined;
    render(<Group groupId="churn" onReady={(m) => (manager = m)} />);

    const one = document.createElement("button");
    const two = document.createElement("button");
    document.body.append(one, two);
    try {
      manager?.registerElement(one, 0);
      manager?.registerElement(one, 0);
      manager?.registerElement(two, 1);

      // If `one` were in the walk twice, focusNext from it would land on itself.
      manager?.focusFirst();
      expect(one).toHaveFocus();
      manager?.focusNext();
      expect(two).toHaveFocus();

      manager?.unregisterElement(two);
      manager?.focusFirst();
      expect(one).toHaveFocus();
      manager?.focusNext();
      expect(one).toHaveFocus();
    } finally {
      one.remove();
      two.remove();
    }
  });

  it("keeps its group after the host re-renders", () => {
    // The bug this guards: useFocusable's unmount effect and ref callback both depend on the
    // manager object. When that object was rebuilt every render, a re-render ran the effect's
    // cleanup *after* the ref had re-attached, so the group emptied and every focus call became a
    // no-op. A list whose arrow keys change state re-renders on the first press, so the roving
    // focus worked exactly once — and only in a test that never re-rendered.
    let manager: FocusManager | undefined;
    const Host = () => {
      const [count, setCount] = useState(0);
      return (
        <>
          <Group groupId="rerender" onReady={(m) => (manager = m)} />
          <Focusable groupId="rerender" priority={0} label="row-0" />
          <Focusable groupId="rerender" priority={1} label="row-1" />
          <button type="button" aria-label="bump" onClick={() => setCount(count + 1)}>
            {count}
          </button>
        </>
      );
    };
    const { getByLabelText } = render(<Host />);

    manager?.focusFirst();
    expect(getByLabelText("row-0")).toHaveFocus();

    fireEvent.click(getByLabelText("bump"));
    fireEvent.click(getByLabelText("bump"));

    manager?.focusNext();
    expect(getByLabelText("row-1")).toHaveFocus();
    manager?.focusPrevious();
    expect(getByLabelText("row-0")).toHaveFocus();
  });

  it("unregisters a focusable on unmount", () => {
    let manager: FocusManager | undefined;
    const { unmount } = render(
      <>
        <Group groupId="lifecycle" onReady={(m) => (manager = m)} />
        <Focusable groupId="lifecycle" priority={0} label="only" />
      </>,
    );

    manager?.focusFirst();
    expect(document.activeElement).not.toBe(document.body);

    const captured = manager;
    unmount();

    captured?.focusFirst();
    expect(document.activeElement).toBe(document.body);
  });
});
