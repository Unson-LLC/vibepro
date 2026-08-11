const ACCEPTANCE_CRITERIA_HEADING = /^#{1,6}\s+(?:(?:\d+(?:\.\d+)*)[.)]?\s+)?(?:acceptance\s+criteria|受け入れ基準|受入基準|受け入れ条件|受入条件|完了定義)\s*[:：]?\s*$/i;
const MARKDOWN_HEADING = /^#{1,6}\s+/;
const BULLET = /^\s*-\s*(?:\[[ xX]\]\s*)?(.+?)\s*$/;
const EXPLICIT_AC_ID = /^((?:[A-Za-z0-9]+-)*AC-[A-Za-z0-9-]+)\s*[:：]/i;

export function extractMarkdownAcceptanceCriteria(content) {
  const lines = String(content ?? '').split(/\r?\n/);
  const criteria = [];
  let inSection = false;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (ACCEPTANCE_CRITERIA_HEADING.test(trimmed)) {
      inSection = true;
      continue;
    }
    if (inSection && MARKDOWN_HEADING.test(trimmed)) break;
    if (!inSection) continue;
    const match = line.match(BULLET);
    if (!match) continue;
    const text = match[1].trim();
    if (!text) continue;
    criteria.push({
      id: text.match(EXPLICIT_AC_ID)?.[1] ?? `AC-${criteria.length + 1}`,
      text,
      source_line: index + 1
    });
  }
  return criteria;
}
