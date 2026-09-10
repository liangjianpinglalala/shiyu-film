import { config } from "./config";
import { AppError, unavailable } from "./errors";
import { VercelBlobStore } from "./artifact-store";
import type {
  ArtifactStore,
  CallContext,
  ImageProvider,
  Scene,
  SpeechProvider,
} from "./media-contracts";

function safeCode(value: unknown) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
}

async function download(
  request: typeof fetch,
  url: string,
  signal: AbortSignal,
  fallbackMime: string,
) {
  const response = await request(url, { signal });
  if (!response.ok)
    throw new AppError(503, "DASHSCOPE_ASSET_FAILED", "百炼生成素材下载失败");
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type")?.split(";")[0] || fallbackMime,
  };
}

export class DashScopeImageProvider implements ImageProvider {
  constructor(
    private store: ArtifactStore = new VercelBlobStore(),
    private request: typeof fetch = fetch,
    private size = "1696*960",
  ) {}

  async create(scene: Scene, _referenceKeys: string[], context: CallContext) {
    const settings = config();
    if (!settings.dashscopeApiKey) throw unavailable("百炼画面服务尚未配置");
    const response = await this.request(
      `${settings.dashscopeBaseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.dashscopeApiKey}`,
          "Content-Type": "application/json",
        },
        signal: context.signal,
        body: JSON.stringify({
          model: settings.dashscopeImageModel,
          input: {
            messages: [{
              role: "user",
              content: [{ text: `${scene.visualPrompt}。中国古典水墨动画风格，统一角色造型，电影感构图，不要文字、标志或水印。` }],
            }],
          },
          parameters: {
            size: this.size,
            n: 1,
            prompt_extend: true,
            watermark: false,
            negative_prompt: "低画质，模糊，畸形，现代品牌，文字，标志，水印",
          },
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      code?: string;
      output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
    };
    if (!response.ok)
      throw new AppError(
        response.status === 429 ? 429 : 503,
        "DASHSCOPE_IMAGE_FAILED",
        `百炼画面生成失败（${safeCode(payload.code)}）`,
      );
    const url = payload.output?.choices?.[0]?.message?.content?.[0]?.image;
    if (!url) throw new AppError(503, "DASHSCOPE_IMAGE_INVALID", "百炼画面结果为空");
    const asset = await download(this.request, url, context.signal, "image/png");
    const assetKey = `jobs/${context.idempotencyKey}/${scene.id}.png`;
    await this.store.put(assetKey, asset.data, asset.mimeType);
    return { assetKey, mimeType: asset.mimeType };
  }
}

export class DashScopeSpeechProvider implements SpeechProvider {
  constructor(
    private store: ArtifactStore = new VercelBlobStore(),
    private request: typeof fetch = fetch,
  ) {}

  async synthesize(text: string, context: CallContext) {
    const settings = config();
    if (!settings.dashscopeApiKey) throw unavailable("百炼配音服务尚未配置");
    const response = await this.request(
      `${settings.dashscopeBaseUrl}/api/v1/services/audio/tts/SpeechSynthesizer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.dashscopeApiKey}`,
          "Content-Type": "application/json",
        },
        signal: context.signal,
        body: JSON.stringify({
          model: settings.dashscopeSpeechModel,
          input: {
            text,
            voice: settings.dashscopeVoice,
            format: "mp3",
            sample_rate: 24000,
            rate: 0.92,
            language_hints: ["zh"],
          },
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      code?: string;
      output?: { audio?: { url?: string } };
    };
    if (!response.ok)
      throw new AppError(
        response.status === 429 ? 429 : 503,
        "DASHSCOPE_SPEECH_FAILED",
        `百炼配音生成失败（${safeCode(payload.code)}）`,
      );
    const url = payload.output?.audio?.url;
    if (!url) throw new AppError(503, "DASHSCOPE_SPEECH_INVALID", "百炼配音结果为空");
    const asset = await download(this.request, url, context.signal, "audio/mpeg");
    const assetKey = `jobs/${context.idempotencyKey}/narration.mp3`;
    await this.store.put(assetKey, asset.data, asset.mimeType);
    return { assetKey, durationMs: 0, segments: [] };
  }
}
