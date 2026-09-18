/**
 * The table's filter, as one expression a user types.
 *
 * ## What this is a port of
 *
 * The Ivy Framework's DataTable has exactly one filter affordance and it is not per-column: a single
 * control at the **top-left of the toolbar** (`widgets/dataTables/DataTableWidget.tsx` renders
 * `DataTableOption(icon: FilterIcon)` as the first child of the header's left group) which expands
 * inline into an expression editor (`options/DataTableFilterOption.tsx`). The text is parsed into the
 * recursive `Filter`/`FilterGroup`/`Condition` tree of `datatable.proto` and evaluated **server-side**
 * (`Views/DataTables/QueryProcessor.cs`). It commits on **Enter** — never per keystroke — and carries a
 * `Clear` button on its right edge while non-empty. There are no per-column filter widgets anywhere in
 * the framework's grid: `column.filterable` decides whether a column may appear in *this* expression.
 *
 * V1's Jobs table is that default, unmodified: `c.AllowFiltering = true`, `c.ShowSearch = false`
 * (`Apps/Jobs/JobsApp.DataTable.cs:86-94`), with `.Filterable(t => t.Id, false)` and the same for
 * `ErrorContext` — so eleven columns are filterable and one expression narrows the table by any of
 * them.
 *
 * ## What is ported and what is not
 *
 * The **grammar, the commit discipline and the placement** are ported. The **editor** is not: the
 * framework's is a CodeMirror language mode over a generated ANTLR parser, and the parity contract's
 * rule is to reuse what exists rather than import a grammar. So the control is a plain input and this
 * module is the parser — a recursive-descent reading of the same expression language, producing the
 * same [`RemoteTableFilter`] tree the daemon already validates and executes.
 *
 * The vocabulary is the framework's autocomplete list
 * (`lib/filter-query-editor/components/extensions/autocomplete.ts`) — `=`, `!=`, `contains`,
 * `starts with`, `ends with`, `IS BLANK`, `IS NOT BLANK`, combined with `AND`/`OR` — plus the three the
 * proto has always had and the editor cannot type: `IN (…)` (the daemon's `inSet`, one indexed `IN`
 * rather than a tree of ORed equalities), the numeric comparisons, and parentheses with `NOT`. An
 * expression can therefore say `OR` *across* columns, which a control per column never could.
 *
 * Nothing here evaluates anything. The filter goes to the daemon; see `column-filters.ts`
 * [`matchesColumnFilters`] for the client-side reading of the same semantics, which exists for a table
 * whose rows the client already holds.
 */

import type {
  RemoteTableFilter,
  RemoteTableFilterArg,
  RemoteTableFilterFunction,
} from "./remote-query";
import { allOf, anyOf, not, whereColumn } from "./remote-query";
import type { DataTableColumn } from "./types";

/** One filterable column, as the parser and the editor's help text see it. */
export interface FilterExpressionColumn {
  /** `column.name` — the table's own key. */
  name: string;
  /** What a user types: `column.header ?? column.name`. */
  label: string;
  /** What goes on the wire: `column.filter.column ?? column.name`. */
  column: string;
  /** Further stored columns holding the same fact, matched as an OR beside `column`. */
  alsoColumns?: readonly string[];
}

/** The columns an expression may name, in declaration order. */
export function filterExpressionColumns<TRow>(
  columns: readonly DataTableColumn<TRow>[],
): FilterExpressionColumn[] {
  return columns
    .filter((column) => Boolean(column.filter))
    .map((column) => ({
      name: column.name,
      label: column.header ?? column.name,
      column: column.filter?.column ?? column.name,
      alsoColumns: column.filter?.alsoColumns,
    }));
}

/**
 * An example built from the table's own columns, for the editor's placeholder.
 *
 * The framework's placeholder is generated the same way, from the first filterable column, because a
 * generic one (`"filter…"`) teaches nobody the syntax.
 */
export function filterExpressionPlaceholder<TRow>(
  columns: readonly DataTableColumn<TRow>[],
): string {
  const first = filterExpressionColumns(columns)[0];
  if (!first) return "No filterable columns";
  return `[${first.label}] contains "…"`;
}

