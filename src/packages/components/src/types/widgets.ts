export interface CallSite {
  path?: string;
  filePath?: string;
  lineNumber?: number;
  memberName?: string;
  declaringType?: string;
}

export const widgetCallSiteRegistry = new Map<string, CallSite | undefined>();
