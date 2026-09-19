import React from "react";

interface NoContentViewProps {
  title: string;
  description: string;
  /**
   * V1's `cta`, appended below the description when there is one. For Plans and Review that is the
   * process wallpaper (`Hooks/UseTendrilProcess.cs`); the other apps pass nothing, which is a
   * decision rather than an omission - see {@link TendrilProcessWallpaper}.
   */
  cta?: React.ReactNode;
  "data-testid"?: string;
}

/**
 * `Apps/Views/NoContentView.cs`, the empty presentation every V1 app reaches when it has nothing to
 * show:
 *
 * ```csharp
 * var layout = Layout.Vertical().AlignContent(Align.Center).Height(Size.Full()).Padding(8)
 *              | Text.H3(title)
 *              | Text.Muted(description);
 * if (cta is not null) layout |= cta;
 * ```
 *
 * Every class here is that composition and nothing else. `Layout.Vertical()` defaults to a gap of 4
 * (`StackLayoutWidget`'s `rowGap = 4`), `AlignContent(Align.Center)` on a vertical stack is
 * `items-center justify-center` at full width (framework `getAlign`), `Height(Size.Full())` is
 * `h-full`, and `Text.H3`/`Text.Muted` are the framework's `typography.h3`
 * (`text-2xl font-medium scroll-m-20 pb-1`) and `typography.muted` (`text-base text-muted-foreground`).
 *
 * There is deliberately no card, no border and no icon: V1 draws none, and the only artwork in its
 * empty states is the `cta` a caller passes in.
 */
export const NoContentView: React.FC<NoContentViewProps> = ({
  title,
  description,
  cta,
  "data-testid": testId = "no-content-view",
}) => (
  <div
    data-testid={testId}
    className="flex h-full w-full flex-col items-center justify-center gap-4 p-8"
  >
    <h3 className="scroll-m-20 pb-1 text-2xl font-medium text-foreground">{title}</h3>
    <p className="text-base text-muted-foreground">{description}</p>
    {cta}
  </div>
);
