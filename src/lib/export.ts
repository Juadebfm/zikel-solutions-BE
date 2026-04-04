import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

export type ExportColumn = {
  header: string;
  key: string;
  width?: number;
};

export type ExportOptions = {
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  format: 'pdf' | 'excel' | 'csv';
};

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return value.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ─── PDF Generation ──────────────────────────────────────────────────────────

const BRAND_ORANGE = '#F94D00';
const TABLE_HEADER_BG = '#1A1A2E';
const TABLE_HEADER_TEXT = '#FFFFFF';
const TABLE_ROW_ALT = '#F8F9FA';
const TABLE_BORDER = '#DEE2E6';

function drawLogo(doc: InstanceType<typeof PDFDocument>, x: number, y: number, size: number) {
  const r = size * 0.1;
  doc.save();
  doc.roundedRect(x, y, size, size, r).fill(BRAND_ORANGE);

  // Z icon (simplified paths)
  const scale = size / 42;
  const ox = x;
  const oy = y;

  doc.save();
  doc.translate(ox, oy).scale(scale);
  // Rotated Z — approximate with simplified geometry
  doc
    .path('M9.545 10.188H18.659L24.942 16.473V23.241L14.69 13.043L14.658 31.813H9.545Z')
    .fill('#FFFFFF');
  doc
    .path('M32.455 31.813H23.343L17.061 25.527V18.756L27.313 28.952L27.344 10.187H32.455Z')
    .fill('#FFFFFF');
  doc.restore();
  doc.restore();
}

export async function generatePdf(options: ExportOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { title, subtitle, columns, rows } = options;

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // ── Header with logo ──────────────────────────────────────────────────
    const logoSize = 30;
    drawLogo(doc, doc.page.margins.left, doc.page.margins.top, logoSize);

    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#1A1A2E')
      .text('Zikel Solutions', doc.page.margins.left + logoSize + 10, doc.page.margins.top + 8);

    // Title
    doc
      .fontSize(16)
      .fillColor('#000000')
      .text(title, doc.page.margins.left, doc.page.margins.top + logoSize + 15, {
        align: 'center',
        width: pageWidth,
      });

    if (subtitle) {
      doc
        .fontSize(10)
        .fillColor('#666666')
        .text(subtitle, doc.page.margins.left, doc.y + 2, {
          align: 'center',
          width: pageWidth,
        });
    }

    doc.moveDown(1);

    // ── Table ─────────────────────────────────────────────────────────────
    const tableTop = doc.y;
    const totalDefinedWidth = columns.reduce((sum, c) => sum + (c.width ?? 100), 0);
    const scaleFactor = pageWidth / totalDefinedWidth;
    const colWidths = columns.map((c) => (c.width ?? 100) * scaleFactor);
    const rowHeight = 22;
    const fontSize = 8;
    const padding = 5;

    function drawTableHeader(y: number) {
      // Header background
      doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill(TABLE_HEADER_BG);

      let xPos = doc.page.margins.left;
      doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(TABLE_HEADER_TEXT);

      for (let i = 0; i < columns.length; i++) {
        doc.text(columns[i].header, xPos + padding, y + 6, {
          width: colWidths[i] - padding * 2,
          lineBreak: false,
        });
        xPos += colWidths[i];
      }

      return y + rowHeight;
    }

    function drawTableRow(y: number, row: Record<string, unknown>, rowIndex: number) {
      // Alternate row background
      if (rowIndex % 2 === 1) {
        doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill(TABLE_ROW_ALT);
      }

      // Row border
      doc
        .strokeColor(TABLE_BORDER)
        .lineWidth(0.5)
        .moveTo(doc.page.margins.left, y + rowHeight)
        .lineTo(doc.page.margins.left + pageWidth, y + rowHeight)
        .stroke();

      let xPos = doc.page.margins.left;
      doc.font('Helvetica').fontSize(fontSize).fillColor('#333333');

      for (let i = 0; i < columns.length; i++) {
        const value = formatCellValue(row[columns[i].key]);
        doc.text(value, xPos + padding, y + 6, {
          width: colWidths[i] - padding * 2,
          lineBreak: false,
        });
        xPos += colWidths[i];
      }

      return y + rowHeight;
    }

    let currentY = drawTableHeader(tableTop);

    for (let i = 0; i < rows.length; i++) {
      // Check if we need a new page
      if (currentY + rowHeight > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
        currentY = drawTableHeader(doc.page.margins.top);
      }

      currentY = drawTableRow(currentY, rows[i], i);
    }

    // Footer on all pages
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#999999')
        .text(
          `Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })} — Page ${i + 1} of ${pageCount}`,
          doc.page.margins.left,
          doc.page.height - doc.page.margins.bottom + 10,
          { align: 'center', width: pageWidth },
        );
    }

    doc.end();
  });
}

// ─── Excel Generation ────────────────────────────────────────────────────────

export async function generateExcel(options: ExportOptions): Promise<Buffer> {
  const { title, subtitle, columns, rows } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zikel Solutions';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title.slice(0, 31)); // Excel max sheet name 31 chars

  // Title row
  const titleRow = sheet.addRow([`Zikel Solutions — ${title}${subtitle ? ` (${subtitle})` : ''}`]);
  titleRow.font = { bold: true, size: 14, color: { argb: '1A1A2E' } };
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.addRow([]);

  // Header row
  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1A1A2E' } };
    cell.alignment = { vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'DEE2E6' } },
    };
  });

  // Column widths
  columns.forEach((col, i) => {
    const sheetCol = sheet.getColumn(i + 1);
    sheetCol.width = col.width ? col.width / 5 : 20;
    sheetCol.key = col.key;
  });

  // Data rows
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const values = columns.map((col) => formatCellValue(row[col.key]));
    const dataRow = sheet.addRow(values);

    if (i % 2 === 1) {
      dataRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8F9FA' } };
      });
    }
  }

  // Auto-filter on header row
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + rows.length, column: columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── CSV Generation ──────────────────────────────────────────────────────────

function escapeCsvValue(value: unknown): string {
  const raw = formatCellValue(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export async function generateCsv(options: ExportOptions): Promise<Buffer> {
  const headers = options.columns.map((column) => escapeCsvValue(column.header)).join(',');
  const rows = options.rows.map((row) => (
    options.columns.map((column) => escapeCsvValue(row[column.key])).join(',')
  ));
  const csv = [headers, ...rows].join('\n');
  return Buffer.from(csv, 'utf-8');
}

// ─── Unified Export ──────────────────────────────────────────────────────────

export async function generateExport(options: ExportOptions): Promise<{
  buffer: Buffer;
  contentType: string;
  filename: string;
}> {
  const dateSuffix = new Date().toISOString().slice(0, 10);
  const safeTitle = options.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');

  if (options.format === 'excel') {
    const buffer = await generateExcel(options);
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${safeTitle}-${dateSuffix}.xlsx`,
    };
  }

  if (options.format === 'csv') {
    const buffer = await generateCsv(options);
    return {
      buffer,
      contentType: 'text/csv; charset=utf-8',
      filename: `${safeTitle}-${dateSuffix}.csv`,
    };
  }

  const buffer = await generatePdf(options);
  return {
    buffer,
    contentType: 'application/pdf',
    filename: `${safeTitle}-${dateSuffix}.pdf`,
  };
}
