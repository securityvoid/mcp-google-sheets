# Claude Desktop extension (.mcpb)

## Pack (company build)

Company values live in **`company.config.json`**, which is gitignored.

```bash
cp desktop-extension/company.config.example.json desktop-extension/company.config.json
# edit company.config.json
node desktop-extension/pack.mjs
```

Output defaults to `dist/legacyoutcomes-google-sheets.mcpb`.

The pack script:

1. Reads `company.config.json`
2. Stages a clean extension (manifest, launcher, baked `server/company.json`, bundled Python from `src/`)
3. Runs `npx @anthropic-ai/mcpb pack`
4. Deletes the staging dir

## Install

Double-click the `.mcpb`, or Claude Desktop → Settings → Extensions → Install Extension.
