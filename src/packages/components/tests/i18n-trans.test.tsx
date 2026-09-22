import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { parseMarkup } from "../src/i18n/markup";
import { createTranslation } from "../src/i18n/react";
import { i18nStore } from "../src/i18n/runtime";

/**
 * `<Trans>`: a sentence with markup in it stays one string for the translator, with named tags the
 * `components` prop fills in. A fixture namespace keeps these strings out of the real catalogs.
 */

const english = {
  docs: "Read the <link>docs</link> first.",
  summary: "<strong>{{count}} files</strong> changed in <code>{{repo}}</code>.",
  lines: "One<br/>Two",
  named: "Hello, <strong>{{name}}</strong>!",
  items_one: "<strong>{{count}}</strong> item",
  items_other: "<strong>{{count}}</strong> items",
  unmapped: "Press <kbd>Enter</kbd> to send.",
  unclosed: "a <strong>b",
  stray: "a </strong> b",
  crossed: "<strong>a <i>b</strong> c</i>",
  comparison: "5 < 6 and 7 > 3",
  lookalike: "Run <code>git branch recover/<name> <hash></code> to restore.",
  lookalikeFixed: "Run <code>{{command}}</code> to restore.",
  greeting: "Hi",
};

type Resources = { testTrans: typeof english; testTransOther: { title: string } };
const { Trans } = createTranslation<Resources>();

beforeAll(() => {
  i18nStore.addResourceBundle("en", "testTrans", english);
  i18nStore.addResourceBundle("de", "testTrans", {
    greeting: "Hallo",
    docs: "Lies zuerst die <link>Doku</link>.",
  });
  i18nStore.addResourceBundle("en", "testTransOther", { title: "Elsewhere" });
});

afterEach(async () => {
  i18nStore.setMissingKeyHandler("throw");
  await act(async () => {
    await i18nStore.changeLanguage("en");
  });
});

