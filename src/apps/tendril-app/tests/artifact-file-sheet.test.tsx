import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent, waitFor, within } from "@testing-library/react";
import {
  ARTIFACT_RICH_PREVIEW_LIMIT_BYTES,
  ArtifactFileSheet,
  ArtifactThumbnail,
  artifactCodeLanguage,
  artifactDisplayPath,
  artifactPreviewKind,
  resolveArtifactLink,
} from "../src/components/ArtifactFileSheet";
import {
  resetAttachmentPreviewsForTesting,
  useAttachmentPreview,
} from "../src/hooks/useAttachmentPreview";
import { ReviewView } from "../src/views/ReviewView";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { bridge } from "../src/api/bridge";
import { planDetail, planSummary } from "./fixtures/plan.fixture";

/*
 * The opener is mocked so a test can assert which of its calls the Artifacts tab makes. `openPath`
 * is the one it must no longer make: the app's `opener:default` capability does not grant it, so in
 * the real app the old Open button was refused and did nothing.
 */
const revealItemInDir = vi.fn((_path: string) => Promise.resolve());
const openPath = vi.fn((_path: string) => Promise.resolve());
const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (path: string) => revealItemInDir(path),
  openPath: (path: string) => openPath(path),
  openUrl: (url: string) => openUrl(url),
}));

/*
 * `CodeBlock` is wrapped, not replaced, so each test can see which highlighter language the sheet
 * asked for. The highlighter itself is a lazy chunk, and whether it has arrived yet is not what
 * these tests are about.
 */
const codeBlockLanguages = vi.hoisted(() => [] as Array<string | undefined>);
vi.mock("@ivy-interactive/components/tendril", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ivy-interactive/components/tendril")>();
  const CodeBlock: typeof actual.CodeBlock = (props) => {
    codeBlockLanguages.push(props.language);
    return <actual.CodeBlock {...props} />;
  };
  return { ...actual, CodeBlock };
});

const PLAN_FOLDER = "/Users/me/.tendril/Plans/00021-BuildDesktopOperatorExperience";
const ARTIFACTS = `${PLAN_FOLDER}/Artifacts`;

beforeEach(() => {
  revealItemInDir.mockClear();
  openPath.mockClear();
  openUrl.mockClear();
  codeBlockLanguages.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAttachmentPreviewsForTesting();
});

describe("artifactPreviewKind", () => {
  it("takes the kind from the file name, not from a dotted directory above it", () => {
    expect(artifactPreviewKind(`${ARTIFACTS}/screenshots/home.PNG`)).toBe("image");
    expect(artifactPreviewKind(`${ARTIFACTS}/notes.md`)).toBe("markdown");
    expect(artifactPreviewKind(`${ARTIFACTS}/output.json`)).toBe("text");
    // A directory whose name has an image or markdown extension: the file under it is neither.
    expect(artifactPreviewKind("/tmp/shots.png/readme")).toBe("text");
    expect(artifactPreviewKind("/tmp/notes.md/LICENSE")).toBe("text");
    expect(artifactPreviewKind("C:\\Users\\me\\.tendril\\Plans\\00021\\Artifacts\\shot.webp")).toBe(
      "image",
    );
  });
});

describe("artifactCodeLanguage", () => {
  it("highlights by the file's own extension", () => {
    expect(artifactCodeLanguage(`${ARTIFACTS}/output.json`)).toBe("json");
    expect(artifactCodeLanguage(`${ARTIFACTS}/build.log`)).toBe("log");
  });

  it("leaves plain text and extensionless files unhighlighted", () => {
    expect(artifactCodeLanguage(`${ARTIFACTS}/notes.txt`)).toBeUndefined();
    // `getLanguageFromFilePath` on the whole path would answer "tendril/plans/…/license".
    expect(artifactCodeLanguage(`${ARTIFACTS}/LICENSE`)).toBeUndefined();
    expect(artifactCodeLanguage("/tmp/shots.png/readme")).toBeUndefined();
  });
});

