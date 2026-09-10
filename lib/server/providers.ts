import { config } from "./config";
import { unavailable } from "./errors";
import type { Capabilities, JobInput } from "../shared/types";
import { KimiScriptProvider } from "./kimi-script";
import { DashScopeImageProvider, DashScopeSpeechProvider } from "./dashscope-media";
import { FfmpegRenderProvider } from "./ffmpeg-render";
import type { Script } from "./media-contracts";
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
    const scriptProvider = new KimiScriptProvider();
    return {
      async runStage({ stage, input, previous, signal, idempotencyKey }) {
        const data = { ...(previous?.data || {}) };
        const context = { signal, idempotencyKey, maxCostMinorUnits: 500 };
        if (stage === 0) {
          data.script = await scriptProvider.create(input, context);
        } else if (stage === 1) {
          const script = data.script as Script | undefined;
          if (!script) throw unavailable("分镜脚本尚未生成");
          const imageProvider = new DashScopeImageProvider(
            undefined,
            undefined,
            input.ratio === "9:16 竖屏" ? "960*1696" : "1696*960",
          );
          data.images = await Promise.all(
            script.scenes.map((scene) => imageProvider.create(scene, [], context)),
          );
        } else if (stage === 2) {
          const script = data.script as Script | undefined;
          if (!script) throw unavailable("分镜脚本尚未生成");
          data.audio = await new DashScopeSpeechProvider().synthesize(
            script.scenes.map((scene) => scene.narration).join("。"),
            context,
          );
        } else if (stage === 3) {
          const script = data.script as Script | undefined;
          const images = data.images as Array<{ assetKey: string }> | undefined;
          const audio = data.audio as { assetKey: string } | undefined;
          if (!script || !images?.length || !audio) throw unavailable("成片素材尚未生成");
          data.video = await new FfmpegRenderProvider().render(
            {
              script,
              imageKeys: images.map((image) => image.assetKey),
              audioKeys: [audio.assetKey],
              ratio: input.ratio,
            },
            context,
          );
        } else if (stage === 4) {
          if (!data.video) throw unavailable("视频尚未生成");
          data.completedAt = new Date().toISOString();
        }
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
  const scriptReady = Boolean(config().moonshotApiKey);
  const imageReady = Boolean(config().dashscopeApiKey);
  const speechReady = Boolean(config().dashscopeApiKey);
  const mediaReady = scriptReady && imageReady && speechReady && config().blobReady;
  return {
    mode: demo ? "demo" : "live",
    authReady: config().secret.length >= 32,
    scriptReady,
    imageReady,
    speechReady,
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
