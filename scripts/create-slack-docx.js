const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun } = require('docx');

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'documento';
}

async function main() {
  const [, , titleArg, bodyArg, nameArg] = process.argv;
  if (!titleArg || !bodyArg) {
    console.error('Uso: node scripts/create-slack-docx.js "Título" "Contenido" [nombre-archivo]');
    process.exit(1);
  }

  const outDir = '/root/.openclaw/workspace/outputs/slack-documents';
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `${slugify(nameArg || titleArg)}.docx`;
  const outPath = path.join(outDir, fileName);

  const paragraphs = bodyArg
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => new Paragraph(line));

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: titleArg, bold: true, size: 28 })] }),
        ...paragraphs,
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  console.log(outPath);
  console.log(`MEDIA:${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
