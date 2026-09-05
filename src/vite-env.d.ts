/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom/vitest" />

import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface Assertion<R = void, T = any> extends TestingLibraryMatchers<any, T> {}
}

declare module "*.css" {
  const content: string;
  export default content;
}
