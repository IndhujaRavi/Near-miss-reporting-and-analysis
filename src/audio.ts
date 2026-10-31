export const MAX_AUDIO_SECONDS = 120;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('Choose an audio file under 25 MB.');
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration > MAX_AUDIO_SECONDS) throw new Error('Choose an audio clip no longer than two minutes.');
    if (buffer.duration < 0.25) throw new Error('The audio clip is too short.');
    const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * 16000), 16000);
    const mono = offline.createBuffer(1, buffer.length, buffer.sampleRate);
    const samples = mono.getChannelData(0);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const input = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] += input[i] / buffer.numberOfChannels;
    }
    const source = offline.createBufferSource();
    source.buffer = mono;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const audio = rendered.getChannelData(0);
    const rms = Math.sqrt(audio.reduce((sum, value) => sum + value * value, 0) / audio.length);
    if (rms < 0.0005) throw new Error('The clip appears silent. Check the microphone or choose another recording.');
    return audio;
  } finally { await context.close(); }
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private frame = 0;
  private timeout = 0;
  private cancelled = false;
  private chunks: Blob[] = [];

  constructor(private onAudio: (blob: Blob) => void, private onLevel: (level: number, seconds: number) => void, private onError: (message: string) => void) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Audio recording needs localhost or HTTPS and a supported browser. You can upload a file or type instead.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (this.cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
    this.stream = stream;
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((value) => MediaRecorder.isTypeSupported(value));
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = ({ data }): void => { if (data.size) this.chunks.push(data); };
    this.recorder.onstop = (): void => {
      if (!this.cancelled) this.onAudio(new Blob(this.chunks, { type: this.recorder!.mimeType }));
      this.release();
    };
    this.recorder.onerror = (): void => { this.cancel(); this.onError('Recording failed. Your existing draft was preserved.'); };
    stream.getAudioTracks()[0].onended = (): void => this.stop();
    this.context = new AudioContext();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 256;
    this.context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const startedAt = performance.now();
    const draw = (): void => {
      analyser.getByteTimeDomainData(data);
      const level = Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length);
      this.onLevel(level, (performance.now() - startedAt) / 1000);
      this.frame = requestAnimationFrame(draw);
    };
    this.recorder.start();
    draw();
    this.timeout = window.setTimeout(() => this.stop(), MAX_AUDIO_SECONDS * 1000);
  }

  stop(): void { if (this.recorder?.state === 'recording') this.recorder.stop(); }
  cancel(): void { this.cancelled = true; this.stop(); this.release(); }
  private release(): void {
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.timeout);
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') void this.context.close();
  }
}
