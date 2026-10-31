import { describe, expect, it } from 'vitest';
import { categoryCounts, filterReports, recurringLocations, ReportSchema, reportsCsv, similarPairs, suggestFields, verifyEvidence } from '../src/domain';
import { createDemoReports, SAMPLE_TRANSCRIPT } from '../src/demo';

describe('reviewable extraction', () => {
  it('keeps explicit transcript evidence and does not invent an outcome', () => {
    const result = suggestFields(SAMPLE_TRANSCRIPT);
    expect(result.location).toBe('42 Oak Street');
    expect(SAMPLE_TRANSCRIPT).toContain(result.evidence);
    expect(result.outcome).toBe('Not stated');
    expect(result.maneuver).toContain('reverse');
  });
  it('leaves missing details unknown and requires confirmation before saving', () => {
    const fields = suggestFields('Something unusual happened during my delivery.');
    expect(fields.category).toBe('Other / unclear');
    expect(fields.location).toBe('');
    expect(fields.maneuver).toBe('');
    const report = createDemoReports()[0];
    expect(ReportSchema.safeParse({ ...report, confirmed: false }).success).toBe(false);
  });
  it('rejects model evidence that was not actually said', () => {
    const fields = suggestFields(SAMPLE_TRANSCRIPT);
    expect(() => verifyEvidence({ ...fields, evidence: 'The driver was at fault.' }, SAMPLE_TRANSCRIPT)).toThrow('not in the transcript');
    expect(verifyEvidence(fields, SAMPLE_TRANSCRIPT)).toEqual(fields);
  });
});

describe('report analytics and exports', () => {
  it('keeps fictional reports out of the real dataset', () => {
    const examples = createDemoReports();
    const real = { ...examples[0], id: crypto.randomUUID(), source: 'typed' as const };
    expect(filterReports([...examples, real], '', 'all', 'real')).toEqual([real]);
    expect(filterReports([...examples, real], '', 'all', 'demo')).toHaveLength(5);
    expect(filterReports(examples, 'Pine Road', 'Road or weather conditions', 'demo')).toHaveLength(2);
  });
  it('counts categories and repeated location names without treating unknowns as a place', () => {
    const examples = createDemoReports();
    expect(categoryCounts(examples).find((item) => item.category === 'Obstructed access')?.count).toBe(2);
    expect(recurringLocations(examples).find((item) => item.location === 'Pine Road')?.count).toBe(2);
    expect(recurringLocations(examples.map((report) => ({ ...report, location: '' })))).toEqual([]);
  });
  it('normalizes similarity, omits dissimilar pairs and avoids self-pairs', () => {
    const pairs = similarPairs(['a', 'b', 'c'], [[2, 0], [3, 0], [0, 1]]);
    expect(pairs).toEqual([{ left: 'a', right: 'b', similarity: 1 }]);
    expect(similarPairs(['a', 'b'], [[0, 0], [1, 1]])).toEqual([]);
  });
  it('escapes CSV content and prevents formula execution', () => {
    const report = { ...createDemoReports()[0], title: '=HYPERLINK("https://example.com")', location: 'Oak, Street\nRear entrance' };
    const csv = reportsCsv([report]);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"Oak, Street\nRear entrance"');
  });
  it('creates well-formed demo records with explicit provenance', () => {
    for (const report of createDemoReports()) expect(ReportSchema.safeParse(report).success).toBe(true);
  });
});
