import type { Meta, StoryObj } from "@storybook/react";
import { Rocket } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { Densities } from "@/types/density";

const meta: Meta<typeof Callout> = {
  title: "UI/Callout",
  component: Callout,
};

export default meta;
type Story = StoryObj<typeof Callout>;

export const AllVariants: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col gap-4">
      <Callout variant="info" title="Tunnel Starting">
        The tunnel is being provisioned and will be reachable shortly.
      </Callout>
      <Callout variant="success" title="Plan Completed">
        All verifications passed and the pull request was merged.
      </Callout>
      <Callout variant="warning" title="Uncommitted Changes">
        The worktree still has modified files.
      </Callout>
      <Callout variant="error" title="Commits At Risk">
        Two commits exist only on this machine.
      </Callout>
      <Callout variant="neutral" title="Nothing To Do">
        No plans are waiting for review.
      </Callout>
      <Callout variant="info">A callout with no title renders its body alone.</Callout>
    </div>
  ),
};

export const SemanticShorthand: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col gap-4">
      <Callout.Info title="Tunnel Starting">Reads like the legacy factory call site.</Callout.Info>
      <Callout.Success title="Plan Completed">All verifications passed.</Callout.Success>
      <Callout.Warning title="Uncommitted Changes">The worktree is dirty.</Callout.Warning>
      <Callout.Error title="Commits At Risk">Two commits are unpushed.</Callout.Error>
      <Callout.Neutral title="Nothing To Do">No plans are waiting.</Callout.Neutral>
    </div>
  ),
};

export const WithDismiss: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col gap-4">
      <Callout variant="warning" title="Uncommitted Changes" onDismiss={() => {}}>
        The dismiss button notifies the caller, which unmounts the callout.
      </Callout>
      <Callout variant="error" onDismiss={() => {}} dismissLabel="Close error">
        A custom dismiss label names the button for assistive tech.
      </Callout>
    </div>
  ),
};

export const CustomIcon: Story = {
  render: () => (
    <div className="w-[560px]">
      <Callout variant="success" title="Deployed" icon={<Rocket size={24} />}>
        Any node can replace the per-variant default icon.
      </Callout>
    </div>
  ),
};

export const NoIcon: Story = {
  render: () => (
    <div className="w-[560px]">
      <Callout variant="neutral" title="Icon Suppressed" icon={false}>
        Passing <code>icon={"{false}"}</code> renders no icon at all.
      </Callout>
    </div>
  ),
};

export const CalloutDensities: Story = {
  name: "Densities",
  render: () => (
    <div className="flex w-[560px] flex-col gap-4">
      <Callout variant="info" density={Densities.Small} title="Small">
        Tighter padding, 20px icon.
      </Callout>
      <Callout variant="info" density={Densities.Medium} title="Medium">
        Default padding, 24px icon.
      </Callout>
      <Callout variant="info" density={Densities.Large} title="Large">
        Roomy padding, 28px icon.
      </Callout>
    </div>
  ),
};

export const RichBody: Story = {
  render: () => (
    <div className="w-[560px]">
      <Callout variant="error" title="Commits At Risk">
        <p className="mb-2">The following commits exist only on this machine:</p>
        <ul className="list-inside list-disc">
          <li>
            <code>a1b2c3d</code> — Add settings app
          </li>
          <li>
            <code>d4e5f6a</code> — Fix lint errors
          </li>
        </ul>
        <p className="mt-2">
          See the{" "}
          <a className="underline" href="https://git-scm.com/docs/git-push">
            git push documentation
          </a>
          .
        </p>
      </Callout>
    </div>
  ),
};
