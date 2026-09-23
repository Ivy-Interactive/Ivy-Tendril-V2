import { render, act } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { ErrorSheet } from "../src/components/Sheets/ErrorSheet";
import { showError } from "../src/hooks/use-error-sheet";

describe("ErrorSheet", () => {
  it("renders open sheet when error is dispatched via showError", async () => {
    render(<ErrorSheet />);

    act(() => {
      showError({
        title: "DatabaseError",
        message: "Connection failed",
      });
    });

    expect(document.body.textContent).toContain("Oops! Something went wrong");
    expect(document.body.textContent).toContain("DatabaseError");
    expect(document.body.textContent).toContain("Connection failed");
  });
});
