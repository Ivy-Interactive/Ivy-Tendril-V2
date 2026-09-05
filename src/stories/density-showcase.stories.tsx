import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DensityProvider, DensityScale } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import { CopyToClipboardButton } from "@/components/CopyToClipboardButton";

const meta: Meta = {
  title: "Density/Showcase",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

export const AllComponents: Story = {
  render: () => (
    <div className="space-y-12">
      <div>
        <h3 className="text-lg font-semibold mb-4">Small Density</h3>
        <DensityProvider density={Densities.Small}>
          <div className="flex flex-wrap items-center gap-4 p-4 border rounded-lg bg-card">
            <Button>Button</Button>
            <Button variant="outline">Outline</Button>
            <Input placeholder="Input field" className="w-48" />
            <Badge>Badge</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <div className="flex items-center gap-2">
              <Checkbox id="small-check" />
              <Label htmlFor="small-check">Checkbox</Label>
            </div>
            <Select>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="option1">Option 1</SelectItem>
                <SelectItem value="option2">Option 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DensityProvider>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Medium Density (Default)</h3>
        <DensityProvider density={Densities.Medium}>
          <div className="flex flex-wrap items-center gap-4 p-4 border rounded-lg bg-card">
            <Button>Button</Button>
            <Button variant="outline">Outline</Button>
            <Input placeholder="Input field" className="w-48" />
            <Badge>Badge</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <div className="flex items-center gap-2">
              <Checkbox id="medium-check" />
              <Label htmlFor="medium-check">Checkbox</Label>
            </div>
            <Select>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="option1">Option 1</SelectItem>
                <SelectItem value="option2">Option 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DensityProvider>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Large Density</h3>
        <DensityProvider density={Densities.Large}>
          <div className="flex flex-wrap items-center gap-4 p-4 border rounded-lg bg-card">
            <Button>Button</Button>
            <Button variant="outline">Outline</Button>
            <Input placeholder="Input field" className="w-48" />
            <Badge>Badge</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <div className="flex items-center gap-2">
              <Checkbox id="large-check" />
              <Label htmlFor="large-check">Checkbox</Label>
            </div>
            <Select>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="option1">Option 1</SelectItem>
                <SelectItem value="option2">Option 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DensityProvider>
      </div>
    </div>
  ),
};

export const ButtonComparison: Story = {
  render: () => (
    <div className="space-y-8">
      <DensityProvider density={Densities.Small}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Small</h4>
          <div className="flex gap-4">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
        </div>
      </DensityProvider>
      <DensityProvider density={Densities.Medium}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Medium</h4>
          <div className="flex gap-4">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
        </div>
      </DensityProvider>
      <DensityProvider density={Densities.Large}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Large</h4>
          <div className="flex gap-4">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
        </div>
      </DensityProvider>
    </div>
  ),
};

export const FormElementsComparison: Story = {
  render: () => (
    <div className="space-y-8">
      <DensityProvider density={Densities.Small}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Small</h4>
          <div className="space-y-3 max-w-md">
            <div className="space-y-1">
              <Label htmlFor="name-small">Name</Label>
              <Input id="name-small" placeholder="Enter your name" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="terms-small" />
              <Label htmlFor="terms-small">Accept terms and conditions</Label>
            </div>
          </div>
        </div>
      </DensityProvider>
      <DensityProvider density={Densities.Medium}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Medium</h4>
          <div className="space-y-3 max-w-md">
            <div className="space-y-1">
              <Label htmlFor="name-medium">Name</Label>
              <Input id="name-medium" placeholder="Enter your name" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="terms-medium" />
              <Label htmlFor="terms-medium">Accept terms and conditions</Label>
            </div>
          </div>
        </div>
      </DensityProvider>
      <DensityProvider density={Densities.Large}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Large</h4>
          <div className="space-y-3 max-w-md">
            <div className="space-y-1">
              <Label htmlFor="name-large">Name</Label>
              <Input id="name-large" placeholder="Enter your name" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="terms-large" />
              <Label htmlFor="terms-large">Accept terms and conditions</Label>
            </div>
          </div>
        </div>
      </DensityProvider>
    </div>
  ),
};

export const ContextCascade: Story = {
  render: () => (
    <div className="space-y-8">
      <DensityProvider density={Densities.Small}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Small Density (via Context)</h4>
          <div className="flex gap-4 items-center">
            <CopyToClipboardButton textToCopy="Hello Small" />
            <DensityScale className="p-2 border rounded">
              <span>Text in Small density</span>
            </DensityScale>
          </div>
        </div>
      </DensityProvider>
      <DensityProvider density={Densities.Medium}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Medium Density (via Context)</h4>
          <div className="flex gap-4 items-center">
            <CopyToClipboardButton textToCopy="Hello Medium" />
            <DensityScale className="p-2 border rounded">
              <span>Text in Medium density</span>
            </DensityScale>
          </div>
        </div>
      </DensityProvider>
      <DensityProvider density={Densities.Large}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Large Density (via Context)</h4>
          <div className="flex gap-4 items-center">
            <CopyToClipboardButton textToCopy="Hello Large" />
            <DensityScale className="p-2 border rounded">
              <span>Text in Large density</span>
            </DensityScale>
          </div>
        </div>
      </DensityProvider>
    </div>
  ),
};
