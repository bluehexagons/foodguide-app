# Local output and retention

The native Electron Forge workflow owns packaging. `dist/` contains compiled
wrapper output; `.generated/` contains generated assets. `npm start`,
`npm run package` and `npm run make` rebuild these. Stop the app and build jobs
before proposing removal.

`out/` mixes packaged apps/installers with `out/test-results/` smoke captures.
Review its exact children: retain any release needed for verification and useful
screenshots documenting a milestone or regression. The guide submodule and its
source artwork under `app/foodguide/` are source content, never cleanup targets.
Application profiles, saved inventories and user backups are outside these rules.

With an updated Basaltwater installation, inspect the adapter and preview only
the unambiguous generated directories:

```sh
basaltw agent storage project "$PWD" --json
basaltw agent storage clean-generated "$PWD" --rule compiled-output
```

The shared remover previews by default; authorized removal requires `--apply`
and writes to the project root for isolation. Follow the shared
[cleanup and curation guidance](https://github.com/bluehexagons/basaltwater/blob/main/docs/agents/project-cleanup.md)
instead of copying cleanup infrastructure here. On other environments, stop the
same jobs, inspect exact paths and Git tracking, then manually remove only
authorized generated output using native tools. Normal builds/tests need no
Basaltwater installation.

Curate selected captures under ignored
`artifacts/archive/YYYY-MM-DD--milestone/` with original paths, known revision,
captions and SHA-256. Use bounded Luna high/standard workers for large file lists
when available. Preserve provenance gaps; do not publish private media by default.
Verify copies before authorized removal. Same-disk archival does not free space.
