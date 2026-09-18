## Tailwind support

A large precompiled Tailwind v4 sheet ships inside the CLI. The common surface is present: the full spacing scale for `p/m/gap/space/w/h/inset`, `grid-cols-1..12` and `col-span-*`, flex and alignment, `text-xs..9xl`, font weights, radii, borders, shadows, `overflow-*`, positioning, `z-*`, `opacity-*`, and the `sm: md: lg: xl:` and `hover: focus: active: disabled:` variants.

**Arbitrary values like `w-[347px]` are NOT generated**: the sheet is compiled ahead of time, so a class it does not contain silently does nothing. For one-off values use an inline style or the component's own size prop:

```tsx
<div style={{ width: 347 }} />        // instead of className="w-[347px]"
<Card width="20rem" />                // components take sizes directly
```

If a project genuinely needs arbitrary values, it can be set up with `tendril wireframe setup <path> --tailwind jit`, which downloads the real Tailwind CLI (~107 MB, once) and generates whatever the source asks for. Assume that is NOT on unless you see a `wireframe.json` saying so.

Theme colours are available as `bg-`/`text-`/`border-` utilities: `ink`, `ink-muted`, `ink-faint`, `paper`, `paper-raised`, `paper-sunken`, `highlight`, `accent`, `success`, `warning`, `destructive`, `info`. Prefer these over raw Tailwind palette colours so the wireframe stays monochrome.

### Colour values

Props that take a colour (`color`, `background`, `foreground`, `stroke`, `fill`, `borderColor`) accept any of three things:

```tsx
<Box background="paper-sunken" />   // a theme token, as listed above
<Badge color="Destructive" />        // an Ivy palette name, PascalCase
<Box background="#efe9dd" />         // any CSS colour
```

Note the `bg-` prefix belongs to the *class* form only: `background="bg-paper-sunken"` is not a colour. An unrecognised value falls back to the default and warns in the browser console rather than rendering.

