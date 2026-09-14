import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AlertBlockquote } from "./AlertBlockquote";

describe("AlertBlockquote GitHub alert rendering", () => {
  it("renders all five alert types with their wrapper classes and titles", () => {
    const types = [
      { type: "NOTE", modifier: "pmv-alert--note", title: "Note" },
      { type: "TIP", modifier: "pmv-alert--tip", title: "Tip" },
      { type: "IMPORTANT", modifier: "pmv-alert--important", title: "Important" },
      { type: "WARNING", modifier: "pmv-alert--warning", title: "Warning" },
      { type: "CAUTION", modifier: "pmv-alert--caution", title: "Caution" },
    ];

    for (const { type, modifier, title } of types) {
      const { container } = render(
        <AlertBlockquote>
          <p>{`[!${type}] This is a ${type.toLowerCase()} message`}</p>
        </AlertBlockquote>,
      );

      const alert = container.querySelector(".pmv-alert");
      expect(alert, `${type} should render .pmv-alert`).not.toBeNull();
      expect(alert!.classList.contains(modifier), `${type} should have ${modifier}`).toBe(true);
      expect(alert!.getAttribute("role"), `${type} should have role="alert"`).toBe("alert");

      const titleElement = container.querySelector(".pmv-alert-title");
      expect(titleElement?.textContent, `${type} title should be "${title}"`).toBe(title);
    }
  });

  it("renders an icon for each alert type, with TIP differing from NOTE", () => {
    const { container: noteContainer } = render(
      <AlertBlockquote>
        <p>[!NOTE] Note message</p>
      </AlertBlockquote>,
    );
    const noteSvg = noteContainer.querySelector(".pmv-alert-header svg");
    expect(noteSvg, "NOTE should render an svg icon").not.toBeNull();
    const noteMarkup = noteSvg!.innerHTML;

    const { container: tipContainer } = render(
      <AlertBlockquote>
        <p>[!TIP] Tip message</p>
      </AlertBlockquote>,
    );
    const tipSvg = tipContainer.querySelector(".pmv-alert-header svg");
    expect(tipSvg, "TIP should render an svg icon").not.toBeNull();
    const tipMarkup = tipSvg!.innerHTML;

    expect(noteMarkup, "TIP and NOTE icons should differ").not.toBe(tipMarkup);
  });

  it("strips the alert marker and never leaks it as text", () => {
    const { container } = render(
      <AlertBlockquote>
        <p>[!NOTE] This is the body text</p>
      </AlertBlockquote>,
    );

    const content = container.querySelector(".pmv-alert-content");
    expect(content, "should render .pmv-alert-content").not.toBeNull();
    expect(content!.textContent, "should contain body text").toContain("This is the body text");
    expect(container.textContent, "should not leak the marker").not.toContain("[!NOTE]");
  });

  it("handles marker-only first paragraph", () => {
    const { container } = render(
      <AlertBlockquote>
        <p>[!WARNING]</p>
        <p>Body in second paragraph</p>
      </AlertBlockquote>,
    );

    const content = container.querySelector(".pmv-alert-content");
    expect(content, "should render .pmv-alert-content").not.toBeNull();
    expect(content!.textContent?.trim(), "should contain only the body").toBe(
      "Body in second paragraph",
    );
    // Should not have an empty leading paragraph
    const firstP = content!.querySelector("p");
    expect(firstP?.textContent?.trim(), "first paragraph should not be empty").not.toBe("");
  });

  it("preserves inline elements when stripping the marker", () => {
    const { container } = render(
      <AlertBlockquote>
        <p>
          [!TIP] Use <strong>caution</strong> when handling this
        </p>
      </AlertBlockquote>,
    );

    const content = container.querySelector(".pmv-alert-content");
    expect(content, "should render .pmv-alert-content").not.toBeNull();

    const strong = content!.querySelector("strong");
    expect(strong, "should preserve the strong element").not.toBeNull();
    expect(strong!.textContent, "should preserve strong text").toBe("caution");
    expect(content!.textContent, "should contain the full text").toContain(
      "Use caution when handling this",
    );
  });

  it("skips leading whitespace text nodes when parsing", () => {
    const { container } = render(
      <AlertBlockquote>
        {"\n"}
        <p>[!NOTE] Body text</p>
        {"\n"}
      </AlertBlockquote>,
    );

    const alert = container.querySelector(".pmv-alert");
    expect(alert, "should parse as an alert despite leading/trailing whitespace").not.toBeNull();
    expect(alert!.classList.contains("pmv-alert--note"), "should be a NOTE alert").toBe(true);

    const content = container.querySelector(".pmv-alert-content");
    expect(content?.textContent, "should contain body text").toContain("Body text");
  });

  it("renders as plain blockquote when not an alert", () => {
    // Plain quote (no marker)
    const { container: plain } = render(
      <AlertBlockquote>
        <p>Just a quote</p>
      </AlertBlockquote>,
    );
    expect(plain.querySelector(".pmv-alert"), "plain quote should not render alert").toBeNull();
    expect(
      plain.querySelector("blockquote"),
      "plain quote should render blockquote",
    ).not.toBeNull();
    expect(plain.textContent, "plain quote should contain text").toContain("Just a quote");

    // Lowercase marker (not recognized)
    const { container: lowercase } = render(
      <AlertBlockquote>
        <p>[!note] lowercase marker</p>
      </AlertBlockquote>,
    );
    expect(
      lowercase.querySelector(".pmv-alert"),
      "lowercase marker should not render alert",
    ).toBeNull();
    expect(
      lowercase.querySelector("blockquote"),
      "lowercase marker should render blockquote",
    ).not.toBeNull();

    // Unknown marker type
    const { container: unknown } = render(
      <AlertBlockquote>
        <p>[!HINT] unknown type</p>
      </AlertBlockquote>,
    );
    expect(unknown.querySelector(".pmv-alert"), "unknown type should not render alert").toBeNull();
    expect(
      unknown.querySelector("blockquote"),
      "unknown type should render blockquote",
    ).not.toBeNull();
  });
});
