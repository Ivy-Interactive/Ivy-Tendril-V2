/**
 * Ambient type declarations for dist/tendril.mjs imports in tests.
 * Resolves static imports when dist/ has not yet been built, allowing vp check and
 * type-aware linting to pass on clean checkouts.
 */
declare module "*/dist/tendril.mjs" {
  export * from "@/tendril.ts";
}

declare module "../dist/tendril.mjs" {
  export * from "@/tendril.ts";
}
