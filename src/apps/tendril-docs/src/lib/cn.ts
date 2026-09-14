import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Same helper the components library uses internally, kept local so nothing private is imported. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
