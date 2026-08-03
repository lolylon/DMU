import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';

function resolveFontPath(): string | null {
  if (process.env.PDF_FONT_PATH && existsSync(process.env.PDF_FONT_PATH)) {
    return process.env.PDF_FONT_PATH;
  }
  const candidates =
    process.platform === 'win32'
      ? ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf']
      : [
          '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
          '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export type ConclusionPdfInput = {
  caseId: string;
  versionNumber: number;
  authorDisplayName: string;
  authorPosition: string;
  complaints: string;
  anamnesis: string;
  examination: string;
  conclusionText: string;
  recommendations: string;
  signedAt: string;
  certSubject?: string;
  contentHash: string;
};

/** Server-side PDF for signed conclusion (TZ 6.4). */
export async function buildConclusionPdf(input: ConclusionPdfInput): Promise<Buffer> {
  const font = resolveFontPath();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4', info: { Title: 'Заключение ДМУ', Author: 'Miru Remote' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (font) doc.font(font);
    else doc.font('Helvetica');

    doc.fontSize(14).text('Заключение дистанционной медицинской услуги', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Случай: ${input.caseId}`);
    doc.text(`Версия: ${input.versionNumber}`);
    doc.text(`Врач: ${input.authorDisplayName}`);
    doc.text(`Должность: ${input.authorPosition || '—'}`);
    doc.text(`Подписано: ${input.signedAt}`);
    if (input.certSubject) doc.text(`Сертификат: ${input.certSubject}`);
    doc.text(`SHA-256 содержания: ${input.contentHash}`);
    doc.moveDown();

    const sections: Array<[string, string]> = [
      ['Жалобы', input.complaints],
      ['Анамнез', input.anamnesis],
      ['Осмотр / данные', input.examination],
      ['Заключение', input.conclusionText],
      ['Рекомендации', input.recommendations],
    ];
    for (const [title, body] of sections) {
      doc.fontSize(12).text(title, { underline: true });
      doc.moveDown(0.25);
      doc.fontSize(10).text(body || '—', { align: 'left' });
      doc.moveDown();
    }

    doc.fontSize(8).fillColor('#444').text('Документ сформирован Miru Remote. Доказательная база — contentHash + CMS.');
    doc.end();
  });
}
