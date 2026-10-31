# Routewatch Fieldnotes

A local near-miss reporting prototype for delivery-driver safety. Record or upload a short account, review the transcript, extract structured details, and save a confirmed report. Explore recurring hazards, repeated location names, and semantically related accounts without assigning blame to drivers.

## Run locally

Requires Node.js 22.12 or newer. Current desktop Chrome or Edge is recommended for recording and browser AI.

```sh
cd "/Users/rohith/Documents/Indhuja NIW/driver-near-miss-reporter"
npm ci
npm run setup
npm run dev
```

Open [http://127.0.0.1:5190](http://127.0.0.1:5190). The setup command downloads about 65 MiB of pinned speech/embedding model files and copies the installed ONNX WebAssembly runtime. It verifies each model file against its source revision and hash before replacing it. After setup, browser inference and fonts are served locally; there are no API keys or paid services.

```sh
npm run build
npm run preview
```

Preview runs on port 4190. Run setup before building so the generated assets are included in `dist/`. Basic typed reports and demo reports do not require model downloads. Camera access is never requested. Microphone recording requires localhost or HTTPS.

## Workflow

1. Once safely parked, **Record a note**, **Upload audio**, or type an account. Audio is limited to two minutes and 25 MB. The speech model is English-only.
2. Select **Transcribe on device** for audio. Correct the transcript, especially street names, negation, and outcomes. Audio remains only in memory and can be removed after transcription.
3. Choose **Basic suggestions** or **Local language model · Ollama**, then select **Prepare report**. Basic suggestions are a keyword-based baseline, clearly labeled as rules rather than AI extraction.
4. Review the title, location, hazard category, driver response, outcome, and supporting quote. Unknown details can stay blank. The supporting quote, if supplied, must occur exactly in the transcript.
5. Check the review confirmation and save. Edits to report fields or the transcript reset this confirmation. A saved report can be opened, reviewed again, and updated without creating a duplicate.
6. Search or filter the library. JSON and CSV exports contain all reports matching the current dataset and filters. CSV cells are escaped and protected against spreadsheet formula execution.
7. Select **Find related reports** for local AI semantic comparison. Hazard counts and repeated-location views update without AI inference.

**Try an example** creates a fictional draft. **Load demo reports** adds five fictional reviewed examples once; repeated clicks do not duplicate them. Synthetic records are always kept in the separate **Demo reports** view, including edited examples. They never contribute to **My reports** counts or exports.

## Local language-model extraction

Ollama is optional. If it is installed and running with a local model, select **Local language model · Ollama** and choose an installed model. Refresh reloads the installed-model list. The app does not install a model automatically.

The development and preview servers proxy only `/ollama` to the fixed loopback service `http://127.0.0.1:11434`. Text is sent to that local service only when **Prepare report** is selected in Ollama mode. Audio is never sent to Ollama. The request uses a JSON schema, deterministic sampling, a bounded output length, and a cancellation timeout. Returned fields undergo Zod validation; quoted evidence is checked against the transcript. Semantic accuracy still requires human review.

For static hosting, typed reporting and browser AI work when the local assets are hosted with the app. Ollama extraction additionally requires an equivalent local proxy. Do not expose this development proxy as a public service.

## AI components

| Component | Implementation | What it does |
| --- | --- | --- |
| Speech transcription | Quantized `Xenova/whisper-tiny.en` | Converts English audio into editable text, in a Web Worker |
| Report extraction | Optional local Ollama model | Suggests schema-constrained report fields from text |
| Offline extraction baseline | Explicit keyword rules | Produces editable suggestions; does not infer a missing outcome |
| Semantic comparison | Quantized `Xenova/all-MiniLM-L6-v2` | Embeds accounts and identifies candidate related report pairs |

Model IDs, immutable revisions, byte sizes, and hashes are in `scripts/model-manifest.json`. `npm run setup` verifies SHA-256 for LFS model blobs and Git blob SHA-1 for small configuration/tokenizer files. Model assets are generated locally and ignored by Git. Dependencies and fonts are locked in `package-lock.json`.

Semantic comparison uses up to 50 reports from the current filtered view, newest first. Each input contains the title and the first 100 words of the account; the model may apply its tokenizer length limit. The UI shows up to 20 pairs at cosine similarity of at least 0.55. This is an exploratory threshold, not a calibrated probability. Similar language can describe different events, and opposite or negated accounts can still have similar embeddings. No automatic root cause, fault, or severity is assigned.

Location recurrence uses case-insensitive, whitespace-normalized text names. It does not geocode addresses or assume similarly named streets are the same place. Counts describe the collected reports, not crash rates or exposure-adjusted risk.

## Storage and privacy

- Reports persist in IndexedDB in this browser under the app's origin. Different browsers, ports, or hostnames have separate libraries.
- Audio blobs, recordings, and decoded speech samples stay in memory. They are not stored in IndexedDB or exported.
- Saved reports contain the reviewed transcript, fields, exact quote, source, extraction method, timestamps, and confirmation. They are not independently verified incident records.
- Model and runtime files are served locally. Remote model loading is disabled. No analytics or third-party fonts are requested.
- Recording starts only after a button press and browser permission. Recording is capped at two minutes; hiding the tab discards the in-progress recording and releases the microphone. Cancelling a pending permission request also releases any late-arriving stream.
- The draft is not saved automatically. Navigation warns about unsaved work. A new draft or opening another report asks before discarding edits.
- Delete removes a saved report after an in-app confirmation. Export before clearing browser site data if you need to keep reports.
- This is a single-user local prototype. It has no authentication, encrypted database, shared fleet server, identity verification, or managed retention policy.

## Checks

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run check
```

The tests cover schema and evidence validation, dataset separation, CSV escaping, similarity calculations, saved-report persistence/edit/delete flows, microphone failures, synthetic recording, mobile layout, and the real local speech and embedding models. The Ollama browser test uses a mock response so the automated suite does not require an installed LLM. A local LLM can also be tested through the normal UI.

`tests/fixtures/near-miss.wav` is a synthetic spoken test account generated with macOS text-to-speech, not a driver's recording. Its text is: “At Oak Street, a parked truck blocked the exit. I stopped and waited for it to move.” No physical microphone or real participant is needed for automated tests. Screenshots stay in the ignored `test-results/` directory.

## Research next steps

Evaluate with consented accounts across accents, background noise, unclear locations, negations, and ambiguous outcomes. Measure transcription error, field extraction correctness, unsupported statements, correction effort, and reviewer agreement on suggested report pairs. Keep the evaluation set separate from tuning examples. Software tests and synthetic demos do not establish real-world safety improvements.

## Source map

```text
src/audio.ts          Recording, cleanup, decoding, mono 16 kHz resampling
src/ai.worker.ts      Speech and embedding inference
src/ai-client.ts      Worker lifecycle, progress, cancellation
src/ollama.ts         Local LLM extraction and output validation
src/domain.ts         Report schema, suggestions, filtering, analytics, CSV
src/storage.ts        Transactional IndexedDB persistence
src/demo.ts           Explicitly fictional examples
src/view.ts           Page structure
src/main.ts           Review workflow, state, library, exports
src/style.css         Responsive interface
scripts/              Verified local model and runtime installation
tests/                Unit, browser, and synthetic-audio checks
```

## References and licenses

- [Transformers.js](https://huggingface.co/docs/transformers.js/) and [pipeline reference](https://huggingface.co/docs/transformers.js/api/pipelines)
- [Whisper Tiny English model](https://huggingface.co/Xenova/whisper-tiny.en)
- [MiniLM sentence embedding model](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- Consult each model card and installed dependency's license for applicable terms. Font license files are included in the Fontsource packages.
