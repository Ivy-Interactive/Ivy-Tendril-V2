import { describe, expect, it } from "vite-plus/test";
import { render } from "@testing-library/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Calendar } from "@/components/ui/calendar";
import { DensityProvider } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import { densityToIconButtonSize } from "@/components/ui/density-scale";

describe("Density Cascade - AlertDialog", () => {
  it("AlertDialogAction and AlertDialogCancel cascade Small density", () => {
    const { container } = render(
      <DensityProvider density={Densities.Small}>
        <AlertDialog defaultOpen>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
            <AlertDialogDescription>Description</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Action</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DensityProvider>,
    );

    const cancel = container.querySelector('[data-radix-collection-item]');
    const action = container.querySelectorAll('[data-radix-collection-item]')[1];

    expect(cancel?.className).toContain("h-7");
    expect(cancel?.className).toContain("text-xs");
    expect(action?.className).toContain("h-7");
    expect(action?.className).toContain("text-xs");
  });

  it("AlertDialogAction and AlertDialogCancel cascade Large density", () => {
    const { container } = render(
      <DensityProvider density={Densities.Large}>
        <AlertDialog defaultOpen>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
            <AlertDialogDescription>Description</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Action</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DensityProvider>,
    );

    const cancel = container.querySelector('[data-radix-collection-item]');
    const action = container.querySelectorAll('[data-radix-collection-item]')[1];

    expect(cancel?.className).toContain("h-11");
    expect(cancel?.className).toContain("text-base");
    expect(action?.className).toContain("h-11");
    expect(action?.className).toContain("text-base");
  });

  it("AlertDialogAction and AlertDialogCancel default to Medium without provider", () => {
    const { container } = render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Title</AlertDialogTitle>
          <AlertDialogDescription>Description</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Action</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const cancel = container.querySelector('[data-radix-collection-item]');
    const action = container.querySelectorAll('[data-radix-collection-item]')[1];

    expect(cancel?.className).toContain("h-9");
    expect(action?.className).toContain("h-9");
  });

  it("explicit size prop overrides density context", () => {
    const { container } = render(
      <DensityProvider density={Densities.Small}>
        <AlertDialog defaultOpen>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
            <AlertDialogDescription>Description</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogAction size="lg">Action</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DensityProvider>,
    );

    const action = container.querySelector('[data-radix-collection-item]');
    expect(action?.className).toContain("h-11");
    expect(action?.className).toContain("text-base");
  });
});

describe("Density Cascade - Pagination", () => {
  it("Pagination components cascade Small density", () => {
    const { container } = render(
      <DensityProvider density={Densities.Small}>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationLink href="#">1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationPrevious href="#" />
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </DensityProvider>,
    );

    const content = container.querySelector('ul');
    const link = container.querySelector('a');
    const previous = container.querySelectorAll('a')[1];
    const ellipsis = container.querySelector('span[aria-hidden]');

    expect(content?.className).toContain("gap-0.5");
    expect(link?.className).toContain("size-7");
    expect(previous?.className).toContain("h-7");
    expect(ellipsis?.className).toContain("size-7");
  });

  it("Pagination components cascade Large density", () => {
    const { container } = render(
      <DensityProvider density={Densities.Large}>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationLink href="#">1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#" />
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </DensityProvider>,
    );

    const content = container.querySelector('ul');
    const link = container.querySelector('a');
    const next = container.querySelectorAll('a')[1];
    const ellipsis = container.querySelector('span[aria-hidden]');

    expect(content?.className).toContain("gap-1.5");
    expect(link?.className).toContain("size-11");
    expect(next?.className).toContain("h-11");
    expect(ellipsis?.className).toContain("size-11");
  });
});

describe("Density Cascade - Calendar", () => {
  it("Calendar cascades Large density from provider", () => {
    const { container } = render(
      <DensityProvider density={Densities.Large}>
        <Calendar />
      </DensityProvider>,
    );

    const calendar = container.querySelector('[data-slot="calendar"]');
    expect(calendar?.className).toContain("[--cell-size:--spacing(10)]");
  });

  it("explicit density prop overrides provider", () => {
    const { container } = render(
      <DensityProvider density={Densities.Large}>
        <Calendar density={Densities.Small} />
      </DensityProvider>,
    );

    const calendar = container.querySelector('[data-slot="calendar"]');
    expect(calendar?.className).toContain("[--cell-size:--spacing(6)]");
  });
});

describe("densityToIconButtonSize", () => {
  it("maps Small to icon-sm", () => {
    expect(densityToIconButtonSize(Densities.Small)).toBe("icon-sm");
  });

  it("maps Medium to icon", () => {
    expect(densityToIconButtonSize(Densities.Medium)).toBe("icon");
  });

  it("maps Large to icon-lg", () => {
    expect(densityToIconButtonSize(Densities.Large)).toBe("icon-lg");
  });
});
