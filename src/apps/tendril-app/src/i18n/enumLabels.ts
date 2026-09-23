import { useMemo } from "react";
import type { TranslationKey } from "@ivy-interactive/components/i18n";
import { i18n, useTranslation, type AppResources } from "./index";

/**
 * Display labels for the daemon's enum values - job statuses, job types and plan states - which the
 * UI renders in many places (badges, filters, table cells, notification titles) and used to render
 * raw. One set of labels in `common.json`, `enums.<group>.<value>`, so every view says the same word
 * for the same state in every language.
 *
 * The English label of every value is the value itself - `ExecutePlan`, `Running` - because that is
 * what the UI showed before, and English output stays as it was. The value itself never changes:
 * logic keeps comparing `job.status === "Running"`, and only the text on screen goes through here.
 *
 * A value this build has no label for - one the daemon added since - is shown as it is, never as a
 * missing key. Keys are the value with its first letter lower-cased, the camelCase every catalog key
 * uses: `ExecutePlan` is `enums.jobType.executePlan`.
 */

type EnumGroup = "jobStatus" | "jobType" | "planState";

export interface EnumLabels {
  jobStatus: (status: string) => string;
  jobType: (type: string) => string;
  planState: (state: string) => string;
}

/** `common`'s key for a value. Typed loosely on purpose: the value may be one no catalog has. */
const enumKey = (group: EnumGroup, value: string) =>
  `enums.${group}.${value.charAt(0).toLowerCase()}${value.slice(1)}` as TranslationKey<
    AppResources,
    "common"
  >;

function labels(translate: (key: TranslationKey<AppResources, "common">) => string): EnumLabels {
  const label = (group: EnumGroup, value: string) => {
    const key = enumKey(group, value);
    return i18n.exists(`common:${key}`) ? translate(key) : value;
  };
  return {
    jobStatus: (status) => label("jobStatus", status),
    jobType: (type) => label("jobType", type),
    planState: (state) => label("planState", state),
  };
}

const commonT = i18n.getFixedT(null, "common");

/** For code outside React. Translates into the language current at the call. */
export const {
  jobStatus: jobStatusLabel,
  jobType: jobTypeLabel,
  planState: planStateLabel,
} = labels(commonT);

/** The same labels for a component, which re-renders - with a new object - when the language changes. */
export function useEnumLabels(): EnumLabels {
  const { t } = useTranslation("common");
  return useMemo(() => labels(t), [t]);
}
