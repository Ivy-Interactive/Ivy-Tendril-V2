export function fn() {
  return "Hello, tsdown!";
}

// Components
export { ContentInput } from "./components/ContentInput/index.ts";
export type {
  ContentInputProps,
  AttachedFile,
  VoiceStatus,
  VoiceRecorderOptions,
} from "./components/ContentInput/index.ts";
export { VoiceRecorder } from "./components/ContentInput/index.ts";

export { BadgeSelect } from "./components/BadgeSelect/index.ts";
export type { BadgeSelectOption, BadgeSelectProps } from "./components/BadgeSelect/index.ts";

export { SortableVerificationList } from "./components/SortableVerificationList/index.ts";
export type {
  VerificationItem,
  SortableVerificationListProps,
} from "./components/SortableVerificationList/index.ts";
