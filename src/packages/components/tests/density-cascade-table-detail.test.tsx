import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  Table,
  TableHead,
  TableCell,
  TableRow,
  TableBody,
  TableHeader,
} from "@/components/ui/table";
import { Details, DetailItem } from "@/components/ui/detail";
import { DensityProvider } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import { useTableScale } from "@/components/ui/table/useTableSize";
import { useDetailDensity } from "@/components/ui/detail/useDetailDensity";

describe("Density cascade: Table and Details", () => {
  /* Cell padding is `px-*` + `py-*` rather than one `p-*`: only the vertical half sets row height, and
     it was halved relative to the horizontal to give shorter rows. The subject of these tests is the
     density *cascade* — provider, default, prop override — so they assert the resolved pair. */
  describe("Table", () => {
    it("respects DensityProvider Small", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Header</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Cell</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DensityProvider>,
      );

      const table = container.querySelector("table");
      const thead = container.querySelector("thead th");
      const cell = container.querySelector("tbody td");

      expect(table?.className).toContain("text-xs");
      expect(thead?.className).toContain("h-8");
      expect(cell?.className).toContain("px-1");
      expect(cell?.className).toContain("py-0");
    });

    it("respects DensityProvider Large", () => {
      const { container } = render(
        <DensityProvider density={Densities.Large}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Header</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Cell</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DensityProvider>,
      );

      const table = container.querySelector("table");
      const thead = container.querySelector("thead th");
      const cell = container.querySelector("tbody td");

      expect(table?.className).toContain("text-base");
      expect(thead?.className).toContain("h-12");
      expect(cell?.className).toContain("px-3");
      expect(cell?.className).toContain("py-1");
    });

    it("defaults to Medium without provider", () => {
      const { container } = render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Header</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );

      const table = container.querySelector("table");
      const thead = container.querySelector("thead th");
      const cell = container.querySelector("tbody td");

      expect(table?.className).toContain("text-sm");
      expect(thead?.className).toContain("h-10");
      expect(cell?.className).toContain("px-2");
      expect(cell?.className).toContain("py-0.5");
    });

    it("Table prop overrides DensityProvider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <Table density={Densities.Large}>
            <TableHeader>
              <TableRow>
                <TableHead>Header</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Cell</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DensityProvider>,
      );

      const table = container.querySelector("table");
      const thead = container.querySelector("thead th");
      const cell = container.querySelector("tbody td");

      expect(table?.className).toContain("text-base");
      expect(thead?.className).toContain("h-12");
      expect(cell?.className).toContain("px-3");
      expect(cell?.className).toContain("py-1");
    });

    it("TableHead prop overrides all outer densities", () => {
      const { container } = render(
        <DensityProvider density={Densities.Medium}>
          <Table density={Densities.Large}>
            <TableHeader>
              <TableRow>
                <TableHead density={Densities.Small}>Header</TableHead>
              </TableRow>
            </TableHeader>
          </Table>
        </DensityProvider>,
      );

      const thead = container.querySelector("thead th");
      expect(thead?.className).toContain("h-8");
    });
  });

  describe("Details", () => {
    it("respects DensityProvider Small", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <Details>
            <DetailItem label="Label">Value</DetailItem>
          </Details>
        </DensityProvider>,
      );

      const itemWrapper = container.querySelector(".border-b");
      const label = itemWrapper?.querySelector("div:first-child");
      expect(label?.className).toContain("text-xs");
      expect(label?.className).toContain("p-2");
    });

    it("respects DensityProvider Large", () => {
      const { container } = render(
        <DensityProvider density={Densities.Large}>
          <Details>
            <DetailItem label="Label">Value</DetailItem>
          </Details>
        </DensityProvider>,
      );

      const itemWrapper = container.querySelector(".border-b");
      const label = itemWrapper?.querySelector("div:first-child");
      expect(label?.className).toContain("text-base");
      expect(label?.className).toContain("p-4");
    });

    it("defaults to Medium without provider", () => {
      const { container } = render(
        <Details>
          <DetailItem label="Label">Value</DetailItem>
        </Details>,
      );

      const itemWrapper = container.querySelector(".border-b");
      const label = itemWrapper?.querySelector("div:first-child");
      expect(label?.className).toContain("text-sm");
      expect(label?.className).toContain("p-3");
    });

    it("Details prop overrides DensityProvider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Large}>
          <Details density={Densities.Small}>
            <DetailItem label="Label">Value</DetailItem>
          </Details>
        </DensityProvider>,
      );

      const itemWrapper = container.querySelector(".border-b");
      const label = itemWrapper?.querySelector("div:first-child");
      expect(label?.className).toContain("text-xs");
      expect(label?.className).toContain("p-2");
    });

    it("DetailItem prop overrides Details density", () => {
      const { container } = render(
        <Details density={Densities.Small}>
          <DetailItem label="Label" density={Densities.Large}>
            Value
          </DetailItem>
        </Details>,
      );

      const itemWrapper = container.querySelector(".border-b");
      const label = itemWrapper?.querySelector("div:first-child");
      expect(label?.className).toContain("text-base");
      expect(label?.className).toContain("p-4");
    });

    it("Details wrapper carries the density text class from DensityProvider (Small)", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <Details>
            <DetailItem label="Label">Value</DetailItem>
          </Details>
        </DensityProvider>,
      );

      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain("text-xs");
    });

    it("Details wrapper carries the density text class from DensityProvider (Large)", () => {
      const { container } = render(
        <DensityProvider density={Densities.Large}>
          <Details>
            <DetailItem label="Label">Value</DetailItem>
          </Details>
        </DensityProvider>,
      );

      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain("text-base");
    });

    it("Details wrapper defaults to text-sm without provider", () => {
      const { container } = render(
        <Details>
          <DetailItem label="Label">Value</DetailItem>
        </Details>,
      );

      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain("text-sm");
    });

    it("Details density prop overrides DensityProvider on the wrapper", () => {
      const { container } = render(
        <DensityProvider density={Densities.Large}>
          <Details density={Densities.Small}>
            <DetailItem label="Label">Value</DetailItem>
          </Details>
        </DensityProvider>,
      );

      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain("text-xs");
      expect(wrapper?.className).not.toContain("text-base");
    });

    it("consumer className text size still wins on the Details wrapper", () => {
      const { container } = render(
        <Details className="text-lg">
          <DetailItem label="Label">Value</DetailItem>
        </Details>,
      );

      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain("text-lg");
      expect(wrapper?.className).not.toContain("text-sm");
    });
  });

  describe("Hooks rendered standalone", () => {
    it("useTableScale falls through to DensityProvider", () => {
      function TestComponent() {
        const density = useTableScale();
        return <div data-density={density}>Test</div>;
      }

      const { container } = render(
        <DensityProvider density={Densities.Large}>
          <TestComponent />
        </DensityProvider>,
      );

      const div = container.querySelector("div");
      expect(div?.getAttribute("data-density")).toBe(Densities.Large);
    });

    it("useDetailDensity falls through to DensityProvider", () => {
      function TestComponent() {
        const density = useDetailDensity();
        return <div data-density={density}>Test</div>;
      }

      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <TestComponent />
        </DensityProvider>,
      );

      const div = container.querySelector("div");
      expect(div?.getAttribute("data-density")).toBe(Densities.Small);
    });
  });
});
