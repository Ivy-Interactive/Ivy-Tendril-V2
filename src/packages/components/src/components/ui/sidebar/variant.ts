import { cva } from "class-variance-authority";

export const sidebarMenuButtonVariant = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden group-data-[collapsible=icon]:overflow-visible rounded-md p-2 text-left text-sm outline-none ring-ring transition-[width,height,padding] hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 active:bg-secondary active:text-secondary-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground data-[active=true]:font-medium data-[state=open]:hover:bg-secondary/60 data-[state=open]:hover:text-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "hover:bg-secondary/60 hover:text-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--border)] hover:bg-secondary/60 hover:text-foreground hover:shadow-[0_0_0_1px_var(--secondary)]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
