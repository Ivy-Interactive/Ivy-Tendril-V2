import { useEffect, useState } from "react";
import { getRehypeKatex, subscribeToRehypeKatex } from "@/lib/math";

/**
 * Re-renders the calling component once `rehype-katex` has loaded.
 *
 * `getMarkdownPlugins` (see `src/lib/math.ts`) loads KaTeX on demand, because a static import of it
 * puts 259 kB of maths typesetting into the initial load of every app that reaches this package's
 * `tendril` barrel. A rehype plugin has to be in the list synchronously when react-markdown builds
 * its processor, so the first render of a document containing `$$...$$` gets a plugin list without
 * KaTeX and shows the TeX source. Nothing in React knows the import has resolved, so without this
 * hook that first render is also the last one and the maths never appears.
 *
 * Call it unconditionally at the top of any component that renders markdown through
 * `getMarkdownPlugins`. It subscribes but never triggers a load: the trigger is content-gated inside
 * `getMarkdownPlugins`, which is the only place that knows whether the markdown actually has maths in
 * it. Mounting a markdown component therefore does not fetch KaTeX.
 *
 * The returned boolean exists to be used as a `useMemo` dependency, so a memoised plugin list is
 * rebuilt when the plugin arrives rather than staying pinned to the mathless first result.
 */
export const useMathReady = (): boolean => {
  const [ready, setReady] = useState(() => getRehypeKatex() !== null);

  useEffect(() => {
    if (ready) return;
    return subscribeToRehypeKatex(() => setReady(true));
  }, [ready]);

  return ready;
};
