const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const PptxGenJS = require('pptxgenjs');
const ExcelJS = require('exceljs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function makeDocx(outDir) {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Documento Word de prueba', bold: true })] }),
        new Paragraph('Generado para validar la capacidad de crear archivos .docx desde OpenClaw.'),
      ],
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  await fs.promises.writeFile(path.join(outDir, 'prueba.docx'), buffer);
}

async function makePptx(outDir) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide();
  slide.addText('Presentación de prueba', { x: 0.5, y: 0.6, w: 8, h: 0.6, fontSize: 24, bold: true });
  slide.addText('Validación de generación .pptx', { x: 0.5, y: 1.5, w: 6, h: 0.4, fontSize: 14 });
  await pptx.writeFile({ fileName: path.join(outDir, 'prueba.pptx') });
}

async function makeXlsx(outDir) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Resumen');
  ws.columns = [
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Estado', key: 'estado', width: 20 },
  ];
  ws.addRow({ tipo: 'Excel', estado: 'OK' });
  ws.addRow({ tipo: 'OpenClaw', estado: 'Listo' });
  await wb.xlsx.writeFile(path.join(outDir, 'prueba.xlsx'));
}

async function makePdf(outDir) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('PDF de prueba', { x: 50, y: 780, size: 20, font, color: rgb(0, 0, 0) });
  page.drawText('Validación de generación .pdf desde OpenClaw.', { x: 50, y: 740, size: 12, font });
  const bytes = await pdfDoc.save();
  await fs.promises.writeFile(path.join(outDir, 'prueba.pdf'), bytes);
}

async function main() {
  const outDir = path.join(process.cwd(), 'outputs', 'document-tests');
  await ensureDir(outDir);
  await makeDocx(outDir);
  await makePptx(outDir);
  await makeXlsx(outDir);
  await makePdf(outDir);
  console.log(JSON.stringify({ ok: true, outDir, files: fs.readdirSync(outDir) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
