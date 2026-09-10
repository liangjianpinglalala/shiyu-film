import { z } from "zod";
import { config } from "./config";
import { AppError, unavailable } from "./errors";
import type { JobInput } from "../shared/types";
import type { CallContext, Script, ScriptProvider } from "./media-contracts";

const scriptSchema = z.object({
  title: z.string().min(1).max(80), author: z.string().max(80),
  originalText: z.string().max(2000), explanation: z.string().min(1).max(2000),
  sources: z.array(z.object({
    title: z.string().min(1).max(160), url: z.string().url().max(1000), excerpt: z.string().max(300),
  })).min(1).max(6),
  scenes: z.array(z.object({
    id: z.string().min(1).max(30), narration: z.string().min(1).max(600),
    visualPrompt: z.string().min(1).max(1000), durationSeconds: z.number().int().min(4).max(30),
  })).length(4),
});

const jsonSchema = {
  type: "object", additionalProperties: false,
  required: ["title", "author", "originalText", "explanation", "sources", "scenes"],
  properties: {
    title: { type: "string" }, author: { type: "string" }, originalText: { type: "string" }, explanation: { type: "string" },
    sources: { type: "array", minItems: 1, maxItems: 6, items: {
      type: "object", additionalProperties: false, required: ["title", "url", "excerpt"],
      properties: { title: { type: "string" }, url: { type: "string" }, excerpt: { type: "string" } },
    } },
    scenes: { type: "array", minItems: 4, maxItems: 4, items: {
      type: "object", additionalProperties: false,
      required: ["id", "narration", "visualPrompt", "durationSeconds"],
      properties: { id: { type: "string" }, narration: { type: "string" }, visualPrompt: { type: "string" }, durationSeconds: { type: "integer", minimum: 4, maximum: 30 } },
    } },
  },
} as const;

export class KimiScriptProvider implements ScriptProvider {
  constructor(private request: typeof fetch = fetch) {}
  async create(input: JobInput, context: CallContext): Promise<Script> {
    const settings = config();
    if (!settings.moonshotApiKey) throw unavailable("Kimi 脚本服务尚未配置");
    const response = await this.request(`${settings.moonshotBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.moonshotApiKey}`,
        "Content-Type": "application/json",
        "X-Msh-Request-Nonce": context.idempotencyKey,
      },
      signal: context.signal,
      body: JSON.stringify({
        model: settings.kimiModel,
        messages: [
          { role: "system", content: "你是中国古典文学动画编导。核实题目、作者、原文与含义，面向指定年龄写成四幕国风动画分镜。只给出你有把握的公开资料来源，不编造链接。画面提示不得含现代品牌、血腥或恐怖内容。" },
          { role: "user", content: `题目：${input.title}\n类型：${input.kind}\n受众：${input.age}\n画幅：${input.ratio}` },
        ],
        response_format: { type: "json_schema", json_schema: { name: "shiyu_animation_script", strict: true, schema: jsonSchema } },
        max_completion_tokens: 5000,
      }),
    });
    if (!response.ok) {
      let detail = "unknown";
      try {
        const payload = (await response.json()) as { error?: { code?: string; type?: string } };
        detail = payload.error?.code || payload.error?.type || detail;
      } catch {}
      throw new AppError(response.status === 429 ? 429 : 503, "KIMI_SCRIPT_FAILED", `Kimi 脚本生成失败（${detail.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)}）`);
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content;
    if (!text) throw new AppError(503, "KIMI_SCRIPT_INVALID", "Kimi 脚本结果为空");
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new AppError(503, "KIMI_SCRIPT_INVALID", "Kimi 脚本格式无效"); }
    const validated = scriptSchema.safeParse(parsed);
    if (!validated.success) throw new AppError(503, "KIMI_SCRIPT_INVALID", "Kimi 脚本内容未通过校验");
    return validated.data;
  }
}
