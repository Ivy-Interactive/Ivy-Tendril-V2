import type { Meta, StoryObj } from "@storybook/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
import { Button } from "@/components/ui/button";

const meta: Meta = {
  title: "Density/Variant Callers",
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj;

export const AllDensities: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      {[Densities.Small, Densities.Medium, Densities.Large].map((density) => (
        <DensityProvider key={density} density={density}>
          <div className="space-y-6 border rounded-lg p-6">
            <h2 className="text-lg font-semibold">
              {density === Densities.Small
                ? "Small Density"
                : density === Densities.Medium
                  ? "Medium Density"
                  : "Large Density"}
            </h2>

            <div className="space-y-4">
              <h3 className="text-sm font-medium">AlertDialog</h3>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">Open AlertDialog</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete your account and
                      remove your data from our servers.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction>Continue</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium">Pagination</h3>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">1</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#" isActive>
                      2
                    </PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">3</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext href="#" />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium">Calendar</h3>
              <Calendar mode="single" />
            </div>
          </div>
        </DensityProvider>
      ))}
    </div>
  ),
};

export const AlertDialogOnly: Story = {
  render: () => (
    <div className="flex gap-4">
      <DensityProvider density={Densities.Small}>
        <AlertDialog defaultOpen>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Small Density</AlertDialogTitle>
              <AlertDialogDescription>
                Small density alert dialog with h-7 buttons.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DensityProvider>
    </div>
  ),
};

export const PaginationOnly: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm mb-2">Small Density</p>
        <DensityProvider density={Densities.Small}>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">3</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </DensityProvider>
      </div>

      <div>
        <p className="text-sm mb-2">Large Density</p>
        <DensityProvider density={Densities.Large}>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">3</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </DensityProvider>
      </div>
    </div>
  ),
};

export const CalendarOnly: Story = {
  render: () => (
    <div className="flex gap-6">
      <div>
        <p className="text-sm mb-2">Small Density</p>
        <DensityProvider density={Densities.Small}>
          <Calendar mode="single" />
        </DensityProvider>
      </div>

      <div>
        <p className="text-sm mb-2">Large Density</p>
        <DensityProvider density={Densities.Large}>
          <Calendar mode="single" />
        </DensityProvider>
      </div>
    </div>
  ),
};
