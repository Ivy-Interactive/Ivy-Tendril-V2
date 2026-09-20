/**
 * The composer's one measurement: whether the prompt still fits beside the buttons. It reads the
 * live textarea rather than the model, so it belongs to the DOM rather than to the conversation,
 * and `chat-composer-multiline.test.ts` drives it against a stubbed element.
 */

/** A single line of prompt text at the composer's line height, in CSS pixels. */
const SINGLE_LINE_HEIGHT = 32;

/**
 * How many lines the textarea is currently rendering, from its own metrics.
 *
 * `scrollHeight` includes the padding, so the padding comes back off before dividing by the line
 * height. Rounding matters: a line box can report a fractional height, and comparing a *total* against
 * a constant puts the single-line case exactly on the boundary — one line of 14px text with `leading-5`
 * and `py-1.5` is precisely 32px, so a half-pixel anywhere flips the composer to multiline on the first
 * character typed. Counting lines cannot land on a boundary, and does not care what the font size is.
 */
const renderedLineCount = (textarea: HTMLTextAreaElement): number => {
  const style = getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const padding =
    (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  // `line-height: normal` resolves to no number; V1's single-line total is the only thing left to
  // measure against, and its own padding is what this subtracts.
  const perLine =
    Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : SINGLE_LINE_HEIGHT - padding;
  if (perLine <= 0) return 1;
  return Math.max(1, Math.round((textarea.scrollHeight - padding) / perLine));
};

/**
 * Whether the prompt needs more than one line beside the composer's buttons. It is measured at the
 * width the textarea has inline, whichever layout is showing, so the composer does not flip back
 * and forth once the toolbar has moved above the text and widened it.
 *
 * That hysteresis is the whole reason for the temporary style swap below, and it is the part a port
 * loses first: the multiline layout is *wider*, so text that wrapped inline stops wrapping once the
 * toolbar moves above it, and a naive measurement of the live element would immediately decide one line
 * is enough and flip back. So the question is always asked at the inline width.
 */
export const needsMultipleLines = (
  textarea: HTMLTextAreaElement,
  row: HTMLElement | null,
): boolean => {
  if (!textarea.value) return false;
  if (textarea.value.includes("\n")) return true;
  // Before the composer has a width nothing can be measured; the placeholder would wrap.
  if (!row || row.clientWidth === 0) return false;
  const siblings = Array.from(row.children).filter((child) => child !== textarea) as HTMLElement[];
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const inlineWidth =
    row.clientWidth -
    siblings.reduce((sum, child) => sum + child.offsetWidth, 0) -
    gap * siblings.length;
  if (inlineWidth <= 0) return false;
  const previous = {
    flex: textarea.style.flex,
    width: textarea.style.width,
    height: textarea.style.height,
  };
  textarea.style.flex = "0 0 auto";
  textarea.style.width = `${Math.max(inlineWidth, 0)}px`;
  textarea.style.height = "auto";
  const wraps = renderedLineCount(textarea) > 1;
  textarea.style.flex = previous.flex;
  textarea.style.width = previous.width;
  textarea.style.height = previous.height;
  return wraps;
};
