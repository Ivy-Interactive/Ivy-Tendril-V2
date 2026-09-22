import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "../src/components/LanguageSwitcher";
import { SITE_LOCALES } from "../src/config/locales.config";

describe("LanguageSwitcher component", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/docs/concepts/plans#states");
  });

  it("renders trigger button displaying the active locale native label and globe icon", () => {
    render(<LanguageSwitcher route="/docs/concepts/plans" hash="#states" />);
    const trigger = screen.getByRole("button", { name: "Choose language" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("English");
  });

  it("displays the correct active locale label when route has a locale prefix", () => {
    render(<LanguageSwitcher route="/de/docs/concepts/plans" hash="#states" />);
    const trigger = screen.getByRole("button", { name: "Sprache wählen" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Deutsch");
  });

  it("opens dropdown menu displaying all 10 locales on trigger click", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher route="/docs/concepts/plans" />);

    const trigger = screen.getByRole("button", { name: "Choose language" });
    await user.click(trigger);

    const menu = screen.getByRole("menu");
    for (const locale of SITE_LOCALES) {
      expect(within(menu).getByText(locale.label)).toBeInTheDocument();
    }
  });

  it("marks current active locale with aria-current", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher route="/de/docs/concepts/plans" />);

    const trigger = screen.getByRole("button", { name: "Sprache wählen" });
    await user.click(trigger);

    const menu = screen.getByRole("menu");
    const deOption = within(menu).getByText("Deutsch").closest("[role='menuitem']");
    expect(deOption).toHaveAttribute("aria-current", "true");

    const enOption = within(menu).getByText("English").closest("[role='menuitem']");
    expect(enOption).not.toHaveAttribute("aria-current");
  });

  it("computes target URL strictly preserving page path and hash fragment", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<LanguageSwitcher route="/docs/concepts/plans" hash="#states" onSelect={onSelect} />);

    const trigger = screen.getByRole("button", { name: "Choose language" });
    await user.click(trigger);

    const deLink = screen.getByRole("link", { name: "Deutsch" });
    expect(deLink).toHaveAttribute("href", "/de/docs/concepts/plans#states");

    await user.click(deLink);
    expect(onSelect).toHaveBeenCalledWith("/de/docs/concepts/plans#states", "de");
  });

  it("preserves path and hash when switching from prefixed locale back to English", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <LanguageSwitcher route="/ja/docs/concepts/plans" hash="#architecture" onSelect={onSelect} />,
    );

    const trigger = screen.getByRole("button", { name: "言語を選択" });
    await user.click(trigger);

    const enLink = screen.getByRole("link", { name: "English" });
    expect(enLink).toHaveAttribute("href", "/docs/concepts/plans#architecture");

    await user.click(enLink);
    expect(onSelect).toHaveBeenCalledWith("/docs/concepts/plans#architecture", "en");
  });

  it("preserves path and hash when switching between two non-English locales", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<LanguageSwitcher route="/de/docs/concepts/plans" hash="#step-1" onSelect={onSelect} />);

    const trigger = screen.getByRole("button", { name: "Sprache wählen" });
    await user.click(trigger);

    const zhLink = screen.getByRole("link", { name: "简体中文" });
    expect(zhLink).toHaveAttribute("href", "/zh/docs/concepts/plans#step-1");

    await user.click(zhLink);
    expect(onSelect).toHaveBeenCalledWith("/zh/docs/concepts/plans#step-1", "zh");
  });
});
