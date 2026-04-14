const fs = require('fs');
const path = require('path');

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-nombre';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const [, , userArg, caseArg, dateArg] = process.argv;

  if (!userArg || !caseArg) {
    console.error('Uso: node scripts/create-evidence-case.js "Usuario" "Causa o Asunto" [YYYY-MM-DD]');
    process.exit(1);
  }

  const date = dateArg || new Date().toISOString().slice(0, 10);
  const user = slugify(userArg);
  const cause = slugify(caseArg);

  const base = path.join(process.cwd(), 'evidence', user, `${date}_${cause}`);
  const folders = [
    'inbox',
    'originals',
    'extracted-text',
    'qdrant-staging',
    'notes',
    'exports',
  ];

  ensureDir(base);
  for (const folder of folders) {
    ensureDir(path.join(base, folder));
  }

  const metadataPath = path.join(base, 'notes', 'case-metadata.json');
  if (!fs.existsSync(metadataPath)) {
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          userDisplayName: userArg,
          caseDisplayName: caseArg,
          userSlug: user,
          caseSlug: cause,
          date,
          qdrantCollectionSuggested: `user_${user}`,
        },
        null,
        2
      )
    );
  }

  console.log(JSON.stringify({ ok: true, base, metadataPath }, null, 2));
}

main();
