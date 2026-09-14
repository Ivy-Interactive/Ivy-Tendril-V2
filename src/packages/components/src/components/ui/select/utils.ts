import { defaultFilter } from "cmdk";

export type SearchMode = "CaseInsensitive" | "CaseSensitive" | "Fuzzy";

/** Filters options by search query supporting CaseInsensitive, CaseSensitive, and Fuzzy modes. */
export function filterOptionsBySearch<T extends { label?: string; value?: string | number }>(
  options: T[],
  search: string,
  mode: SearchMode = "CaseInsensitive",
): T[] {
  if (!search || search.trim() === "") {
    return options;
  }

  if (mode === "CaseSensitive") {
    return options.filter((option) => {
      const label = option.label ?? "";
      return label.includes(search);
    });
  }

  const query = search.toLowerCase();

  if (mode === "CaseInsensitive") {
    return options.filter((option) => {
      const label = (option.label ?? "").toLowerCase();
      return label.includes(query);
    });
  }

  if (mode === "Fuzzy") {
    return options.filter((option) => {
      const label = (option.label ?? "").toLowerCase();
      let i = 0;
      let j = 0;
      while (i < query.length && j < label.length) {
        if (query[i] === label[j]) i++;
        j++;
      }
      return i === query.length;
    });
  }

  return options;
}

/** Options that can be included in bulk select; matches cmdk's default filter when `search` is non-empty. */
export function filterOptionsLikeCmdk<T extends { label: string; value: string | number }>(
  options: T[],
  search: string,
): T[] {
  const term = search.trim();
  if (!term) return options;
  return options.filter((o) => defaultFilter(o.label, term, []) > 0);
}

/** Merge current selection with all enabled options in `visibleOptions`, preserving selections outside that set; cap with `maxSelections`. */
export function computeSelectAllValues(
  selectedValues: (string | number)[],
  visibleOptions: { value: string | number; disabled?: boolean; disable?: boolean }[],
  maxSelections?: number | null,
): (string | number)[] {
  const visibleEnabled = visibleOptions.filter((o) => !o.disabled && !o.disable);
  const visibleKeys = new Set(visibleEnabled.map((o) => o.value.toString()));
  const outside = selectedValues.filter((v) => !visibleKeys.has(v.toString()));
  const visibleValues = visibleEnabled.map((o) => o.value);

  const combinedKeys = new Set<string>();
  const combined: (string | number)[] = [];
  const pushUnique = (v: string | number) => {
    const k = v.toString();
    if (!combinedKeys.has(k)) {
      combinedKeys.add(k);
      combined.push(v);
    }
  };
  for (const v of outside) pushUnique(v);
  for (const v of visibleValues) pushUnique(v);

  if (maxSelections != null && combined.length > maxSelections) {
    const truncated: (string | number)[] = [];
    for (const v of outside) {
      if (truncated.length >= maxSelections) break;
      truncated.push(v);
    }
    for (const v of visibleValues) {
      if (truncated.length >= maxSelections) break;
      if (!truncated.some((t) => t.toString() === v.toString())) {
        truncated.push(v);
      }
    }
    return truncated;
  }
  return combined;
}

/** Clear down to `minSelections` items (keeps the first entries in current selection order). */
export function computeClearAllValues(
  selectedValues: (string | number)[],
  minSelections?: number | null,
): (string | number)[] {
  const min = minSelections != null && minSelections > 0 ? minSelections : 0;
  if (min === 0) return [];
  return selectedValues.slice(0, min);
}
