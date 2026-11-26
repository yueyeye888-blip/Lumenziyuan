export const unlistedCountry = "未标注";
const preferredCountries = ["中国", "香港", "澳门", "台湾", "新加坡", "美国", "英国", "德国", "奥地利", "法国", "加拿大"];
const countryAliases = new Map([
  ["中国内地", "中国"], ["中国大陆", "中国"], ["中国香港", "香港"],
  ["中国澳门", "澳门"], ["中国台湾", "台湾"],
]);
const countryCollator = new Intl.Collator("zh-CN");

/** The supplier appends cities, flags and notes to the primary catalog country. */
export function templateCountry(raw = "") {
  if (!raw || raw.includes("实际地区未确认")) return unlistedCountry;
  const primary = raw.trim().split(/[·（(；;\p{Regional_Indicator}\uFFFD]/u, 1)[0].trim().replace(/格式$/u, "");
  return countryAliases.get(primary) || primary || unlistedCountry;
}

/** @param {string[]} labels */
export function sortedTemplateCountries(labels) {
  const unique = new Set(labels);
  const first = preferredCountries.filter(label => unique.delete(label));
  const hasUnlisted = unique.delete(unlistedCountry);
  return [...first, ...Array.from(unique).sort(countryCollator.compare), ...(hasUnlisted ? [unlistedCountry] : [])];
}
