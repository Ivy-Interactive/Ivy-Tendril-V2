/**
 * V1 sets a dialog's width inline, with `.Width(Size.Rem(n))` on the `Dialog` widget, and its
 * dialogs only ever use three of them. `default` is the width Ivy gives a dialog that passes no
 * `.Width(...)` at all, which several of V1's confirm dialogs rely on.
 *
 * Ported rather than re-picked, per the parity contract: `UxHelper` holds only `SheetWidth` (the
 * responsive width of V1's *sheets*, which V2 has no counterpart for yet), so these numbers come
 * from the `Dialog` call sites themselves.
 *
 * `sm:` only, and `!` because `DialogContent` carries its own `max-w-xl`: below `sm` the shell
 * already pins the dialog to the viewport with `max-sm:!max-w-[calc(100%-2rem)]`, so overriding
 * the width there would push it off a phone screen.
 */
export const DIALOG_WIDTH = {
  /** Ivy's own dialog width, for a V1 `Dialog` with no `.Width(...)`. */
  default: undefined,
  /** `Size.Rem(30)`: Create Issue, Create PR, Update Plan, Request Changes, Create Plan. */
  rem30: "sm:!max-w-[30rem]",
  /** `Size.Rem(32)`: the guard dialogs, and Update Plan from the app preview. */
  rem32: "sm:!max-w-[32rem]",
  /** `Size.Rem(40)`: Delete Plan, and the SyncRepo policy dialog. */
  rem40: "sm:!max-w-[40rem]",
  /** `Size.Px(560)`: the shell's plan search dialog, the one call site given in px rather than rem. */
  px560: "sm:!max-w-[560px]",
} as const;

export type DialogWidth = keyof typeof DIALOG_WIDTH;
