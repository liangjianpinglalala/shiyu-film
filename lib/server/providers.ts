import { config } from "./config";
import { unavailable } from "./errors";
import type { Capabilities, JobInput } from "../shared/types";
export interface StageResult {
  kind: "demo-manifest" | "video";
  data: Record<string, unknown>;
}
export interface GenerationProvider {
  runStage(input: {
    jobId: string;
    stage: number;
    input: JobInput;
    previous: StageResult | null;
    signal: AbortSignal;
    idempotencyKey: string;
  }): Promise<StageResult>;
}
// Live adapters must be explicitly implemented and selected; configuration alone never enables fake success.
export function generationProvider(): GenerationProvider {
  if (config().mode !== "demo")
    return {
      async runStage() {
        throw unavailable("AI 制作服务尚未配置。");
      },
    };
  return {
    async runStage({ jobId, stage, input, signal }) {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const abort = () => {
          clearTimeout(t);
          reject(signal.reason);
        };
        const t = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, config().stepDelay);
        signal.addEventListener("abort", abort, { once: true });
      });
      return {
        kind: "demo-manifest",
        data: {
          jobId,
          stage,
          input,
          notice: "仅为后台流程演示，未生成配音、图片或 MP4。",
        },
      };
    },
  };
}
export function capabilities(): Capabilities {
  const demo = config().mode === "demo";
  const scriptReady = Boolean(config().openaiApiKey);
  const mediaReady = scriptReady && config().blobReady;
  return {
    mode: demo ? "demo" : "live",
    authReady: config().secret.length >= 32,
    scriptReady,
    imageReady: mediaReady,
    speechReady: mediaReady,
    storageReady: config().blobReady,
    generationReady: demo,
    message: demo
      ? "账号登录已启用 · 动画为演示流程"
      : scriptReady
        ? "AI 脚本服务已就绪 · 成片服务待配置"
        : "AI 制作服务尚未配置",
  };
}
