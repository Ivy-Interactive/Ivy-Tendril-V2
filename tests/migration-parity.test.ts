import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Migration Parity Matrix", () => {
  const matrixPath = path.resolve(__dirname, "../docs/migration/parity-matrix.md");

  it("exists and is readable", () => {
    expect(fs.existsSync(matrixPath)).toBe(true);
  });

  it("contains no empty cells and has valid status values", () => {
    const content = fs.readFileSync(matrixPath, "utf-8");
    const lines = content.split("\n");

    // Find table rows
    const tableLines = lines.filter(
      (line) => line.trim().startsWith("|") && line.trim().endsWith("|")
    );

    expect(tableLines.length).toBeGreaterThan(15); // Header + separator + at least 14 rows

    // Skip header and separator
    const dataRows = tableLines.slice(2);

    expect(dataRows.length).toBeGreaterThanOrEqual(14);

    const allowedStatusRegex = /^(Verified|Gap \(plan \d{5}\)|Deferred \(approved\))$/;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      // No empty cells allowed
      for (let j = 0; j < cells.length; j++) {
        expect(
          cells[j],
          `Row ${i + 1}, column ${j + 1} must not be empty in parity-matrix.md`
        ).not.toBe("");
      }

      // Status column is the last column
      const statusCell = cells[cells.length - 1];
      expect(
        statusCell,
        `Row ${i + 1} status '${statusCell}' must match allowed values: 'Verified', 'Gap (plan NNNNN)', or 'Deferred (approved)'`
      ).toMatch(allowedStatusRegex);

      // If Gap, must cite a plan id
      if (statusCell.startsWith("Gap")) {
        expect(statusCell).toMatch(/Gap \(plan \d{5}\)/);
      }
    }
  });

  it("covers all required functional areas", () => {
    const content = fs.readFileSync(matrixPath, "utf-8");
    const requiredAreas = [
      "Chat sessions and persistence",
      "Chat execution and streaming",
      "Question blocks",
      "Projects",
      "Plans list, detail, revisions",
      "Jobs and logs",
      "Dependencies and blocking",
      "Recommendations",
      "Verification state",
      "Review, retry, PR, cancel actions",
      "Settings",
      "History and costs",
      "Realtime events",
      "Peripherals",
      "Promptware",
    ];

    for (const area of requiredAreas) {
      expect(
        content.toLowerCase(),
        `Parity matrix must cover '${area}'`
      ).toContain(area.toLowerCase());
    }
  });
});
