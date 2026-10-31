import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import './style.css';
import { LocalAI } from './ai-client';
import { decodeAudio, MAX_AUDIO_BYTES, VoiceRecorder } from './audio';
import { createDemoReports, SAMPLE_TRANSCRIPT } from './demo';
import { categoryCounts, filterReports, recurringLocations, ReportSchema, reportsCsv, similarPairs, suggestFields, verifyEvidence, type Report, type ReportFields, type Source } from './domain';
import { extractWithOllama, listModels } from './ollama';
import { readReports, writeReports } from './storage';
import { escapeHtml as escape, layout, node, setText } from './view';

node('app').innerHTML = layout();
const ai = new LocalAI();
let reports: Report[] = [];
let storageReady = false;
let dataset: 'real' | 'demo' = 'real';
let source: Source = 'typed';
let extraction = 'Manual entry';
let editId: string | null = null;
let dirty = false;
let busy = false;
let recording = false;
let recorder: VoiceRecorder | null = null;
let audioBlob: Blob | null = null;
let audioUrl: string | null = null;
let pendingDelete: string | null = null;
let pendingDraftAction: (() => void) | null = null;
let aborter: AbortController | null = null;
let runId = 0;
const transcript = node<HTMLTextAreaElement>('transcript');
const form = node<HTMLFormElement>('report-form');
const canvas = node<HTMLCanvasElement>('waveform');
const context = canvas.getContext('2d')!;
const wave = Array<number>(70).fill(0);