describe("artifactDisplayPath", () => {
  it("names the file by where it sits in the plan folder", () => {
    expect(artifactDisplayPath(`${ARTIFACTS}/screenshots/home.png`, PLAN_FOLDER)).toBe(
      "Artifacts/screenshots/home.png",
    );
    expect(artifactDisplayPath(`${ARTIFACTS}/output.log`, `${PLAN_FOLDER}/`)).toBe(
      "Artifacts/output.log",
    );
    expect(
      artifactDisplayPath("C:\\Plans\\00021-Build\\Artifacts\\shot.png", "C:\\Plans\\00021-Build"),
    ).toBe("Artifacts\\shot.png");
  });

  it("keeps the whole path when the folder is unknown or is not its parent", () => {
    const path = `${ARTIFACTS}/output.log`;
    expect(artifactDisplayPath(path, undefined)).toBe(path);
    expect(artifactDisplayPath(path, "/Users/me/elsewhere")).toBe(path);
    // A sibling folder sharing the prefix is not the parent.
    expect(artifactDisplayPath(`${PLAN_FOLDER}-Old/Artifacts/a.txt`, PLAN_FOLDER)).toBe(
      `${PLAN_FOLDER}-Old/Artifacts/a.txt`,
    );
  });
});

describe("resolveArtifactLink", () => {
  const notes = `${ARTIFACTS}/notes.md`;

  it("resolves a relative link against the artifact's own folder", () => {
    expect(resolveArtifactLink(notes, "other.md")).toBe(`${ARTIFACTS}/other.md`);
    expect(resolveArtifactLink(notes, "./screenshots/home.png")).toBe(
      `${ARTIFACTS}/screenshots/home.png`,
    );
    expect(resolveArtifactLink(notes, "../plan.yaml")).toBe(`${PLAN_FOLDER}/plan.yaml`);
    expect(resolveArtifactLink(notes, "test%20results.json#summary")).toBe(
      `${ARTIFACTS}/test results.json`,
    );
  });

  it("keeps a Windows artifact's separators and never climbs above the drive", () => {
    const windowsNotes = "C:\\Plans\\00021\\Artifacts\\notes.md";
    expect(resolveArtifactLink(windowsNotes, "shots/a.png")).toBe(
      "C:\\Plans\\00021\\Artifacts\\shots\\a.png",
    );
    expect(resolveArtifactLink(windowsNotes, "../../../../../x.txt")).toBe("C:\\x.txt");
  });

  it("takes file URLs and absolute paths as they are, and names no file for a URL", () => {
    expect(resolveArtifactLink(notes, "file:///Users/me/report%201.md")).toBe(
      "/Users/me/report 1.md",
    );
    expect(resolveArtifactLink(notes, "file:///C:/Plans/a.md")).toBe("C:/Plans/a.md");
    expect(resolveArtifactLink(notes, "/etc/hosts")).toBe("/etc/hosts");
    expect(resolveArtifactLink(notes, "mailto:ops@example.com")).toBeNull();
    expect(resolveArtifactLink(notes, "?only=query")).toBeNull();
  });
});

