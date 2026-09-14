import * as React from "react";
import { Ellipsis } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { densityToButtonSize, densityToIconButtonSize } from "@/components/ui/density-scale";
import { useDensity } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import { toolbarGroupVariant, toolbarSeparatorVariant, toolbarVariant } from "./toolbar-variant";

export type ToolbarOrientation = "horizontal" | "vertical";
export type ToolbarOverflow = "menu" | "wrap" | "scroll";

/** Marks a focusable toolbar item for the root's roving tabindex. */
const ITEM_ATTR = "data-toolbar-item";
/** Marks the `leading` / `trailing` wrappers, whose contents are excluded from navigation. */
const SLOT_ATTR = "data-toolbar-slot";

interface ToolbarContextValue {
  density: Densities;
  orientation: ToolbarOrientation;
  disabled: boolean;
}

const ToolbarContext = React.createContext<ToolbarContextValue>({
  density: Densities.Medium,
  orientation: "horizontal",
  disabled: false,
});

export function useToolbarContext(): ToolbarContextValue {
  return React.useContext(ToolbarContext);
}

export interface ToolbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "aria-label"> {
  /** Required: a `role="toolbar"` without an accessible name is an axe violation. */
  "aria-label": string;
  orientation?: ToolbarOrientation;
  density?: Densities;
  disabled?: boolean;
  /** Rendered outside the item flow and excluded from arrow-key navigation. */
  leading?: React.ReactNode;
  /** Rendered outside the item flow and excluded from arrow-key navigation. */
  trailing?: React.ReactNode;
  overflow?: ToolbarOverflow;
  /**
   * Caps the visible item count directly, overriding the `ResizeObserver` measurement. jsdom
   * reports every width as `0`, so this is the deterministic seam for testing `overflow="menu"`.
   */
  maxVisibleItems?: number;
}

interface ToolbarItemLikeProps {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  tooltip?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  "aria-label"?: string;
  children?: React.ReactNode;
}

function isSeparatorElement(child: React.ReactElement): boolean {
  return child.type === ToolbarSeparator;
}

function isItemElement(child: React.ReactElement): boolean {
  return child.type === ToolbarButton || child.type === ToolbarToggleButton;
}

/** Flattens a child (including nested groups) into the button-like props the overflow menu needs. */
function collectOverflowItems(child: React.ReactNode): ToolbarItemLikeProps[] {
  if (!React.isValidElement(child)) return [];
  const props = child.props as ToolbarItemLikeProps;
  if (isSeparatorElement(child)) return [];
  if (isItemElement(child)) return [props];
  if (props.children === undefined) return [];
  return React.Children.toArray(props.children).flatMap(collectOverflowItems);
}

interface SplitChildren {
  visible: React.ReactElement[];
  overflowed: React.ReactElement[];
}

function splitChildren(children: React.ReactElement[], cap: number | undefined): SplitChildren {
  if (cap === undefined || cap < 0) return { visible: children, overflowed: [] };

  const visible: React.ReactElement[] = [];
  const overflowed: React.ReactElement[] = [];
  let itemCount = 0;

  for (const child of children) {
    if (isSeparatorElement(child)) {
      // A separator adjacent to a moved item collapses rather than leaving a stray divider.
      if (overflowed.length === 0) visible.push(child);
      continue;
    }
    if (itemCount < cap) {
      visible.push(child);
      itemCount += 1;
    } else {
      overflowed.push(child);
    }
  }

  while (visible.length > 0 && isSeparatorElement(visible[visible.length - 1])) {
    visible.pop();
  }

  return { visible, overflowed };
}

function navigableItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${ITEM_ATTR}]`)).filter(
    (el) => el.closest(`[${SLOT_ATTR}]`) === null,
  );
}

const Toolbar = React.forwardRef<HTMLDivElement, ToolbarProps>(
  (
    {
      className,
      children,
      orientation = "horizontal",
      density,
      disabled = false,
      leading,
      trailing,
      overflow = "menu",
      maxVisibleItems,
      onKeyDown,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    const contextDensity = useDensity();
    const effectiveDensity = density ?? contextDensity;

    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const setRootRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const [activeIndex, setActiveIndex] = React.useState(0);
    const [measuredCap, setMeasuredCap] = React.useState<number | undefined>(undefined);
    const cap = overflow === "menu" ? (maxVisibleItems ?? measuredCap) : undefined;

    const childElements = React.useMemo(
      () => React.Children.toArray(children).filter(React.isValidElement),
      [children],
    );
    const { visible, overflowed } = React.useMemo(
      () => splitChildren(childElements, cap),
      [childElements, cap],
    );
    const overflowItems = React.useMemo(
      () => overflowed.flatMap(collectOverflowItems),
      [overflowed],
    );

    // Roving tabindex: exactly one item is tabbable, so the toolbar is a single tab stop.
    React.useEffect(() => {
      const node = rootRef.current;
      if (!node) return;
      const items = navigableItems(node);
      const enabled = items.filter((el) => el.getAttribute("data-disabled") !== "true");
      for (const el of items) el.setAttribute("tabindex", "-1");
      const active = enabled[activeIndex < enabled.length ? activeIndex : 0];
      active?.setAttribute("tabindex", "0");
    });

    // Runtime overflow measurement. jsdom reports 0 widths, which resolves to "everything fits".
    React.useEffect(() => {
      if (overflow !== "menu" || maxVisibleItems !== undefined) return;
      const node = rootRef.current;
      if (!node || typeof ResizeObserver === "undefined") return;

      const measure = () => {
        const available = orientation === "vertical" ? node.clientHeight : node.clientWidth;
        const items = navigableItems(node).filter(
          (el) => el.getAttribute("data-toolbar-overflow-trigger") !== "true",
        );
        if (available === 0 || items.length === 0) {
          setMeasuredCap(undefined);
          return;
        }
        let used = 0;
        let fits = 0;
        for (const el of items) {
          used += orientation === "vertical" ? el.offsetHeight : el.offsetWidth;
          if (used > available) break;
          fits += 1;
        }
        setMeasuredCap(fits >= items.length ? undefined : fits);
      };

      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, [overflow, maxVisibleItems, orientation, children]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      const node = rootRef.current;
      if (!node) return;

      const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
      const prevKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
      const items = navigableItems(node).filter(
        (el) => el.getAttribute("data-disabled") !== "true",
      );
      if (items.length === 0) return;

      const focused = items.indexOf(document.activeElement as HTMLElement);
      const from = focused === -1 ? Math.min(activeIndex, items.length - 1) : focused;

      let next: number | undefined;
      if (event.key === nextKey) next = (from + 1) % items.length;
      else if (event.key === prevKey) next = (from - 1 + items.length) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      if (next === undefined) return;

      event.preventDefault();
      setActiveIndex(next);
      items[next].focus();
    };

    const contextValue = React.useMemo<ToolbarContextValue>(
      () => ({ density: effectiveDensity, orientation, disabled }),
      [effectiveDensity, orientation, disabled],
    );

    return (
      <ToolbarContext.Provider value={contextValue}>
        <TooltipProvider>
          <div
            ref={setRootRef}
            role="toolbar"
            aria-label={ariaLabel}
            aria-orientation={orientation}
            aria-disabled={disabled}
            data-density={effectiveDensity.toLowerCase()}
            onKeyDown={handleKeyDown}
            className={cn(
              toolbarVariant({ density: effectiveDensity, orientation }),
              overflow === "wrap" && "flex-wrap",
              overflow === "scroll" &&
                (orientation === "vertical" ? "overflow-y-auto" : "overflow-x-auto"),
              disabled && "pointer-events-none opacity-50",
              className,
            )}
            {...props}
          >
            {leading !== undefined && (
              <div data-toolbar-slot="leading" className="mr-auto flex items-center">
                {leading}
              </div>
            )}
            {visible}
            {overflowItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size={densityToIconButtonSize(effectiveDensity)}
                    aria-label="More actions"
                    data-toolbar-item=""
                    data-toolbar-overflow-trigger="true"
                  >
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {overflowItems.map((item, index) => (
                    <DropdownMenuItem
                      key={index}
                      disabled={item.disabled}
                      onSelect={() =>
                        item.onClick?.({} as React.MouseEvent<HTMLButtonElement, MouseEvent>)
                      }
                    >
                      {item.icon}
                      <span>{item.label ?? item.tooltip ?? item["aria-label"]}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {trailing !== undefined && (
              <div data-toolbar-slot="trailing" className="ml-auto flex items-center">
                {trailing}
              </div>
            )}
          </div>
        </TooltipProvider>
      </ToolbarContext.Provider>
    );
  },
);
Toolbar.displayName = "Toolbar";

export interface ToolbarGroupProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "aria-label"
> {
  "aria-label": string;
  density?: Densities;
  orientation?: ToolbarOrientation;
}

const ToolbarGroup = React.forwardRef<HTMLDivElement, ToolbarGroupProps>(
  ({ className, density, orientation, ...props }, ref) => {
    const context = useToolbarContext();
    return (
      <div
        ref={ref}
        role="group"
        className={cn(
          toolbarGroupVariant({
            density: density ?? context.density,
            orientation: orientation ?? context.orientation,
          }),
          className,
        )}
        {...props}
      />
    );
  },
);
ToolbarGroup.displayName = "ToolbarGroup";

export interface ToolbarSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: Densities;
  /** The *toolbar's* orientation; the separator renders perpendicular to it. */
  orientation?: ToolbarOrientation;
}

const ToolbarSeparator = React.forwardRef<HTMLDivElement, ToolbarSeparatorProps>(
  ({ className, density, orientation, ...props }, ref) => {
    const context = useToolbarContext();
    const toolbarOrientation = orientation ?? context.orientation;
    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation={toolbarOrientation === "vertical" ? "horizontal" : "vertical"}
        className={cn(
          toolbarSeparatorVariant({
            density: density ?? context.density,
            orientation: toolbarOrientation,
          }),
          className,
        )}
        {...props}
      />
    );
  },
);
ToolbarSeparator.displayName = "ToolbarSeparator";

export interface ToolbarButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  tooltip?: string;
  density?: Densities;
}

const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ className, icon, label, tooltip, density, disabled, ...props }, ref) => {
    const context = useToolbarContext();
    const effectiveDensity = density ?? context.density;
    const isDisabled = Boolean(disabled) || context.disabled;
    const iconOnly = icon !== undefined && label === undefined;
    // An icon-only button falls back to its tooltip so it is never nameless.
    const accessibleName = props["aria-label"] ?? (iconOnly ? tooltip : undefined);

    const button = (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size={
          iconOnly
            ? densityToIconButtonSize(effectiveDensity)
            : densityToButtonSize(effectiveDensity)
        }
        disabled={isDisabled}
        data-toolbar-item=""
        data-disabled={isDisabled ? "true" : undefined}
        className={className}
        {...props}
        aria-label={accessibleName}
      >
        {icon}
        {label !== undefined && <span>{label}</span>}
      </Button>
    );

    if (tooltip === undefined) return button;

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    );
  },
);
ToolbarButton.displayName = "ToolbarButton";

export interface ToolbarToggleButtonProps extends ToolbarButtonProps {
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
}

const ToolbarToggleButton = React.forwardRef<HTMLButtonElement, ToolbarToggleButtonProps>(
  ({ className, pressed = false, onPressedChange, onClick, ...props }, ref) => (
    <ToolbarButton
      ref={ref}
      aria-pressed={pressed}
      className={cn(pressed && "bg-accent", className)}
      onClick={(event) => {
        onClick?.(event);
        onPressedChange?.(!pressed);
      }}
      {...props}
    />
  ),
);
ToolbarToggleButton.displayName = "ToolbarToggleButton";

export { Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarButton, ToolbarToggleButton };
