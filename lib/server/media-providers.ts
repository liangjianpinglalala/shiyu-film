import { del, get, put } from "@vercel/blob";
import { config } from "./config";
import { AppError, unavailable } from "./errors";
import type {
  ArtifactStore,
  CallContext,
  ImageProvider,
  Scene,
  SpeechProvider,
} from "./media-contracts";

type Request = typeof fetch;

async function providerFailure(response: Response, label: string, code: string) {
  let detail = "unknown";
  try {
    const payload = (await response.json()) as { error?: { code?: string; type?: string } };
    detail = payload.error?.code || payload.error?.type || detail;
  } catch {}
  return new AppError(
    response.status === 429 ? 429 : 503,
    code,
    `${label}失败（${detail.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)}）`,
  );
}

export class VercelBlobStore implements ArtifactStore {
  async put(key: string, data: Uint8Array, mimeType: string) {
    if (!config().blobReady) throw unavailable("素材存储尚未配置");
    await put(key, Buffer.from(data), {
      access: "private",
      contentType: mimeType,
      addRandomSuffix: false,
    });
  }
  async read(key: string) {
    if (!config().blobReady) throw unavailable("素材存储尚未配置");
    const result = await get(key, { access: "private" });
    if (!result || result.statusCode !== 200)
      throw new AppError(404, "ASSET_NOT_FOUND", "素材不存在");
    return {
      data: new Uint8Array(await new Response(result.stream).arrayBuffer()),
      mimeType: result.blob.contentType || "application/octet-stream",
    };
  }
  async remove(key: string) {
    if (!config().blobReady) throw unavailable("素材存储尚未配置");
    await del(key);
  }
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(
    private store: ArtifactStore = new VercelBlobStore(),
    private request: Request = fetch,
  ) {}
  async create(scene: Scene, referenceKeys: string[], context: CallContext) {
    const settings = config();
    if (!settings.openaiApiKey) throw unavailable("OpenAI 图像服务尚未配置");
    const response = await this.request("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openaiApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": context.idempotencyKey,
      },
      signal: context.signal,
      body: JSON.stringify({
        model: settings.openaiImageModel,
        prompt: `${scene.visualPrompt}\n中国古典绘本动画风格，统一角色设定，画面中不要出现文字。${referenceKeys.length ? "延续前序分镜的角色、服饰和色彩。" : ""}`,
        size: "1536x1024",
        quality: "medium",
        output_format: "png",
      }),
    });
    if (!response.ok)
      throw await providerFailure(response, "AI 画面生成", "IMAGE_PROVIDER_FAILED");
    const payload = (await response.json()) as { data?: Array<{ b64_json?: string }> };
    const encoded = payload.data?.[0]?.b64_json;
    if (!encoded) throw new AppError(503, "IMAGE_PROVIDER_INVALID", "AI 画面结果为空");
    const assetKey = `jobs/${context.idempotencyKey}/scene.png`;
    await this.store.put(assetKey, Buffer.from(encoded, "base64"), "image/png");
    return { assetKey, mimeType: "image/png" };
  }
}

export class OpenAISpeechProvider implements SpeechProvider {
  constructor(
    private store: ArtifactStore = new VercelBlobStore(),
    private request: Request = fetch,
  ) {}
  async synthesize(text: string, context: CallContext) {
    const settings = config();
    if (!settings.openaiApiKey) throw unavailable("OpenAI 配音服务尚未配置");
    const response = await this.request("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openaiApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": context.idempotencyKey,
      },
      signal: context.signal,
      body: JSON.stringify({
        model: settings.openaiSpeechModel,
        voice: settings.openaiVoice,
        input: text,
        instructions: "使用温暖、清晰、适合儿童文化动画的普通话讲述，语速从容。",
        response_format: "mp3",
      }),
    });
    if (!response.ok)
      throw await providerFailure(response, "AI 配音生成", "SPEECH_PROVIDER_FAILED");
    const data = new Uint8Array(await response.arrayBuffer());
    if (!data.length) throw new AppError(503, "SPEECH_PROVIDER_INVALID", "AI 配音结果为空");
    const assetKey = `jobs/${context.idempotencyKey}/narration.mp3`;
    await this.store.put(assetKey, data, "audio/mpeg");
    const durationMs = Math.max(1500, Array.from(text).length * 260);
    return {
      assetKey,
      durationMs,
      segments: [{ text, startMs: 0, endMs: durationMs }],
    };
  }
}