describe("ArtifactFileSheet", () => {
  it("reads a text artifact through the plan and names it by its place in the plan", async () => {
    const path = `${ARTIFACTS}/output.log`;
    const getContent = vi
      .spyOn(bridge, "getPlanArtifactContent")
      .mockResolvedValue({ kind: "text", text: "build ok\nall 42 tests passed", size: 28 });

    render(
      <ArtifactFileSheet
        planId="00021"
        path={path}
        planFolderPath={PLAN_FOLDER}
        onClose={vi.fn()}
      />,
    );

    const sheet = await screen.findByTestId("artifact-file-sheet");
    expect(getContent).toHaveBeenCalledWith("00021", path);
    expect(within(sheet).getByRole("heading", { name: "output.log" })).toBeInTheDocument();
    // The part that tells artifacts apart is what shows; the whole path is the tooltip.
    expect(within(sheet).getByText("Artifacts/output.log")).toHaveAttribute("title", path);
    expect(await within(sheet).findByText(/all 42 tests passed/)).toBeInTheDocument();
    expect(codeBlockLanguages).toContain("log");
  });

  it("shows the whole path while the plan folder is not known", async () => {
    const path = `${ARTIFACTS}/output.log`;
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "ok",
      size: 2,
    });

    render(<ArtifactFileSheet planId="00021" path={path} onClose={vi.fn()} />);

    expect(await screen.findByText(path)).toBeInTheDocument();
  });

  it("does not highlight an extensionless file under a dotted directory", async () => {
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "MIT License",
      size: 11,
    });

    render(<ArtifactFileSheet planId="00021" path={`${ARTIFACTS}/LICENSE`} onClose={vi.fn()} />);

    expect(await screen.findByText("MIT License")).toBeInTheDocument();
    expect(codeBlockLanguages).not.toHaveLength(0);
    expect(codeBlockLanguages.every((language) => language === undefined)).toBe(true);
  });

  it("shows a large text artifact plain, so the highlighter cannot stall the app", async () => {
    const size = ARTIFACT_RICH_PREVIEW_LIMIT_BYTES + 1;
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: `{"results": [${"0,".repeat(10)}0]}`,
      size,
    });

    render(
      <ArtifactFileSheet planId="00021" path={`${ARTIFACTS}/results.json`} onClose={vi.fn()} />,
    );

    expect(await screen.findByTestId("artifact-sheet-plain-notice")).toHaveTextContent(
      "too large to highlight",
    );
    expect(screen.getByText(/"results"/)).toBeInTheDocument();
    expect(codeBlockLanguages.every((language) => language === undefined)).toBe(true);
  });

  it("highlights the same file at the limit", async () => {
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "{}",
      size: ARTIFACT_RICH_PREVIEW_LIMIT_BYTES,
    });

    render(
      <ArtifactFileSheet planId="00021" path={`${ARTIFACTS}/results.json`} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(codeBlockLanguages).toContain("json"));
    expect(screen.queryByTestId("artifact-sheet-plain-notice")).not.toBeInTheDocument();
  });

  it("renders a markdown artifact as markdown rather than as source", async () => {
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "# Release notes\n\nShipped the operator view.",
      size: 44,
    });

    render(<ArtifactFileSheet planId="00021" path={`${ARTIFACTS}/notes.md`} onClose={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Release notes" })).toBeInTheDocument();
    expect(screen.queryByText("# Release notes")).not.toBeInTheDocument();
  });

  it("shows a markdown artifact past the limit as its source", async () => {
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "# Release notes",
      size: ARTIFACT_RICH_PREVIEW_LIMIT_BYTES + 1,
    });

    render(<ArtifactFileSheet planId="00021" path={`${ARTIFACTS}/notes.md`} onClose={vi.fn()} />);

    expect(await screen.findByTestId("artifact-sheet-plain-notice")).toHaveTextContent(
      "too large to render as markdown",
    );
    expect(screen.getByText("# Release notes")).toBeInTheDocument();
  });

  it("keeps a markdown artifact's links inside the app", async () => {
    const onOpenArtifact = vi.fn();
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "See [the log](logs/output.log), [the site](https://example.com/run) and [the top](#top).",
      size: 80,
    });
    const before = window.location.href;

    render(
      <ArtifactFileSheet
        planId="00021"
        path={`${ARTIFACTS}/notes.md`}
        onClose={vi.fn()}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    // `fireEvent.click` answers false when the default was prevented: no link here may navigate
    // the webview, which is what a live relative `href` did.
    expect(fireEvent.click(await screen.findByRole("link", { name: "the log" }))).toBe(false);
    expect(onOpenArtifact).toHaveBeenCalledWith(`${ARTIFACTS}/logs/output.log`);

    expect(fireEvent.click(screen.getByRole("link", { name: "the site" }))).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/run");

    expect(fireEvent.click(screen.getByRole("link", { name: "the top" }))).toBe(false);
    expect(window.location.href).toBe(before);
    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
  });

  it("shows an image through the guarded local-file preview, without a text read", async () => {
    const path = `${ARTIFACTS}/screenshots/home.png`;
    const preview = vi
      .spyOn(bridge, "getLocalFilePreview")
      .mockResolvedValue("data:image/png;base64,AAAA");
    const getContent = vi.spyOn(bridge, "getPlanArtifactContent");

    render(<ArtifactFileSheet planId="00021" path={path} onClose={vi.fn()} />);

    const image = await screen.findByTestId("artifact-sheet-image");
    expect(image).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(image).toHaveAttribute("alt", "home.png");
    expect(preview).toHaveBeenCalledWith(path);
    expect(getContent).not.toHaveBeenCalled();
  });

  it("says why an image could not be shown", async () => {
    vi.spyOn(bridge, "getLocalFilePreview").mockRejectedValue({
      code: "NOT_FOUND",
      message: "Tendril will not serve '/x/home.png' (404 Not Found)",
      details: null,
    });

    render(
      <ArtifactFileSheet
        planId="00021"
        path={`${ARTIFACTS}/screenshots/home.png`}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("artifact-sheet-no-preview")).toHaveTextContent(
      "Tendril could not load this image: Tendril will not serve '/x/home.png' (404 Not Found)",
    );
  });

  it("never shows the previous file while the next one loads", async () => {
    const first = `${ARTIFACTS}/output.log`;
    const second = `${ARTIFACTS}/trace.log`;
    const getContent = vi
      .spyOn(bridge, "getPlanArtifactContent")
      .mockResolvedValueOnce({ kind: "text", text: "first file", size: 10 })
      .mockReturnValueOnce(new Promise(() => {}));
    const onClose = vi.fn();

    const { rerender } = render(
      <ArtifactFileSheet planId="00021" path={first} onClose={onClose} />,
    );
    expect(await screen.findByText("first file")).toBeInTheDocument();

    rerender(<ArtifactFileSheet planId="00021" path={null} onClose={onClose} />);
    rerender(<ArtifactFileSheet planId="00021" path={second} onClose={onClose} />);

    expect(await screen.findByTestId("artifact-sheet-loading")).toBeInTheDocument();
    expect(screen.queryByText("first file")).not.toBeInTheDocument();
    expect(getContent).toHaveBeenLastCalledWith("00021", second);
  });

  it("offers the folder for a file it cannot preview", async () => {
    const path = `${ARTIFACTS}/bundle.zip`;
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({ kind: "binary", size: 2048 });

    render(<ArtifactFileSheet planId="00021" path={path} onClose={vi.fn()} />);

    const callout = await screen.findByTestId("artifact-sheet-no-preview");
    expect(callout).toHaveTextContent("bundle.zip is not a text file (2.00 KB)");
    fireEvent.click(within(callout).getByRole("button", { name: "Show in folder" }));
    expect(revealItemInDir).toHaveBeenCalledWith(path);
  });

  it("says a file is too large instead of reading it", async () => {
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "tooLarge",
      size: 5 * 1024 * 1024,
    });

    render(<ArtifactFileSheet planId="00021" path={`${ARTIFACTS}/trace.log`} onClose={vi.fn()} />);

    expect(await screen.findByTestId("artifact-sheet-no-preview")).toHaveTextContent(
      "trace.log is 5.00 MB, too large to preview here.",
    );
  });

  it("reports a refused read as an error", async () => {
    vi.spyOn(bridge, "getPlanArtifactContent").mockRejectedValue({
      code: "VALIDATION_ERROR",
      message: "'/etc/hosts' is not in the plan's Artifacts folder",
      details: null,
    });

    render(<ArtifactFileSheet planId="00021" path="/etc/hosts" onClose={vi.fn()} />);

    expect(await screen.findByTestId("artifact-sheet-error")).toHaveTextContent(
      "not in the plan's Artifacts folder",
    );
  });

  it("keeps the folder one click away in the header, and surfaces a refusal", async () => {
    const path = `${ARTIFACTS}/output.json`;
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "{}",
      size: 2,
    });
    revealItemInDir.mockRejectedValueOnce(new Error("opener.reveal_item_in_dir not allowed"));

    render(<ArtifactFileSheet planId="00021" path={path} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId("artifact-sheet-reveal"));
    expect(revealItemInDir).toHaveBeenCalledWith(path);
    expect(await screen.findByTestId("artifact-sheet-action-error")).toHaveTextContent(
      "not allowed",
    );
  });

  it("renders nothing while no artifact is open", () => {
    const getContent = vi.spyOn(bridge, "getPlanArtifactContent");

    render(<ArtifactFileSheet planId="00021" path={null} onClose={vi.fn()} />);

    expect(screen.queryByTestId("artifact-file-sheet")).not.toBeInTheDocument();
    expect(getContent).not.toHaveBeenCalled();
  });
});