function notice(message: string): void { setText('notice', message); node('notice').hidden = !message; }
function value(id: string): string { return node<HTMLInputElement>(id).value; }
function setValue(id: string, text: string): void { node<HTMLInputElement>(id).value = text; }
function clock(seconds: number): string { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
function sourceLabel(): string { return ({ typed: 'Typed account', recorded: 'Voice recording', uploaded: 'Uploaded audio', demo: 'Synthetic example' })[source]; }

function updateControls(): void {
  const locked = busy || recording;
  for (const id of ['record', 'audio-upload', 'extract', 'sample', 'new-draft', 'load-demo', 'refresh-models', 'extraction-mode', 'ollama-model', 'transcribe', 'discard-audio']) node<HTMLButtonElement>(id).disabled = locked;
  transcript.readOnly = locked;
  for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')) field.disabled = locked;
  node<HTMLButtonElement>('save').disabled = locked || !storageReady;
  node<HTMLButtonElement>('load-demo').disabled = locked || !storageReady;
  node('processing').hidden = !busy;
  node('record').hidden = recording;
  node('stop-recording').hidden = !recording;
  node('cancel-recording').hidden = !recording;
  node('record-dot').classList.toggle('active', recording);
  node<HTMLButtonElement>('find-patterns').disabled = locked || visibleReports().length < 2;
  for (const button of node('report-list').querySelectorAll<HTMLButtonElement>('button')) button.disabled = locked;
  node('source-badge').className = `pill ${source === 'demo' ? 'demo' : 'muted'}`;
  setText('source-badge', sourceLabel());
}

function markDirty(): void {
  dirty = true;
  node<HTMLInputElement>('confirmed').checked = false;
  setText('review-badge', 'Needs review');
}

function writeFields(fields: ReportFields): void {
  for (const key of ['title', 'location', 'category', 'maneuver', 'outcome', 'evidence'] as const) setValue(key, fields[key]);
  markDirty();
}

function discardAudio(): void {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  audioBlob = null;
  node<HTMLAudioElement>('audio-player').removeAttribute('src');
  node('audio-preview').hidden = true;
  node<HTMLInputElement>('audio-upload').value = '';
}

function receiveAudio(blob: Blob, nextSource: Source, name: string): void {
  discardAudio();
  audioBlob = blob;
  source = nextSource;
  audioUrl = URL.createObjectURL(blob);
  node<HTMLAudioElement>('audio-player').src = audioUrl;
  node('audio-preview').hidden = false;
  setText('audio-name', name);
  markDirty();
  updateControls();
}

function clearDraft(): void {
  discardAudio();
  transcript.value = '';
  form.reset();
  setValue('category', 'Other / unclear');
  setValue('outcome', 'Not stated');
  editId = null;
  source = 'typed';
  extraction = 'Manual entry';
  dirty = false;
  setText('character-count', '0 / 6,000');
  setText('review-badge', 'Draft');
  setText('review-intro', 'Details are suggestions until you review them. Unknown information can stay blank.');
  setText('save', 'Save reviewed report ↗');
  setText('save-help', 'Stored in this browser. Raw audio is never saved with a report.');
  setText('record-label', 'Ready to listen');
  setText('record-time', '00:00 / 02:00');
  updateControls();
}

function replaceDraft(action: () => void): void {
  if (!dirty) { action(); return; }
  pendingDraftAction = action;
  node<HTMLDialogElement>('draft-dialog').showModal();
}

function visibleReports(): Report[] { return filterReports(reports, value('search'), value('category-filter'), dataset); }

function renderLibrary(): void {
  const filtered = visibleReports();
  setText('report-count', String(filtered.length));
  setText('nav-total', String(reports.filter((report) => report.source !== 'demo').length));
  setText('dataset-note', dataset === 'demo' ? 'SYNTHETIC DATA · These examples are fictional and are not included in My reports.' : 'Your reviewed reports. Demo data is kept in a separate view.');
  node('dataset-note').classList.toggle('demo-note', dataset === 'demo');
  node('real-data').setAttribute('aria-pressed', String(dataset === 'real'));
  node('demo-data').setAttribute('aria-pressed', String(dataset === 'demo'));
  node('empty-state').hidden = filtered.length > 0;
  node('library-limit').hidden = filtered.length <= 100;
  node<HTMLButtonElement>('export-json').disabled = filtered.length === 0;
  node<HTMLButtonElement>('export-csv').disabled = filtered.length === 0;
  const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  node('report-list').innerHTML = filtered.slice(0, 100).map((report) => `
    <article class="report-row"><div class="report-icon" aria-hidden="true">↗</div><div class="report-content"><div class="report-meta"><span class="pill">${escape(report.category)}</span>${report.source === 'demo' ? '<span class="pill demo">Demo</span>' : ''}<span class="saved-time">Saved ${escape(dateFormatter.format(new Date(report.createdAt)))}</span></div><h3>${escape(report.title)}</h3><p class="report-excerpt">${escape(report.transcript.slice(0, 200))}${report.transcript.length > 200 ? '…' : ''}</p><div class="report-foot"><span>⌖ ${escape(report.location || 'Location not provided')}</span><span>${escape(report.outcome)}</span></div></div><div class="report-actions"><button class="text-button" data-open="${report.id}" aria-label="Review ${escape(report.title)}">Review ↗</button><button class="text-button quiet" data-delete="${report.id}" aria-label="Delete ${escape(report.title)}">Delete</button></div></article>`).join('');
  renderPatterns(filtered);
  updateControls();
}

function renderPatterns(filtered: Report[]): void {
  setText('patterns-dataset', dataset === 'demo' ? 'Synthetic examples' : 'My reports');
  setText('pattern-total', `${filtered.length} REPORTS`);
  const counts = categoryCounts(filtered);
  node('hazard-bars').innerHTML = counts.length ? counts.map(({ category, count }) => `<div class="bar-item"><div><span>${escape(category)}</span><strong>${count}</strong></div><div class="bar-track"><span style="width:${count / filtered.length * 100}%"></span></div></div>`).join('') : '<p class="pattern-empty">Reviewed reports will reveal the mix of reported hazards.</p>';
  const locations = recurringLocations(filtered);
  node('location-list').innerHTML = locations.length ? locations.map(({ location, count }) => `<div class="location-row"><span aria-hidden="true">⌖</span><div><strong>${escape(location)}</strong><small>${count} reports with this location name</small></div><b>${count}</b></div>`).join('') : '<p class="pattern-empty">No repeated location names in this view yet. Location matches are not geocoded.</p>';
  node('semantic-results').innerHTML = '<p class="helper">Run a comparison to find candidate pairs for review. Similarity is not proof of the same hazard or cause.</p>';
  setText('semantic-note', 'Uses the latest 50 matching reports. Each model input includes the title and the first 100 words of the account.');
}

async function runTask(action: (signal: AbortSignal, progress: (message: string) => void) => Promise<void>): Promise<void> {
  if (busy || recording) return;
  busy = true;
  const currentRun = ++runId;
  aborter = new AbortController();
  const signal = AbortSignal.any([aborter.signal, AbortSignal.timeout(180000)]);
  updateControls();
  notice('');
  const progress = (message: string): void => setText('processing-message', message);
  progress('Preparing…');
  try { await action(signal, progress); }
  catch (error) { if (currentRun === runId) notice(error instanceof Error ? error.message : 'The operation failed. Your draft is unchanged.'); }
  finally {
    if (currentRun === runId) { busy = false; aborter = null; updateControls(); }
  }
}

function cancelTask(): void { aborter?.abort(new Error('Processing cancelled. Your draft is unchanged.')); ai.cancel(); }

node('record').addEventListener('click', async () => {
  recording = true;
  markDirty();
  updateControls();
  node<HTMLButtonElement>('stop-recording').disabled = true;
  setText('record-label', 'Requesting microphone…');
  notice('');
  const session = new VoiceRecorder((blob) => {
    if (recorder !== session) return;
    recording = false;
    recorder = null;
    receiveAudio(blob, 'recorded', 'Recorded fieldnote');
    setText('record-label', 'Recording ready for transcription');
    wave.fill(0); drawWave();
  }, (level, seconds) => {
    wave.shift(); wave.push(level); drawWave();
    setText('record-time', `${clock(seconds)} / 02:00`);
  }, (message) => { stopRecording(true); notice(message); });
  recorder = session;
  try {
    await session.start();
    if (recorder !== session) return;
    node<HTMLButtonElement>('stop-recording').disabled = false;
    setText('record-label', 'Recording your account');
  } catch (error) {
    if (recorder !== session) return;
    stopRecording(true);
    notice(`Microphone could not start: ${error instanceof Error ? error.message : 'Permission denied.'} You can upload audio or type your account.`);
  }
});

function stopRecording(discard: boolean): void {
  if (discard) {
    recorder?.cancel(); recorder = null; recording = false;
    setText('record-label', 'Ready to listen');
    wave.fill(0); drawWave(); updateControls();
  } else {
    recorder?.stop();
    node<HTMLButtonElement>('stop-recording').disabled = true;
  }
}
node('stop-recording').addEventListener('click', () => stopRecording(false));
node('cancel-recording').addEventListener('click', () => stopRecording(true));
node('discard-audio').addEventListener('click', discardAudio);
node('audio-upload').addEventListener('change', () => {
  const file = node<HTMLInputElement>('audio-upload').files?.[0];
  if (!file) return;
  if (file.size > MAX_AUDIO_BYTES) { notice('Choose an audio file under 25 MB.'); return; }
  receiveAudio(file, 'uploaded', file.name);
  notice('Audio loaded. Select Transcribe on device to create an editable transcript.');
});
node('transcribe').addEventListener('click', () => {
  if (!audioBlob) return;
  const blob = audioBlob;
  void runTask(async (signal, progress) => {
    progress('Decoding the audio on this device…');
    const audio = await decodeAudio(blob);
    signal.throwIfAborted();
    const result = await ai.run({ type: 'transcribe', audio, baseUrl: new URL(import.meta.env.BASE_URL, location.href).href }, progress);
    signal.throwIfAborted();
    if (result.type !== 'transcript') throw new Error('Unexpected speech model response.');
    if (!result.text) throw new Error('No speech was found. Try a clearer recording or type your account.');
    transcript.value = result.text.slice(0, 6000);
    transcriptChanged();
    notice('Transcript ready. Correct names, locations, and any missed words before preparing the report.');
  });
});

function transcriptChanged(): void {
  markDirty();
  setText('character-count', `${transcript.value.length.toLocaleString()} / 6,000`);
  extraction = 'Manual review';
  setText('review-intro', 'Review the current account and suggested fields together. Prepare the report again if the account changed.');
}
transcript.addEventListener('input', transcriptChanged);
form.addEventListener('input', (event) => { if ((event.target as HTMLElement).id !== 'confirmed') markDirty(); });
node('sample').addEventListener('click', () => replaceDraft(() => {
  clearDraft(); source = 'demo'; transcript.value = SAMPLE_TRANSCRIPT; transcriptChanged(); updateControls();
  notice('This is a fictional example. It will be saved only in Demo reports.');
}));
node('new-draft').addEventListener('click', () => replaceDraft(clearDraft));
node('keep-draft').addEventListener('click', () => { pendingDraftAction = null; node<HTMLDialogElement>('draft-dialog').close(); });
node('discard-draft').addEventListener('click', () => {
  node<HTMLDialogElement>('draft-dialog').close();
  const action = pendingDraftAction; pendingDraftAction = null; action?.();
});

node('extract').addEventListener('click', () => {
  const account = transcript.value.trim();
  if (account.length < 10) { notice('Add at least a short sentence describing what happened.'); transcript.focus(); return; }
  if (value('extraction-mode') === 'rules') {
    writeFields(suggestFields(account)); extraction = 'Basic rule-based suggestions';
    setText('review-intro', 'Basic suggestions are based on keywords, not a language model. Review negation, the hazard category, and every field.');
    notice('Suggestions prepared. Confirm or correct the details on the right.');
    return;
  }
  const model = value('ollama-model');
  if (!model) { notice('Select an installed Ollama model, or use Basic suggestions.'); return; }
  void runTask(async (signal, progress) => {
    progress(`Extracting details with local ${model}…`);
    const fields = await extractWithOllama(account, model, signal);
    signal.throwIfAborted();
    writeFields(fields); extraction = `Ollama: ${model}`;
    setText('review-intro', `Suggested by local ${model}. The evidence quote was checked against the account; all details still need your review.`);
    notice('Local AI suggestions are ready for review. Nothing has been saved yet.');
  });
});

async function refreshModels(): Promise<void> {
  const button = node<HTMLButtonElement>('refresh-models');
  button.disabled = true;
  try {
    const models = await listModels();
    node<HTMLSelectElement>('ollama-model').replaceChildren(...models.map((model) => new Option(model, model)));
    if (!models.length) notice('Ollama is running but no models are installed. Use Basic suggestions or install a local model.');
  } catch (error) { notice(error instanceof Error ? error.message : 'Could not reach Ollama. Use Basic suggestions or start the local service.'); }
  finally { button.disabled = busy || recording; }
}
node('extraction-mode').addEventListener('change', () => {
  const isOllama = value('extraction-mode') === 'ollama';
  node('ollama-controls').hidden = !isOllama;
  if (isOllama) void refreshModels();
});
node('refresh-models').addEventListener('click', () => { void refreshModels(); });
node('cancel-ai').addEventListener('click', cancelTask);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!storageReady || busy || recording) return;
  const now = new Date().toISOString();
  const old = reports.find((report) => report.id === editId);
  const parsed = ReportSchema.safeParse({
    id: editId ?? crypto.randomUUID(), transcript: transcript.value,
    title: value('title'), location: value('location'), category: value('category'), maneuver: value('maneuver'), outcome: value('outcome'), evidence: value('evidence'),
    occurredAt: value('occurred-at'), source, extraction,
    createdAt: old?.createdAt ?? now, updatedAt: now,
    confirmed: node<HTMLInputElement>('confirmed').checked,
  });
  if (!parsed.success) { notice(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' · ')); return; }
  try { verifyEvidence(parsed.data, parsed.data.transcript); }
  catch (error) { notice((error as Error).message); return; }
  busy = true; updateControls(); setText('processing-message', 'Saving reviewed report…');
  try {
    await writeReports([parsed.data]);
    reports = [parsed.data, ...reports.filter((report) => report.id !== parsed.data.id)];
    dataset = source === 'demo' ? 'demo' : 'real';
    clearDraft(); renderLibrary();
    notice('Reviewed report saved on this browser. Export the library to keep a portable copy.');
  } catch (error) { notice((error as Error).message); }
  finally { busy = false; updateControls(); }
});

