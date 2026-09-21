import type { Meta, StoryObj } from "@storybook/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const meta: Meta<typeof Avatar> = {
  title: "UI/Avatar",
  component: Avatar,
};

export default meta;

// A local data URI instead of a remote URL, so the story never depends on network availability.
const sampleAvatarSrc =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%236366f1'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%23e0e7ff'/%3E%3Cpath d='M12 58c0-11 9-20 20-20s20 9 20 20' fill='%23e0e7ff'/%3E%3C/svg%3E";

export const Default: StoryObj<typeof Avatar> = {
  render: () => (
    <div className="flex gap-4">
      <Avatar>
        <AvatarImage src={sampleAvatarSrc} alt="Sample avatar" />
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
    </div>
  ),
};
