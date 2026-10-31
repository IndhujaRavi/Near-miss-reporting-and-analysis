export type AIRequest =
  | { type: 'transcribe'; audio: Float32Array; baseUrl: string }
  | { type: 'embed'; texts: string[]; baseUrl: string };
export type AIResponse =
  | { type: 'progress'; message: string }
  | { type: 'transcript'; text: string }
  | { type: 'embeddings'; embeddings: number[][] }
  | { type: 'error'; message: string };