node('load-demo').addEventListener('click', async () => {
  if (!storageReady) return;
  if (reports.some((report) => report.source === 'demo')) { dataset = 'demo'; renderLibrary(); notice('Existing demo reports are shown. No duplicates were added.'); return; }
  busy = true; updateControls(); setText('processing-message', 'Adding synthetic examples…');
  try { const demos = createDemoReports(); await writeReports(demos); reports.push(...demos); dataset = 'demo'; renderLibrary(); notice('Five fictional examples loaded into the separate Demo reports view.'); }
  catch (error) { notice((error as Error).message); }
  finally { busy = false; updateControls(); }
});
for (const [id, next] of [['real-data', 'real'], ['demo-data', 'demo']] as const) node(id).addEventListener('click', () => { dataset = next; renderLibrary(); });
node('search').addEventListener('input', renderLibrary);
node('category-filter').addEventListener('change', renderLibrary);
node('report-list').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!target || busy || recording) return;
  const report = reports.find((item) => item.id === (target.dataset.open ?? target.dataset.delete));
  if (!report) return;
  if (target.dataset.delete) {
    pendingDelete = report.id;
    setText('delete-title', report.title);
    node<HTMLDialogElement>('delete-dialog').showModal();
  } else replaceDraft(() => {
    clearDraft(); editId = report.id; source = report.source; extraction = report.extraction;
    transcript.value = report.transcript;
    setText('character-count', `${report.transcript.length.toLocaleString()} / 6,000`);
    writeFields(report); setValue('occurred-at', report.occurredAt);
    dirty = false;
    node<HTMLInputElement>('confirmed').checked = false;
    setText('save', 'Save reviewed changes ↗');
    setText('review-intro', `Saved report · ${report.extraction}. Review the details again before saving changes.`);
    setText('save-help', source === 'demo' ? 'This is a synthetic report. Edits remain in the Demo reports view.' : 'Saving updates this report; it does not create a duplicate.');
    updateControls(); node('capture').scrollIntoView({ behavior: 'smooth' });
  });
});
node('cancel-delete').addEventListener('click', () => { pendingDelete = null; node<HTMLDialogElement>('delete-dialog').close(); });
node('confirm-delete').addEventListener('click', async () => {
  if (!pendingDelete) return;
  const id = pendingDelete;
  node<HTMLButtonElement>('confirm-delete').disabled = true;
  try {
    await writeReports([], [id]);
    reports = reports.filter((report) => report.id !== id);
    if (editId === id) {
      editId = null;
      dirty = true;
      setText('save', 'Save reviewed report ↗');
      setText('save-help', 'The saved report was deleted. This draft is preserved and will save as a new report.');
    }
    renderLibrary(); node<HTMLDialogElement>('delete-dialog').close(); pendingDelete = null;
    notice('Report deleted from this browser.');
  } catch (error) { notice((error as Error).message); }
  finally { node<HTMLButtonElement>('confirm-delete').disabled = false; }
});

