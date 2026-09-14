import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MultiSelect, type Option } from "../src/components/ui/multiselect";

describe("MultipleSelector component", () => {
  const sampleOptions: Option[] = [
    { value: "react", label: "React" },
    { value: "vue", label: "Vue" },
    { value: "svelte", label: "Svelte" },
    { value: "react-native", label: "React Native" },
  ];

  it("filters options when searchable is true and user types in input", () => {
    render(
      <MultiSelect
        defaultOptions={sampleOptions}
        placeholder="Select options..."
        searchable={true}
      />,
    );

    const input = screen.getByPlaceholderText("Select options...");
    fireEvent.focus(input);

    expect(screen.getByText("React")).toBeDefined();
    expect(screen.getByText("Vue")).toBeDefined();

    fireEvent.change(input, { target: { value: "vue" } });

    expect(screen.getByText("Vue")).toBeDefined();
    expect(screen.queryByText("React")).toBeNull();
    expect(screen.queryByText("Svelte")).toBeNull();
  });

  it("does not filter options when searchable is false even if user types in input", () => {
    render(
      <MultiSelect
        defaultOptions={sampleOptions}
        placeholder="Select options..."
        searchable={false}
      />,
    );

    const input = screen.getByPlaceholderText("Select options...");
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: "vue" } });

    expect(screen.getByText("React")).toBeDefined();
    expect(screen.getByText("Vue")).toBeDefined();
    expect(screen.getByText("Svelte")).toBeDefined();
  });

  it("filters according to searchMode (CaseInsensitive, CaseSensitive, Fuzzy)", () => {
    const { unmount } = render(
      <MultiSelect
        defaultOptions={sampleOptions}
        placeholder="CaseSensitive selector"
        searchMode="CaseSensitive"
      />,
    );

    let input = screen.getByPlaceholderText("CaseSensitive selector");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "react" } });

    // Lowercase "react" should not match "React" in CaseSensitive mode
    expect(screen.queryByText("React")).toBeNull();

    fireEvent.change(input, { target: { value: "React" } });
    expect(screen.getByText("React")).toBeDefined();
    expect(screen.getByText("React Native")).toBeDefined();
    expect(screen.queryByText("Vue")).toBeNull();

    unmount();

    // Fuzzy mode test
    render(
      <MultiSelect
        defaultOptions={sampleOptions}
        placeholder="Fuzzy selector"
        searchMode="Fuzzy"
      />,
    );

    input = screen.getByPlaceholderText("Fuzzy selector");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rn" } });

    // "rn" matches "React Native"
    expect(screen.getByText("React Native")).toBeDefined();
    expect(screen.queryByText("Vue")).toBeNull();
    expect(screen.queryByText("Svelte")).toBeNull();
  });

  it("renders emptyMessage or default message when no options match", () => {
    const { unmount } = render(
      <MultiSelect
        defaultOptions={sampleOptions}
        placeholder="Custom empty message"
        emptyMessage="Custom empty state: nothing here"
      />,
    );

    let input = screen.getByPlaceholderText("Custom empty message");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "nonexistent query" } });

    expect(screen.getByText("Custom empty state: nothing here")).toBeDefined();

    unmount();

    // Default message test
    render(<MultiSelect defaultOptions={sampleOptions} placeholder="Default empty message" />);

    input = screen.getByPlaceholderText("Default empty message");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "nonexistent query" } });

    expect(screen.getByText("No options available")).toBeDefined();
  });

  it("confirms CommandItem values match option.value", () => {
    render(<MultiSelect defaultOptions={sampleOptions} placeholder="Select options..." />);

    const input = screen.getByPlaceholderText("Select options...");
    fireEvent.focus(input);

    const items = document.body.querySelectorAll("[cmdk-item]");
    expect(items.length).toBe(sampleOptions.length);

    sampleOptions.forEach((option, index) => {
      const item = items[index];
      const attrValue =
        item.getAttribute("data-value") ??
        item.getAttribute("value") ??
        item.getAttribute("cmdk-value");
      expect(attrValue).toBe(option.value);
    });
  });

  it("supports keyboard navigation with ArrowDown and Enter selection", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <MultiSelect
        defaultOptions={sampleOptions}
        placeholder="Select options..."
        onValueChange={onValueChange}
      />,
    );

    const input = screen.getByPlaceholderText("Select options...");
    fireEvent.focus(input);

    const items = document.body.querySelectorAll("[cmdk-item]");
    // Initial active option is index 0 ("React")
    expect(items[0].getAttribute("data-selected")).toBe("true");

    const root = container.querySelector("[cmdk-root]")!;

    // Navigate with ArrowDown to index 1 ("Vue")
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(items[1].getAttribute("data-selected")).toBe("true");

    // Select highlighted item with Enter
    fireEvent.keyDown(root, { key: "Enter" });

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith([sampleOptions[1]]);
  });
});