describe("artifact screenshot previews", () => {
  const shot = `${ARTIFACTS}/screenshots/home.png`;

  it("asks again after a failure that was not the guard's answer", async () => {
    const preview = vi
      .spyOn(bridge, "getLocalFilePreview")
      .mockRejectedValueOnce({ code: "HTTP_ERROR", message: "connection refused", details: null })
      .mockResolvedValueOnce("data:image/png;base64,AAAA");

    const first = render(<ArtifactThumbnail path={shot} onOpen={vi.fn()} />);
    expect(await screen.findByText("No preview")).toBeInTheDocument();
    first.unmount();

    render(<ArtifactThumbnail path={shot} onOpen={vi.fn()} />);
    expect(await screen.findByRole("img", { name: "home.png" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it("remembers the guard's refusal instead of asking for it again", async () => {
    const preview = vi.spyOn(bridge, "getLocalFilePreview").mockRejectedValue({
      code: "NOT_FOUND",
      message: "Tendril will not serve it (404)",
      details: null,
    });

    const first = render(<ArtifactThumbnail path={shot} onOpen={vi.fn()} />);
    expect(await screen.findByText("No preview")).toBeInTheDocument();
    first.unmount();

    render(<ArtifactThumbnail path={shot} onOpen={vi.fn()} />);
    expect(await screen.findByText("No preview")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("keeps a bounded number of previews, dropping the least recently used", async () => {
    const preview = vi
      .spyOn(bridge, "getLocalFilePreview")
      .mockImplementation(async (path) => `data:image/png;base64,${btoa(path)}`);
    const load = async (path: string) => {
      const { result, unmount } = renderHook(() => useAttachmentPreview(path, true));
      await waitFor(() => expect(result.current.url).not.toBeNull());
      unmount();
    };

    await load("/shots/0.png");
    for (let i = 1; i <= 64; i++) await load(`/shots/${i}.png`);
    expect(preview).toHaveBeenCalledTimes(65);

    // The newest is still cached; the first one read has been dropped to make room for it.
    await load("/shots/64.png");
    expect(preview).toHaveBeenCalledTimes(65);
    await load("/shots/0.png");
    expect(preview).toHaveBeenCalledTimes(66);
  });
});

describe("ReviewView Artifacts tab", () => {
  const reviewPlan = planSummary({
    id: "00021",
    title: "Build Desktop Operator Experience",
    state: "Review",
  });
  const screenshot = `${ARTIFACTS}/screenshots/home.png`;
  const log = `${ARTIFACTS}/output.log`;
  const notes = `${ARTIFACTS}/notes.md`;

  beforeEach(() => {
    sidebarListStore.resetForTesting();
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({ id: "00021", folderPath: PLAN_FOLDER }),
    );
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
    vi.spyOn(bridge, "getPlanSummary").mockResolvedValue("# Summary");
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue({
      worktrees: [],
      unassociatedCommits: [],
      unassociatedCommitRefStatus: {},
    });
    vi.spyOn(bridge, "getPlanChanges").mockResolvedValue({
      files: [],
      rawDiff: "",
      totalAdditions: 0,
      totalDeletions: 0,
    });
    vi.spyOn(bridge, "getPlanArtifacts").mockResolvedValue({
      screenshots: [screenshot],
      other: [log, notes],
    });
    vi.spyOn(bridge, "getLocalFilePreview").mockResolvedValue("data:image/png;base64,AAAA");
  });

  /** Clicks the Open button on a listed file's row. */
  async function openListed(fileName: string) {
    const tab = await screen.findByTestId("review-tab-artifacts");
    const row = (await within(tab).findByText(fileName)).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Open" }));
    return screen.findByTestId("artifact-file-sheet");
  }

  it("opens a listed file in the side sheet instead of handing it to the OS", async () => {
    const getContent = vi
      .spyOn(bridge, "getPlanArtifactContent")
      .mockResolvedValue({ kind: "text", text: "build ok", size: 8 });

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="artifacts" />);

    const sheet = await openListed("output.log");
    expect(getContent).toHaveBeenCalledWith("00021", log);
    expect(await within(sheet).findByText("build ok")).toBeInTheDocument();
    expect(await within(sheet).findByText("Artifacts/output.log")).toBeInTheDocument();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("follows a markdown artifact's link to a sibling in the same sheet", async () => {
    const getContent = vi
      .spyOn(bridge, "getPlanArtifactContent")
      .mockImplementation(async (_id, path) =>
        path === notes
          ? { kind: "text", text: "See [the log](output.log).", size: 26 }
          : { kind: "text", text: "build ok", size: 8 },
      );

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="artifacts" />);

    const sheet = await openListed("notes.md");
    fireEvent.click(await within(sheet).findByRole("link", { name: "the log" }));

    expect(await within(sheet).findByRole("heading", { name: "output.log" })).toBeInTheDocument();
    expect(await within(sheet).findByText("build ok")).toBeInTheDocument();
    expect(getContent).toHaveBeenLastCalledWith("00021", log);
  });

  it("loads screenshot tiles through the guarded preview and opens one on click", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="artifacts" />);

    const tab = await screen.findByTestId("review-tab-artifacts");
    const tile = await within(tab).findByRole("button", { name: "Open home.png" });
    // A `data:` URL, the only image source the app's CSP allows - not an `asset://` URL.
    expect(await within(tile).findByRole("img", { name: "home.png" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );

    fireEvent.click(tile);

    const sheet = await screen.findByTestId("artifact-file-sheet");
    expect(await within(sheet).findByTestId("artifact-sheet-image")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("closes the sheet when the reviewer closes it", async () => {
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "build ok",
      size: 8,
    });

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="artifacts" />);

    const sheet = await openListed("output.log");
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByTestId("artifact-file-sheet")).not.toBeInTheDocument();
    });
  });

  it("closes the sheet when the selected plan changes", async () => {
    vi.spyOn(bridge, "getPlanArtifactContent").mockResolvedValue({
      kind: "text",
      text: "build ok",
      size: 8,
    });
    // Older, so it sorts after the open plan and is not the one selected first.
    const nextPlan = planSummary({ id: "00020", title: "Older plan", state: "Review" });

    const { rerender } = render(
      <ReviewView plans={[reviewPlan, nextPlan]} onSelectPlan={() => {}} initialTab="artifacts" />,
    );
    await openListed("output.log");

    // The open plan leaves the queue, so the page moves on to the next one.
    rerender(<ReviewView plans={[nextPlan]} onSelectPlan={() => {}} initialTab="artifacts" />);

    await waitFor(() => {
      expect(screen.queryByTestId("artifact-file-sheet")).not.toBeInTheDocument();
    });
  });
});