describe("<Trans>", () => {
  it("clones the component a tag names, keeping its props and giving it the translated text", () => {
    const { container } = render(
      <Trans
        ns="testTrans"
        i18nKey="docs"
        components={{ link: <a href="https://tendril.dev/docs" className="docs-link" /> }}
      />,
    );
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://tendril.dev/docs");
    expect(link).toHaveClass("docs-link");
    expect(container).toHaveTextContent("Read the docs first.");
  });

  it("interpolates variables inside and around tags, and renders the basic tags as themselves", () => {
    const { container } = render(
      <Trans
        ns="testTrans"
        i18nKey="summary"
        count={3}
        values={{ repo: "Ivy-Tendril" }}
        components={{ code: <code className="font-mono" /> }}
      />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("3 files");
    expect(container.querySelector("code.font-mono")).toHaveTextContent("Ivy-Tendril");
    expect(container).toHaveTextContent("3 files changed in Ivy-Tendril.");
  });

  it("renders a self-closing <br/>", () => {
    const { container } = render(<Trans ns="testTrans" i18nKey="lines" />);
    expect(container.innerHTML).toBe("One<br>Two");
  });

  it("selects the plural form from count", () => {
    const { container, rerender } = render(<Trans ns="testTrans" i18nKey="items" count={1} />);
    expect(container.innerHTML).toBe("<strong>1</strong> item");
    rerender(<Trans ns="testTrans" i18nKey="items" count={4} />);
    expect(container.innerHTML).toBe("<strong>4</strong> items");
  });

  it("never parses a value as markup", () => {
    const { container } = render(
      <Trans ns="testTrans" i18nKey="named" values={{ name: "<link>x</link>" }} />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("strong")).toHaveTextContent("<link>x</link>");
  });

  it("accepts a qualified key from another namespace", () => {
    const { container } = render(<Trans ns="testTrans" i18nKey="testTransOther:title" />);
    expect(container).toHaveTextContent("Elsewhere");
  });

  it("reports a tag it has no component for, and renders its content alone", () => {
    expect(() => render(<Trans ns="testTrans" i18nKey="unmapped" />)).toThrow(
      '[i18n] "testTrans:unmapped" contains <kbd>, but no component was passed for it',
    );

    const handler = vi.fn();
    i18nStore.setMissingKeyHandler(handler);
    const { container } = render(<Trans ns="testTrans" i18nKey="unmapped" />);
    expect(container.innerHTML).toBe("Press Enter to send.");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tag",
        namespace: "testTrans",
        key: "unmapped",
        name: "kbd",
      }),
    );
  });

  it("degrades malformed markup to text instead of failing, and reports each unpaired tag", () => {
    const handler = vi.fn();
    i18nStore.setMissingKeyHandler(handler);
    const view = (key: "unclosed" | "stray" | "crossed" | "comparison") =>
      render(<Trans ns="testTrans" i18nKey={key} />).container;

    expect(view("unclosed").innerHTML).toBe("a &lt;strong&gt;b");
    expect(view("stray").innerHTML).toBe("a &lt;/strong&gt; b");
    expect(view("comparison").textContent).toBe("5 < 6 and 7 > 3");
    // `</strong>` cannot close across the open `<i>`, so it stays text; `<i>` then closes normally and
    // the `<strong>` that never closed is unwound into literal text around its content.
    expect(view("crossed").innerHTML).toBe("&lt;strong&gt;a <i>b&lt;/strong&gt; c</i>");

    const reported = handler.mock.calls.map(([missing]) => [
      missing.kind,
      missing.key,
      missing.name,
    ]);
    expect(reported).toEqual([
      ["markup", "unclosed", "<strong>"],
      ["markup", "stray", "</strong>"],
      ["markup", "crossed", "</strong> <strong>"],
    ]);
  });

  it("fails a test on text that only looks like a tag, which belongs in a variable", () => {
    // Every tag after `<code>` is unpaired, so the sentence would ship with its markup showing.
    expect(() =>
      render(<Trans ns="testTrans" i18nKey="lookalike" components={{ code: <code /> }} />),
    ).toThrow(
      '[i18n] "testTrans:lookalike" has unpaired tags, which render as text: ' +
        "</code> <hash> <name> <code>. Pass text that only looks like a tag as a {{variable}}",
    );

    const { container } = render(
      <Trans
        ns="testTrans"
        i18nKey="lookalikeFixed"
        values={{ command: "git branch recover/<name> <hash>" }}
        components={{ code: <code /> }}
      />,
    );
    expect(container.querySelector("code")).toHaveTextContent("git branch recover/<name> <hash>");
    expect(container).toHaveTextContent("Run git branch recover/<name> <hash> to restore.");
  });

  it("reports a missing key, and renders the key when the handler lets it", () => {
    expect(() => render(<Trans ns="testTrans" i18nKey={"nope" as never} />)).toThrow(
      '[i18n] "testTrans:nope" is not in the English catalog',
    );
    i18nStore.setMissingKeyHandler("ignore");
    const { container } = render(<Trans ns="testTrans" i18nKey={"nope" as never} />);
    expect(container.textContent).toBe("nope");
  });

  it("re-renders in the new language when it changes", async () => {
    const { container } = render(
      <Trans ns="testTrans" i18nKey="docs" components={{ link: <a href="#docs" /> }} />,
    );
    expect(container).toHaveTextContent("Read the docs first.");
    await act(async () => {
      await i18nStore.changeLanguage("de");
    });
    expect(container).toHaveTextContent("Lies zuerst die Doku.");
    expect(screen.getByRole("link", { name: "Doku" })).toHaveAttribute("href", "#docs");
  });
});

describe("parseMarkup", () => {
  const nodesOf = (source: string) => parseMarkup(source).nodes;

  it("reads named, nested and self-closing tags", () => {
    expect(parseMarkup("a <b>c <i>d</i></b><br/>e")).toEqual({
      nodes: [
        { type: "text", text: "a " },
        {
          type: "element",
          name: "b",
          children: [
            { type: "text", text: "c " },
            { type: "element", name: "i", children: [{ type: "text", text: "d" }] },
          ],
        },
        { type: "element", name: "br", children: [] },
        { type: "text", text: "e" },
      ],
      unpaired: [],
    });
  });

  it("keeps a string without markup as a single text node", () => {
    expect(nodesOf("Plain {{text}}")).toEqual([{ type: "text", text: "Plain {{text}}" }]);
    expect(nodesOf("")).toEqual([]);
  });

  it("treats attributes and numbered tags as text, since strings carry named tags only", () => {
    expect(nodesOf('<a href="x">y</a>')).toEqual([{ type: "text", text: '<a href="x">y</a>' }]);
    expect(nodesOf("<0>zero</0>")).toEqual([{ type: "text", text: "<0>zero</0>" }]);
  });

  it("unwinds unclosed tags innermost first, keeping their content in place", () => {
    expect(parseMarkup("<a>x<b>y<c/>")).toEqual({
      nodes: [
        { type: "text", text: "<a>x<b>y" },
        { type: "element", name: "c", children: [] },
      ],
      unpaired: ["<b>", "<a>"],
    });
  });

  it("lists a closing tag with nothing open, and a self-closing closing tag, as unpaired", () => {
    expect(parseMarkup("a</b> c</d/>").unpaired).toEqual(["</b>", "</d/>"]);
  });
});
