export function parseGibsDescribeDomainsXml(xml: string): string[] {
  const match = xml.match(/<Domain>([^<]*)<\/Domain>/);
  if (!match?.[1]) return [];
  return expandGibsDomainString(match[1].trim());
}

function eachUtcDayInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  let cur = new Date(Date.UTC(ys, ms - 1, ds));
  const endDate = new Date(Date.UTC(ye, me - 1, de));
  while (cur <= endDate) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function expandGibsDomainString(domain: string): string[] {
  const dates = new Set<string>();
  for (const segment of domain.split(",")) {
    const trimmed = segment.trim();
    const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\/P1D$/);
    if (!m) continue;
    for (const d of eachUtcDayInclusive(m[1], m[2])) {
      dates.add(d);
    }
  }
  return [...dates].sort();
}
