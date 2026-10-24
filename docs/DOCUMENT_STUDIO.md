# Document & Subject Studio — v0.2.0

Two native sidebar menus have been added to the existing AI model hub:

- **Laporan Informasi** — structured reporting editor and DOCX generator.
- **Subject Studio** — shared subject identity, photo, public/background information and 5-slide PPTX generator.

## Overwrite an existing v0.1 source folder

1. **Make a backup** of any personal code changes in the existing `hanoman-telemetri` directory.
2. Extract `Hanoman-Telemetri-v0.2.0-MERGED.zip` to the **parent directory** containing the existing `hanoman-telemetri` folder, then accept file replacement.
3. In the project directory, run `npm install`, then `npm run desktop:dev`.
4. Open **Subject Studio**, enter the subject record and click **Simpan draf**, then open **Laporan Informasi** and select the saved subject — or skip Subject Studio and fill **Subjek laporan** directly on the report page. Enter the report sections and save.
5. Click **Generate DOCX**, **Generate PPTX**, or **Export keduanya**. In the native app, exports are created in the OS Downloads directory (or application data directory if unavailable); a duplicate filename gets a numeric suffix.
6. Review the Word/PPTX result in Office or LibreOffice before distribution.

A source update **does not overwrite or reset** the native SQLite database in the OS application-data directory. Take additional care if you made custom changes directly to the previous source files.

## Templates

- `public/templates/report-template.docx` derives its **document structure and formatting** from the supplied 4-page report template, with input fields substituted and the previous subject identity/text removed.
- `public/templates/subject-template.pptx` derives its **five-slide format** from the supplied PPTX; old subject material and irrelevant hidden photos are replaced or removed.
- Both remain **editable Office files** in the generated output.
- The DOCX has fixed unit, headings, classification text and signer identity. The bundled scanned signature `public/templates/signature.png` is stamped into the empty paragraph the master reserves between the signer role and the signer name, scaled to a fixed 3.19 cm width at its natural aspect ratio. Export does not constitute authorization or approval; review every generated file before distribution and remove the signature asset if the signer has not authorised its use.
- The PowerPoint uses a neutral illustration unless the user uploads a properly licensed subject photo.

### Word mapping

| Template element | Runtime field |
|---|---|
| Nomor : R / ... / LAPINFO / ... | `reportNumber`, `activityDate` (Roman month/year) |
| BIDANG | `field` |
| MASALAH/PERIHAL | `subjectLine` or subject name + role |
| I. Fakta-Fakta | `factsIntro` |
| Data Identitas | photo, name, birth place/date, profession, institution, faculty, education, issue |
| Hasil Profiling | `profiling[0..4]` (five optional slots) |
| II. Analisa | `analysis[0..3]` (four optional slots) |
| III. Pendapat Pelapor | `reporterOpinion` |
| IV. Rekomendasi | `recommendations[0..3]` (four optional slots) |
| Sign-off date | `signedDate` |
| Signer role/name/rank | Locked in master template |
| Signature image | Bundled `public/templates/signature.png`, inserted into the reserved gap above the signer name |

### Slide mapping

| Slide | Runtime fields |
|---|---|
| 1: cover | subject name, role, issue, portrait |
| 2: PROFIL | name, portrait, identity table, `shortBackground` |
| 3: JAKNIK SUBJECT | `summary`, `background`, `events`, `affiliations`, `issueContext`, `publicActivity`, `regions`, portrait |
| 4: ANALISA | report `analysis` points |
| 5: SARAN | report `recommendations` points |

## Data, capabilities, limitations

- Both editors share `SubjectRecord` and `ReportRecord` data in local SQLite under the Tauri app data folder. There is no server-side doc generation or third-party document upload.
- Fields are **manual**. No profiling, allegations, personal relationships, locations or conclusions are invented by AI. Do not infer sensitive facts or track private movements; use legitimately collected, relevant, source-backed information.
- SQLite document records, including uploaded photos as data URLs, are **not encrypted at rest**. These records may be confidential. Protect the device/account/disk, use approved storage and handling rules, and do not share the database.
- The Office template files themselves contain the classification label **RAHASIA** as supplied. The application does not decide actual information classification.
- The browser-only `npm run dev` view is not persistent; it lets you edit and generate locally, but in-memory data is lost when the page reloads. Native desktop mode persists to SQLite.
- DOCX section slots are deliberately fixed to match the master (5 / 4 / 4). Empty points are removed and the remaining points are renumbered (a, b, c / 1, 2, 3) so no gap is left in the list. For longer lists, a future variable-length template engine is needed.
- Both pages carry the same subject identity fields, so a report can be generated for a new subject without visiting Subject Studio first. Narrative profile fields used only by PowerPoint remain in Subject Studio.
- PowerPoint text box geometry is preserved; very long text may overflow despite basic field length warnings. Always inspect final slides visually.
- Built-in PowerPoint rendering is not available inside the app. The sidebar summary is a **data preview, not a WYSIWYG document preview**.
- Version approval history, editable template mapping editor, cloud sync, and AI-assisted writing are not included in v0.2.0.
- No installer has been compiled in this environment; Windows requires local Rust/Tauri toolchain and npm dependencies.

## Implementation map

```
src/DocumentStudio.tsx          Subject form, report form, export actions
src/lib/documents.ts           SubjectRecord, ReportRecord, new/normalize helpers
src/lib/documentStore.ts       Tauri IPC + in-memory browser preview storage
src/lib/documentEngine.ts      OOXML ZIP replacement and Office generators
public/templates/*.docx|pptx  Sanitized master Office templates
src-tauri/src/db.rs            SQLite subject_records and report_records tables
src-tauri/src/lib.rs           Native CRUD + Downloads export command
src/App.tsx                    New sidebar routes
```

The app uses the JavaScript `jszip` package to change specific Office XML parts and optionally image bytes. The Rust layer persists structured records and safely writes exports in Downloads; no Python executable is required on the Windows user machine.

## Example test after installing npm dependencies

Run `npm run build` to typecheck and bundle React, then `npm run desktop:dev` to smoke test native CRUD and export. To inspect a generated document, open it in Microsoft Office/LibreOffice and confirm numbering, photo, page count, and absence of earlier subject content. For templates, a local smoke validation helper is provided under `tests/validate_templates.py` (optional Python 3, standard library only).
