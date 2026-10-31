import { z } from 'zod';

export const CATEGORIES = ['Obstructed access', 'Reversing or visibility', 'Pedestrian or cyclist', 'Road or weather conditions', 'Animal encounter', 'Other / unclear'] as const;
export const OUTCOMES = ['Near miss / no contact', 'Contact or injury reported', 'Not stated'] as const;
export const FieldsSchema = z.object({
  title: z.string().trim().min(1).max(140),
  location: z.string().trim().max(200),
  category: z.enum(CATEGORIES),
  maneuver: z.string().trim().max(300),
  outcome: z.enum(OUTCOMES),
  evidence: z.string().trim().max(1000),
});
export type ReportFields = z.infer<typeof FieldsSchema>;
export const ReportSchema = FieldsSchema.extend({
  id: z.string().uuid(),
  transcript: z.string().trim().min(10).max(6000),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  occurredAt: z.string().max(40),
  source: z.enum(['typed', 'recorded', 'uploaded', 'demo']),
  extraction: z.string().max(160),
  confirmed: z.literal(true),
});
export type Report = z.infer<typeof ReportSchema>;
export type Source = Report['source'];

const rules: { category: ReportFields['category']; pattern: RegExp }[] = [
  { category: 'Animal encounter', pattern: /\b(dog|dogs|animal|deer)\b/i },
  { category: 'Pedestrian or cyclist', pattern: /\b(pedestrian|cyclist|bicycle|child|children)\b/i },
  { category: 'Road or weather conditions', pattern: /\b(ice|icy|snow|slippery|rain|flood|pothole|gravel|fog)\b/i },
  { category: 'Obstructed access', pattern: /\b(blocked|blocking|obstruction|obstructed|obstructing)\b/i },
  { category: 'Reversing or visibility', pattern: /\b(reverse|reversing|backing|blind|visibility)\b/i },
];

/** A transparent offline baseline. Suggestions must be reviewed, including negation. */
export function suggestFields(transcript: string): ReportFields {
  const sentences = transcript.match(/[^.!?]+[.!?]?/g)?.map((value) => value.trim()) ?? [transcript];
  const rule = rules.find(({ pattern }) => pattern.test(transcript));
  const evidence = sentences.find((sentence) => rule?.pattern.test(sentence)) ?? sentences[0];
  const location = transcript.match(/\b(?:at|on|near)\s+((?:\d+\s+)?(?:[A-Za-z][A-Za-z'-]*\s+){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Way))\b/i)?.[1] ?? '';
  const maneuver = sentences.find((sentence) => /\b(reverse|reversing|backed|backing|stopped|braked|braking|slowed|swerved|waited)\b/i.test(sentence)) ?? '';
  return {
    title: sentences[0].slice(0, 140), location,
    category: rule?.category ?? 'Other / unclear',
    maneuver: maneuver.slice(0, 300),
    outcome: 'Not stated', evidence: evidence.slice(0, 1000),
  };
}

export function verifyEvidence(fields: ReportFields, transcript: string): ReportFields {
  if (fields.evidence && !transcript.includes(fields.evidence)) {
    throw new Error('The model supplied an evidence quote that is not in the transcript. Review manually or retry.');
  }
  return fields;
}

export function filterReports(reports: Report[], search: string, category: string, dataset: 'real' | 'demo'): Report[] {
  const query = search.trim().toLocaleLowerCase();
  return reports.filter((report) => (report.source === 'demo') === (dataset === 'demo'))
    .filter((report) => category === 'all' || report.category === category)
    .filter((report) => `${report.title} ${report.location} ${report.transcript} ${report.maneuver}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function categoryCounts(reports: Report[]): { category: string; count: number }[] {
  return CATEGORIES.map((category) => ({ category, count: reports.filter((report) => report.category === category).length }))
    .filter(({ count }) => count > 0).sort((a, b) => b.count - a.count);
}

export function recurringLocations(reports: Report[]): { location: string; count: number }[] {
  const groups = new Map<string, { location: string; count: number }>();
  for (const report of reports) {
    const key = report.location.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    if (!key) continue;
    const group = groups.get(key) ?? { location: report.location, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].filter(({ count }) => count > 1).sort((a, b) => b.count - a.count);
}

export type SimilarPair = { left: string; right: string; similarity: number };
export function similarPairs(ids: string[], embeddings: number[][], threshold = 0.55): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = embeddings[i];
      const b = embeddings[j];
      const dot = a.reduce((sum, value, k) => sum + value * b[k], 0);
      const normA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
      const normB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
      const similarity = normA && normB ? Math.max(-1, Math.min(1, dot / (normA * normB))) : 0;
      if (similarity >= threshold) pairs.push({ left: ids[i], right: ids[j], similarity });
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity).slice(0, 20);
}

function csvCell(value: string): string {
  // Prevent formulas when reports are opened in spreadsheet software.
  const safe = /^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function reportsCsv(reports: Report[]): string {
  const keys = ['id', 'title', 'location', 'category', 'maneuver', 'outcome', 'occurredAt', 'createdAt', 'source', 'extraction', 'transcript', 'evidence'] as const;
  return [keys.join(','), ...reports.map((report) => keys.map((key) => csvCell(report[key])).join(','))].join('\r\n');
}