/**
 * Worked examples for the help popover, built from the table's **own** filterable columns.
 *
 * Not a fixed list. A hardcoded set named the Jobs table's columns, so it was wrong on every other
 * table — and wrong on Jobs too, since one of its examples used a column that was not filterable and
 * therefore did not parse. Teaching the syntax with an expression the table rejects is worse than
 * teaching none.
 */
export function filterExpressionExamples<TRow>(
  columns: readonly DataTableColumn<TRow>[],
): string[] {
  const filterable = columns.filter((column) => Boolean(column.filter));
  if (filterable.length === 0) return [];

  const label = (column: DataTableColumn<TRow>) => `[${column.header ?? column.name}]`;
  const withOptions = filterable.find((column) => (column.filter?.options ?? []).length > 0);
  const plain = filterable.find((column) => column !== withOptions) ?? filterable[0];
  const examples: string[] = [];

  if (withOptions) {
    const values = (withOptions.filter?.options ?? []).map((option) => option.value);
    examples.push(`${label(withOptions)} = "${values[0]}"`);
    if (values.length > 1) {
      examples.push(`${label(withOptions)} in ("${values[0]}", "${values[1]}")`);
    }
  }
  examples.push(`${label(plain)} contains "…"`);
  if (withOptions && plain !== withOptions) {
    examples.push(
      `${label(plain)} contains "…" AND ${label(withOptions)} != ` +
        `"${(withOptions.filter?.options ?? [])[0]?.value ?? "…"}"`,
    );
  }
  examples.push(`${label(plain)} is blank`);
  return examples;
}

/** A parse either produced a filter or failed with a reason to show the user. */
export type FilterExpressionResult =
  | { filter: RemoteTableFilter | null; error?: undefined }
  | { filter: null; error: string };

interface Token {
  kind: "name" | "word" | "string" | "number" | "symbol";
  text: string;
  /** 0-based offset, so a message can point at the offending text. */
  at: number;
}

class ParseError extends Error {}

const SYMBOLS = ["<=", ">=", "!=", "<>", "==", "=", "<", ">", "(", ")", ","];

