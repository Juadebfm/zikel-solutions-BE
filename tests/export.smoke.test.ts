import { describe, expect, it } from 'vitest';
import { generateExport } from '../src/lib/export.js';

const baseOptions = {
  title: 'Therapeutic Export Smoke',
  subtitle: 'Regulatory evidence sample',
  columns: [
    { header: 'ID', key: 'id', width: 120 },
    { header: 'Name', key: 'name', width: 220 },
    { header: 'Status', key: 'status', width: 140 },
  ],
  rows: [
    { id: 'row_1', name: 'Northbridge Home', status: 'pending' },
    { id: 'row_2', name: 'Lakeside Home', status: 'completed' },
  ],
} as const;

describe('export smoke', () => {
  it('generates a valid PDF export buffer', async () => {
    const result = await generateExport({
      ...baseOptions,
      format: 'pdf',
    });

    expect(result.contentType).toBe('application/pdf');
    expect(result.filename.endsWith('.pdf')).toBe(true);
    expect(result.buffer.length).toBeGreaterThan(100);
    expect(result.buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('generates a valid Excel export buffer', async () => {
    const result = await generateExport({
      ...baseOptions,
      format: 'excel',
    });

    expect(result.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result.filename.endsWith('.xlsx')).toBe(true);
    expect(result.buffer.length).toBeGreaterThan(100);
    expect(result.buffer.subarray(0, 2).toString('utf8')).toBe('PK');
  });
});

