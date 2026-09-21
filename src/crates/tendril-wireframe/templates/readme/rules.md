## Rules that are easy to get wrong

1. **Keep `SketchProvider` and the `tendril` class.** `src/main.tsx` wraps the app in `<SketchProvider>` and a `<div className="tendril">`. The provider mounts the SVG filters; the class applies the handwriting font and ink colour. Remove either and the components render, but not as a wireframe.

2. **Keep the `signalWireframeReady()` call** in `src/main.tsx`. It tells `screenshot` when the sketch has finished drawing. Without it captures fall back to a heuristic and may catch a half-drawn frame.

3. **Props are named enums, not booleans plus classes.** Write `variant="Destructive"`, `density="Small"`, `borderRadius="Full"`: PascalCase values, exactly as listed below. `variant="destructive"` is not the same thing and will not match.

4. **Sizes** accept CSS lengths (`"20rem"`), fractions (`"1/2"`) and bare numbers, which mean quarter-rem steps, so `width={4}` is `1rem`.

5. **Only these imports resolve.** There is no package manager here:

   ```tsx
   import { ... } from "tendril-wireframes";
   import { useState } from "react";
   import { createRoot } from "react-dom/client";
   import { Rocket } from "lucide-react";   // or just icon="Rocket"
   ```

   Importing anything else fails the build with a clear message. There is no charting library to reach for; the chart components below draw themselves.

6. **Structural layout is plain CSS.** Tendril covers what is worth drawing by hand; flexbox and grid already say the rest with less. Use `TabsLayout`, `SidebarLayout`, `ResizablePanelGroup` and `FloatingPanel` for drawn chrome, and `div` + utilities for everything else.

7. **A wireframe is throwaway.** It exists to show a person what will be built and to guide whoever builds it, never to ship. Keep the `@tendril-wireframe plan-only` line that `setup` puts at the top of each file, and add it to any file you create. Never copy a wireframe's files, components or imports into product code: Tendril refuses a plan's changes when they turn up there.

8. **Use relative URLs for your own files.** Write `<img src="logo.png">`, not `/logo.png`. A plan preview serves the wireframe under its own address, where a root-relative URL points somewhere else.

