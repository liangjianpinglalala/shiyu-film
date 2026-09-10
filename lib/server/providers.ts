import { config } from "./config";
import { AppError, unavailable } from "./errors";
import type { Capabilities, JobInput } from "../shared/types";
import type { Script } from "./media-contracts";
import { OpenAIScriptProvider } from "./openai-script";
import { OpenAIImageProvider, OpenAISpeechProvider } from "./media-providers";
import { FfmpegRenderProvider } from "./ffmpeg-render";
export interface StageResult {
  kind: "demo-manifest" | "production-manifest" | "video";
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
  if (config().mode !== "demo") {
    const scriptProvider = new OpenAIScriptProvider();
    const imageProvider = new OpenAIImageProvider();
    const speechProvider = new OpenAISpeechProvider();
    const renderProvider = new FfmpegRenderProvider();
    return {
      async runStage({ jobId, stage, input, previous, signal, idempotencyKey }) {
        if (!capabilities().generationReady)
          throw unavailable("AI 制作服务尚未配置。");
        const data = { ...(previous?.data || {}) } as {
          script?: Script;
          imageKeys?: string[];
          audioKeys?: string[];
          video?: { assetKey: string; durationMs: number; mimeType: "video/mp4" };
        };
        const context = { signal, idempotencyKey, maxCostMinorUnits: 500 };
        if (stage === 0) data.script = await scriptProvider.create(input, context);
        else if (stage === 1) {
          if (!data.script) throw new AppError(409, "MISSING_CHECKPOINT", "缺少脚本检查点");
          data.imageKeys = await Promise.all(
            data.script.scenes.map(async (scene, index) =>
              (await imageProvider.create(scene, data.imageKeys || [], {
                ...context,
                idempotencyKey: `${jobId}-image-${index}`,
              })).assetKey,
            ),
          );
        } else if (stage === 2) {
          if (!data.script) throw new AppError(409, "MISSING_CHECKPOINT", "缺少脚本检查点");
          const narration = data.script.scenes.map((scene) => scene.narration).join("\n");
          data.audioKeys = [(await speechProvider.synthesize(narration, context)).assetKey];
        } else if (stage === 3) {
          if (!data.script || !data.imageKeys || !data.audioKeys)
            throw new AppError(409, "MISSING_CHECKPOINT", "缺少媒体检查点");
          data.video = await renderProvider.render({
            script: data.script,
            imageKeys: data.imageKeys,
            audioKeys: data.audioKeys,
            ratio: input.ratio,
          }, context);
        } else if (!data.video)
          throw new AppError(409, "MISSING_CHECKPOINT", "缺少成片检查点");
        return { kind: "production-manifest", data: data as Record<string, unknown> };
      },
    };
  }
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
    generationReady: demo || mediaReady,
    message: demo
      ? "账号登录已启用 · 动画为演示流程"
      : mediaReady
        ? "AI 自动成片服务已就绪"
        : scriptReady
          ? "AI 脚本服务已就绪 · 成片服务待配置"
        : "AI 制作服务尚未配置",
  };
}
