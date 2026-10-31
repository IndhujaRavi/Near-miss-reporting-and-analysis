import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { AIRequest, AIResponse } from './ai-types';

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let embedder: FeatureExtractionPipeline | null = null;
function respond(message: AIResponse): void { self.postMessage(message); }

self.onmessage = async ({ data }: MessageEvent<AIRequest>): Promise<void> => {
  try {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    // Root-relative paths let the library discover same-origin model metadata
    // while external model requests remain disabled.
    env.localModelPath = new URL('models/', data.baseUrl).pathname;
    env.backends.onnx.wasm!.wasmPaths = {
      mjs: `${data.baseUrl}wasm/ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${data.baseUrl}wasm/ort-wasm-simd-threaded.asyncify.wasm`,
    };
    env.backends.onnx.wasm!.numThreads = 1;
    if (data.type === 'transcribe') {
      if (!transcriber) {
        respond({ type: 'progress', message: 'Loading the local speech model… First use takes a moment.' });
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { device: 'wasm', dtype: 'q8' });
      }
      respond({ type: 'progress', message: 'Transcribing on this device…' });
      const output = await transcriber(data.audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
      const result = Array.isArray(output) ? output[0] : output;
      respond({ type: 'transcript', text: result.text.trim() });
    } else {
      if (!embedder) {
        respond({ type: 'progress', message: 'Loading the local semantic model…' });
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'wasm', dtype: 'q8' });
      }
      const embeddings: number[][] = [];
      for (const [index, text] of data.texts.entries()) {
        respond({ type: 'progress', message: `Comparing report ${index + 1} of ${data.texts.length}…` });
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        embeddings.push(Array.from(output.data as Float32Array));
      }
      respond({ type: 'embeddings', embeddings });
    }
  } catch (error) {
    respond({ type: 'error', message: `${error instanceof Error ? error.message : 'Local AI failed.'} Check that npm run setup completed.` });
  }
};
