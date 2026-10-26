import { get } from "./adminDongApi";
import { matchesPublication, validQuarterCode } from "../lib/publication";
import {
  contextKeys,
  type AdminDongContext,
  type ContextKey,
  type SalesBreakdown,
} from "../types/context";
import policy from "../data/context-policy-v1.json";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: unknown, keys: string[]) =>
  object(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => k in v);
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const stamp = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v));
function decimal(v: unknown, integer = false) {
  if (v === null) return true;
  if (
    typeof v !== "string" ||
    !(integer ? /^(0|[1-9][0-9]*)$/ : /^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/).test(
      v,
    )
  )
    return false;
  const [whole, fraction = ""] = v.split(".");
  return (
    BigInt(whole) < 9223372036854775807n ||
    (BigInt(whole) === 9223372036854775807n && !/[1-9]/.test(fraction))
  );
}
function section(value: unknown, key: ContextKey, period: string) {
  const spec = policy.policy.sections[key];
  if (
    !object(value) ||
    !["REFERENCE", "NO_ROW", "NO_PERIOD", "WITHHELD"].includes(
      String(value.state),
    ) ||
    (key === "consumption") !== (value.state === "WITHHELD") ||
    value.scoreReady !== false ||
    value.spatialCompatibility !== "HISTORICAL_UNVERIFIED" ||
    JSON.stringify(value.reasonCodes) !== JSON.stringify(spec.reason_codes) ||
    !object(value.provenance)
  )
    return false;
  const origin = value.provenance;
  if (
    origin.sourceId !== spec.source_id ||
    origin.datasetId !== spec.dataset_id ||
    origin.sourceUrl !== spec.source_url ||
    origin.refreshModel !== spec.refresh_model ||
    origin.observedAt !== null
  )
    return false;
  if (key === "consumption")
    return (
      origin.runId === null &&
      origin.sourceQuarter === null &&
      origin.collectedAt === null &&
      value.metrics === null &&
      value.attributes === null
    );
  if (!hash(origin.runId) || !stamp(origin.collectedAt)) return false;
  if (value.state !== "REFERENCE")
    return (
      value.metrics === null &&
      value.attributes === null &&
      origin.sourceQuarter === null
    );
  if (
    origin.sourceQuarter !== period ||
    !exactKeys(value.metrics, spec.fields) ||
    !object(value.metrics) ||
    !exactKeys(value.attributes, spec.attributes) ||
    !object(value.attributes)
  )
    return false;
  if (
    !Object.values(value.attributes).every(
      (v) => v === null || typeof v === "string",
    )
  )
    return false;
  if (key === "change") {
    const names: Record<string, string> = {
      LL: "다이나믹",
      LH: "상권확장",
      HL: "상권축소",
      HH: "정체",
    };
    const code = value.attributes.TRDAR_CHNGE_IX;
    if (
      typeof code !== "string" ||
      !Object.hasOwn(names, code) ||
      names[code] !== value.attributes.TRDAR_CHNGE_IX_NM
    )
      return false;
  }
  const metrics = value.metrics;
  return spec.fields.every((field) => {
    const metric = metrics[field];
    const unit =
      field === "TOT_HSHLD_CO"
        ? "HOUSEHOLD"
        : key === "facilities"
          ? "FACILITY"
          : key === "change"
            ? "MONTH"
            : "PERSON";
    return (
      object(metric) &&
      exactKeys(metric, [
        "value",
        "valueState",
        "unit",
        "temporalAggregation",
      ]) &&
      decimal(metric.value) &&
      metric.valueState ===
        (metric.value === null ? "SOURCE_NULL" : "REPORTED") &&
      metric.unit === unit &&
      metric.temporalAggregation === spec.temporal_aggregation
    );
  });
}
function identity(v: unknown, dong: string, period: string, version: string) {
  return (
    object(v) &&
    object(v.dong) &&
    v.dong.code === dong &&
    typeof v.dong.name === "string" &&
    object(v.quarter) &&
    v.quarter.code === period &&
    validQuarterCode(period) &&
    v.quarter.label === `${period.slice(0, 4)}년 ${period[4]}분기` &&
    matchesPublication(v.metadata, version)
  );
}
export function getAdminDongContext(
  dong: string,
  period: string,
  version: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    dongCode: dong,
    quarterCode: period,
    dataVersion: version,
  });
  return get<AdminDongContext>(
    `/api/admin-dong-context?${params}`,
    (v): v is AdminDongContext =>
      validAdminDongContext(v, dong, period, version),
    signal,
  );
}
export function validAdminDongContext(
  v: unknown,
  dong: string,
  period: string,
  version: string,
): v is AdminDongContext {
  if (
    !identity(v, dong, period, version) ||
    !object(v) ||
    !object(v.metadata) ||
    v.contextPolicyVersion !== policy.version ||
    v.spatialUnit !== "ADMINISTRATIVE_DONG" ||
    !exactKeys(v.sections, [...contextKeys]) ||
    !object(v.sections)
  )
    return false;
  const sections = v.sections;
  return contextKeys.every((k) => section(sections[k], k, period));
}
export const salesGroups = {
  dayTypes: ["MDWK", "WKEND"],
  weekdays: ["MON", "TUES", "WED", "THUR", "FRI", "SAT", "SUN"],
  timeSlots: ["00_06", "06_11", "11_14", "14_17", "17_21", "21_24"],
  sexes: ["ML", "FML"],
  ages: ["10", "20", "30", "40", "50", "60_ABOVE"],
};
export function getSalesBreakdown(
  dong: string,
  period: string,
  version: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    dongCode: dong,
    industryCode: "CAFE",
    quarterCode: period,
    dataVersion: version,
  });
  const totals = (v: unknown) =>
    object(v) &&
    decimal(v.estimatedSalesAmount, true) &&
    decimal(v.transactionCount, true);
  return get<SalesBreakdown>(
    `/api/admin-dong-sales-breakdown?${params}`,
    (v): v is SalesBreakdown => {
      if (
        !identity(v, dong, period, version) ||
        !object(v) ||
        !object(v.industry) ||
        v.industry.code !== "CAFE"
      )
        return false;
      if (v.sales === null) return v.missingReason === "NO_ROW";
      if (
        v.missingReason !== null ||
        !object(v.sales) ||
        !totals(v.sales.totals)
      )
        return false;
      const sales = v.sales;
      return Object.entries(salesGroups).every(([key, codes]) => {
        const items = sales[key];
        return (
          Array.isArray(items) &&
          items.length === codes.length &&
          items.every(
            (item, i) => object(item) && item.code === codes[i] && totals(item),
          )
        );
      });
    },
    signal,
  );
}
