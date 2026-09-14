import { describe, expect, it } from "vite-plus/test";
import { filterOptionsBySearch } from "../src/components/ui/select/utils";

describe("selectUtils: filterOptionsBySearch", () => {
  const options = [
    { value: "react", label: "React" },
    { value: "vue", label: "Vue" },
    { value: "svelte", label: "Svelte" },
    { value: "angular", label: "Angular" },
    { value: "react-native", label: "React Native" },
  ];

  it("handles CaseInsensitive matching (default)", () => {
    const result = filterOptionsBySearch(options, "react");
    expect(result).toEqual([
      { value: "react", label: "React" },
      { value: "react-native", label: "React Native" },
    ]);

    const upperResult = filterOptionsBySearch(options, "VUE", "CaseInsensitive");
    expect(upperResult).toEqual([{ value: "vue", label: "Vue" }]);
  });

  it("handles CaseSensitive matching", () => {
    const matched = filterOptionsBySearch(options, "React", "CaseSensitive");
    expect(matched).toEqual([
      { value: "react", label: "React" },
      { value: "react-native", label: "React Native" },
    ]);

    const failed = filterOptionsBySearch(options, "react", "CaseSensitive");
    expect(failed).toEqual([]);

    const exactMatch = filterOptionsBySearch(options, "Vue", "CaseSensitive");
    expect(exactMatch).toEqual([{ value: "vue", label: "Vue" }]);
  });

  it("handles Fuzzy matching via subsequence traversal", () => {
    // "rn" -> "React Native" (R...eact N...ative)
    const result = filterOptionsBySearch(options, "rn", "Fuzzy");
    expect(result).toEqual([{ value: "react-native", label: "React Native" }]);

    // "svt" -> "Svelte" (S...v...el...t...e)
    const svelteResult = filterOptionsBySearch(options, "svt", "Fuzzy");
    expect(svelteResult).toEqual([{ value: "svelte", label: "Svelte" }]);

    // Out of order characters: "et" in Svelte (S-v-e-l-t-e), but "te" should match, while reversed shouldn't
    const outOfOrder = filterOptionsBySearch(options, "tlev", "Fuzzy");
    expect(outOfOrder).toEqual([]);
  });

  it("returns options unmodified when query is empty or only whitespace", () => {
    expect(filterOptionsBySearch(options, "")).toEqual(options);
    expect(filterOptionsBySearch(options, "   ")).toEqual(options);
  });

  it("returns empty list when options array is empty", () => {
    expect(filterOptionsBySearch([], "react")).toEqual([]);
  });

  it("handles options with missing, null, or empty labels without throwing", () => {
    const mixedOptions = [
      { value: "1" },
      { value: "2", label: "" },
      { value: "3", label: "Valid Label" },
    ];

    const result = filterOptionsBySearch(mixedOptions, "valid");
    expect(result).toEqual([{ value: "3", label: "Valid Label" }]);

    const noMatch = filterOptionsBySearch(mixedOptions, "nonexistent");
    expect(noMatch).toEqual([]);
  });
});
