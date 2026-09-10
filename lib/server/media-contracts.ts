import type { JobInput, StoryboardScript } from "../shared/types";
/** Contracts for future adapters. No credentials or provider calls are implemented here. */
export interface Source {
  title: string;
  url: string;
  excerpt?: string;
}
export interface Scene {
  id: string;
  narration: string;
  visualPrompt: string;
  durationSeconds: number;
}
export interface Script extends StoryboardScript {}
export interface CallContext {
  signal: AbortSignal;
  idempotencyKey: string;
  maxCostMinorUnits: number;
}
export interface ScriptProvider {
  create(input: JobInput, context: CallContext): Promise<Script>;
}
export interface ImageProvider {
  create(
    scene: Scene,
    referenceKeys: string[],
    context: CallContext,
  ): Promise<{ assetKey: string; mimeType: string }>;
}
export interface SpeechProvider {
  synthesize(
    text: string,
    context: CallContext,
  ): Promise<{
    assetKey: string;
    durationMs: number;
    segments: { text: string; startMs: number; endMs: number }[];
  }>;
}
export interface RenderProvider {
  render(
    input: {
      script: Script;
      imageKeys: string[];
      audioKeys: string[];
      ratio: JobInput["ratio"];
    },
    context: CallContext,
  ): Promise<{ assetKey: string; durationMs: number; mimeType: "video/mp4" }>;
}
export interface ArtifactStore {
  put(key: string, data: Uint8Array, mimeType: string): Promise<void>;
  read(key: string): Promise<{ data: Uint8Array; mimeType: string }>;
  remove(key: string): Promise<void>;
}