/** Case-, space-, underscore- and dash-insensitive form, matching the daemon's own column matching. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .filter((character) => /[a-z0-9]/.test(character))
    .join("");
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    // `[Status Message]` — the framework's own column syntax, and the only way to name a column whose
    // header has a space in it.
    if (character === "[") {
      const end = text.indexOf("]", index + 1);
      if (end === -1) {
        throw new ParseError(`Unclosed '[' at position ${index + 1}.`);
      }
      tokens.push({ kind: "name", text: text.slice(index + 1, end).trim(), at: index });
      index = end + 1;
      continue;
    }

    if (character === '"' || character === "'") {
      let value = "";
      let cursor = index + 1;
      let closed = false;
      while (cursor < text.length) {
        if (text[cursor] === "\\" && cursor + 1 < text.length) {
          value += text[cursor + 1];
          cursor += 2;
          continue;
        }
        if (text[cursor] === character) {
          closed = true;
          cursor += 1;
          break;
        }
        value += text[cursor];
        cursor += 1;
      }
      if (!closed) {
        throw new ParseError(`Unclosed quote at position ${index + 1}.`);
      }
      tokens.push({ kind: "string", text: value, at: index });
      index = cursor;
      continue;
    }

    const symbol = SYMBOLS.find((candidate) => text.startsWith(candidate, index));
    if (symbol) {
      tokens.push({ kind: "symbol", text: symbol, at: index });
      index += symbol.length;
      continue;
    }

    const number = /^-?\d+(\.\d+)?/.exec(text.slice(index));
    if (number) {
      tokens.push({ kind: "number", text: number[0], at: index });
      index += number[0].length;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(index));
    if (word) {
      tokens.push({ kind: "word", text: word[0], at: index });
      index += word[0].length;
      continue;
    }

    throw new ParseError(`Unexpected '${character}' at position ${index + 1}.`);
  }

  return tokens;
}

/** Recursive descent over the token list. One instance per parse; it owns the cursor. */
class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly columns: FilterExpressionColumn[],
  ) {}

  parse(): RemoteTableFilter | null {
    if (this.tokens.length === 0) return null;
    const filter = this.parseOr();
    const extra = this.peek();
    if (extra) {
      throw new ParseError(
        `Unexpected '${extra.text}' at position ${extra.at + 1}. Join conditions with AND or OR.`,
      );
    }
    return filter;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new ParseError("The expression ends before it is complete.");
    this.index += 1;
    return token;
  }

  /** Consumes `word` if it is next, case-insensitively. */
  private takeWord(word: string): boolean {
    const token = this.peek();
    if (token?.kind === "word" && token.text.toLowerCase() === word) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private takeSymbol(symbol: string): boolean {
    const token = this.peek();
    if (token?.kind === "symbol" && token.text === symbol) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private parseOr(): RemoteTableFilter {
    const filters = [this.parseAnd()];
    while (this.takeWord("or")) {
      filters.push(this.parseAnd());
    }
    // `anyOf` of one is that one, so a single condition never gets a wrapper group.
    return anyOf(...filters) as RemoteTableFilter;
  }

  private parseAnd(): RemoteTableFilter {
    const filters = [this.parseUnary()];
    while (this.takeWord("and")) {
      filters.push(this.parseUnary());
    }
    return allOf(...filters) as RemoteTableFilter;
  }

  private parseUnary(): RemoteTableFilter {
    // `NOT` here is negation of the operand that follows. `not contains` / `not in` are operators and
    // are handled after a column name, where they cannot be confused with this.
    if (this.takeWord("not")) {
      return not(this.parseUnary()) as RemoteTableFilter;
    }
    if (this.takeSymbol("(")) {
      const inner = this.parseOr();
      if (!this.takeSymbol(")")) {
        throw new ParseError("Unclosed '(' — every group needs a matching ')'.");
      }
      return inner;
    }
    return this.parseCondition();
  }

  private parseCondition(): RemoteTableFilter {
    const token = this.next();
    if (token.kind !== "name" && token.kind !== "word") {
      throw new ParseError(
        `Expected a column name at position ${token.at + 1}, found '${token.text}'.`,
      );
    }
    const column = this.resolveColumn(token);
    const { fn, args } = this.parseOperator(token);
    const targets = [column.column, ...(column.alsoColumns ?? [])];
    // `anyOf` of one is that one, so a column with no `alsoColumns` emits exactly what it always did.
    return anyOf(...targets.map((target) => whereColumn(target, fn, args))) as RemoteTableFilter;
  }

  private resolveColumn(token: Token): FilterExpressionColumn {
    const wanted = normalize(token.text);
    const match = this.columns.find(
      (column) =>
        normalize(column.label) === wanted ||
        normalize(column.name) === wanted ||
        normalize(column.column) === wanted,
    );
    if (match) return match;

    const names = this.columns.map((column) => `[${column.label}]`).join(", ");
    throw new ParseError(
      this.columns.length === 0
        ? `No column can be filtered on this table.`
        : `Unknown column '${token.text}'. Filterable: ${names}.`,
    );
  }

  private parseOperator(columnToken: Token): {
    fn: RemoteTableFilterFunction;
    args: RemoteTableFilterArg[];
  } {
    const token = this.peek();
    if (!token) {
      throw new ParseError(
        `'${columnToken.text}' needs a comparison, e.g. = "value" or contains "value".`,
      );
    }

    if (token.kind === "symbol") {
      const comparisons: Record<string, RemoteTableFilterFunction> = {
        "=": "equals",
        "==": "equals",
        "!=": "notEquals",
        "<>": "notEquals",
        ">": "greaterThan",
        ">=": "greaterThanOrEqual",
        "<": "lessThan",
        "<=": "lessThanOrEqual",
      };
      const fn = comparisons[token.text];
      if (!fn) {
        throw new ParseError(`Unexpected '${token.text}' at position ${token.at + 1}.`);
      }
      this.index += 1;
      return { fn, args: [this.parseValue()] };
    }

    const word = token.text.toLowerCase();
    this.index += 1;

    switch (word) {
      case "contains":
        return { fn: "contains", args: [this.parseValue()] };
      case "in":
        return { fn: "inSet", args: this.parseValueList() };
      // The word forms of the symbol operators. V1's grammar accepts all of these
      // (`Filters.g4` / `ASTBuilder`), and its editor offered `equals` first for every column it
      // recognised a type for, so an operator who learned the syntax there types `equals` — which
      // was a hard parse error here, and one whose message did not even mention the word.
      case "equals":
      case "equal":
        return { fn: "equals", args: [this.parseValue()] };
      case "greater":
        this.expectWord("than", "greater");
        return this.takeWord("or")
          ? (this.expectWord("equal", "greater than or"),
            { fn: "greaterThanOrEqual", args: [this.parseValue()] })
          : { fn: "greaterThan", args: [this.parseValue()] };
      case "less":
        this.expectWord("than", "less");
        return this.takeWord("or")
          ? (this.expectWord("equal", "less than or"),
            { fn: "lessThanOrEqual", args: [this.parseValue()] })
          : { fn: "lessThan", args: [this.parseValue()] };
      case "starts":
        this.expectWord("with", "starts");
        return { fn: "startsWith", args: [this.parseValue()] };
      case "ends":
        this.expectWord("with", "ends");
        return { fn: "endsWith", args: [this.parseValue()] };
      case "not": {
        if (this.takeWord("contains")) return { fn: "notContains", args: [this.parseValue()] };
        if (this.takeWord("in")) return { fn: "notInSet", args: this.parseValueList() };
        if (this.takeWord("equals") || this.takeWord("equal")) {
          return { fn: "notEquals", args: [this.parseValue()] };
        }
        throw new ParseError("After 'not' expected 'contains', 'in' or 'equals'.");
      }
      case "is": {
        const negated = this.takeWord("not");
        if (this.takeWord("blank") || this.takeWord("empty")) {
          return { fn: negated ? "notBlank" : "blank", args: [] };
        }
        if (this.takeWord("null")) {
          return { fn: negated ? "isNotNull" : "isNull", args: [] };
        }
        throw new ParseError("After 'is' expected 'blank', 'not blank', 'null' or 'not null'.");
      }
      default:
        throw new ParseError(
          `Unknown comparison '${token.text}' at position ${token.at + 1}. Use =, !=, >, <, ` +
            `equals, not equals, greater than, less than, contains, starts with, ends with, ` +
            `in (…), is blank or is not blank.`,
        );
    }
  }

  private expectWord(word: string, after: string): void {
    if (!this.takeWord(word)) {
      throw new ParseError(`After '${after}' expected '${word}'.`);
    }
  }

  private parseValue(): RemoteTableFilterArg {
    const token = this.next();
    if (token.kind === "string") return token.text;
    if (token.kind === "number") return Number(token.text);
    if (token.kind === "word") {
      const word = token.text.toLowerCase();
      if (word === "true") return true;
      if (word === "false") return false;
      if (word === "null") return null;
    }
    throw new ParseError(
      `Expected a quoted value at position ${token.at + 1}, e.g. "Running". Found '${token.text}'.`,
    );
  }

  private parseValueList(): RemoteTableFilterArg[] {
    if (!this.takeSymbol("(")) {
      throw new ParseError(`'in' takes a list: in ("Running", "Queued").`);
    }
    const args: RemoteTableFilterArg[] = [this.parseValue()];
    while (this.takeSymbol(",")) {
      args.push(this.parseValue());
    }
    if (!this.takeSymbol(")")) {
      throw new ParseError(`Unclosed '(' in an 'in' list.`);
    }
    return args;
  }
}

/**
 * One expression as the wire filter, or the reason it could not be read.
 *
 * An empty (or whitespace-only) expression is `{ filter: null }` — *no constraint*, never "matches
 * nothing". That distinction is the same one [`allOf`] is careful about, and it is what makes clearing
 * the box restore the whole table.
 *
 * A failure is a message, not a throw: the editor keeps the text the user typed and shows the reason
 * beside it, which is the only way to fix a typo without retyping the expression.
 */
export function parseFilterExpression<TRow>(
  columns: readonly DataTableColumn<TRow>[],
  text: string,
): FilterExpressionResult {
  try {
    const parser = new Parser(tokenize(text.trim()), filterExpressionColumns(columns));
    return { filter: parser.parse() };
  } catch (error) {
    if (error instanceof ParseError) return { filter: null, error: error.message };
    throw error;
  }
}