function download(content: string, extension: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url;
  link.download = `routewatch-fieldnotes-${dataset}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
node('export-json').addEventListener('click', () => download(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), dataset, filters: { search: value('search'), category: value('category-filter') }, reports: visibleReports() }, null, 2), 'json', 'application/json'));
node('export-csv').addEventListener('click', () => download(reportsCsv(visibleReports()), 'csv', 'text/csv;charset=utf-8'));
node('find-patterns').addEventListener('click', () => {
  const selected = visibleReports().slice(0, 50);
  const snapshot = JSON.stringify(selected);
  void runTask(async (signal, progress) => {
    const texts = selected.map((report) => `${report.title}. ${report.transcript.split(/\s+/).slice(0, 100).join(' ')}`);
    const result = await ai.run({ type: 'embed', texts, baseUrl: new URL(import.meta.env.BASE_URL, location.href).href }, progress);
    signal.throwIfAborted();
    if (result.type !== 'embeddings') throw new Error('Unexpected semantic model response.');
    if (snapshot !== JSON.stringify(visibleReports().slice(0, 50))) { notice('The library view changed. Run the comparison again for the current reports.'); return; }
    const pairs = similarPairs(selected.map((report) => report.id), result.embeddings);
    const byId = new Map(selected.map((report) => [report.id, report]));
    node('semantic-results').innerHTML = pairs.length ? pairs.map((pair) => `<div class="semantic-pair"><div><strong>${escape(byId.get(pair.left)!.title)}</strong><span>↔</span><strong>${escape(byId.get(pair.right)!.title)}</strong></div><span class="similarity">${pair.similarity.toFixed(2)}<small>cosine similarity</small></span></div>`).join('') : '<p class="helper">No pairs exceeded the exploratory similarity threshold of 0.55. This does not rule out recurring hazards.</p>';
    setText('semantic-note', `Compared ${selected.length} ${dataset === 'demo' ? 'synthetic' : 'reviewed'} reports using local MiniLM. Title + first 100 words; up to 20 pairs at cosine similarity ≥ 0.55. Scores are not probabilities.`);
    notice('Semantic comparison complete. These are candidate relationships for human review.');
  });
});

function drawWave(): void {
  context.clearRect(0, 0, 600, 100);
  for (const [index, level] of wave.entries()) {
    const height = Math.max(4, Math.min(82, level * 450));
    context.fillStyle = recording ? '#bd7455' : '#b4c0c5';
    context.beginPath(); context.roundRect(index * 8.5 + 3, 50 - height / 2, 3, height, 2); context.fill();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && recording) { stopRecording(true); notice('Recording was discarded when this tab became hidden. Your existing draft is unchanged.'); }
});
window.addEventListener('beforeunload', (event) => {
  if (dirty || recording || busy) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => { recorder?.cancel(); ai.cancel(); aborter?.abort(); });

clearDraft(); drawWave(); renderLibrary();
void readReports().then((saved) => { reports = saved; storageReady = true; renderLibrary(); }).catch((error: Error) => notice(error.message));
