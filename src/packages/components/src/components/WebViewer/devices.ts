export type DeviceKey = "desktop" | "tablet" | "mobile";

export const DEVICE_ORDER: DeviceKey[] = ["desktop", "tablet", "mobile"];

/**
 * The device names the viewer reports to its host (the `device` event, a comment's `device`). They
 * are protocol values and stay English - a host writes the label back as the `device` prop, which
 * {@link toDeviceKey} parses - and the toolbar shows translated labels of its own.
 */
export const DEVICE_LABELS: Record<DeviceKey, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

export const DEVICE_VIEWPORTS: Record<DeviceKey, { w: number | null; h: number | null }> = {
  desktop: { w: null, h: null },
  tablet: { w: 820, h: 1180 },
  mobile: { w: 390, h: 844 },
};

export function toDeviceKey(value?: string | null): DeviceKey {
  const key = (value || "desktop").toLowerCase();
  return key === "tablet" || key === "mobile" ? key : "desktop";
}
