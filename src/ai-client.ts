import type { AIRequest, AIResponse } from './ai-types';

type Result = Extract<AIResponse, { type: 'transcript' | 'embeddings' }>;
export class LocalAI {
  private worker: Worker | null = null;
  private reject: ((reason: Error) => void) | null = null;
  private timeout = 0;

  run(request: AIRequest, progress: (message: string) => void): Promise<Result> {
    if (this.reject) return Promise.reject(new Error('Another AI operation is running.'));
    this.worker ??= new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      this.reject = reject;
      this.timeout = window.setTimeout(() => this.cancel('AI processing timed out. Your draft is unchanged.'), 180000);
      this.worker!.onerror = () => this.cancel('The AI worker could not run. Check model setup and browser support.');
      this.worker!.onmessage = ({ data }: MessageEvent<AIResponse>): void => {
        if (data.type === 'progress') { progress(data.message); return; }
        window.clearTimeout(this.timeout);
        this.reject = null;
        if (data.type === 'error') {
          this.worker?.terminate();
          this.worker = null;
          reject(new Error(data.message));
        } else resolve(data);
      };
      this.worker!.postMessage(request);
    });
  }

  cancel(message = 'AI processing cancelled. Your draft is unchanged.'): void {
    window.clearTimeout(this.timeout);
    this.worker?.terminate();
    this.worker = null;
    this.reject?.(new Error(message));
    this.reject = null;
  }
}
