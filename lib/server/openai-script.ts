import { z } from "zod";
import { config } from "./config";
import { AppError, unavailable } from "./errors";
import type { JobInput } from "../shared/types";
import type { CallContext, Script, ScriptProvider } from "./media-contracts";

const scriptSchema = z.object({
  title: z.string().min(1).max(80),
  author: z.string().max(80).optional(),
  originalText: z.string().max(2000).optional(),
  explanation: z.string().min(1).max(2000),
  sources: z.array(z.object({
    title: z.string().min(1).max(160),
    url: z.string().url().max(1000),
    excerpt: z.string().max(300).optional(),
  })).min(1).max(6),
  scenes: z.array(z.object({
    id: z.string().min(1).max(30),
    narration: z.string().min(1).max(600),
    visualPrompt: z.string().min(1).max(1000),
    durationSeconds: z.number().int().min(4).max(30),
  })).min(4).max(8),
});

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "author", "originalText", "explanation", "sources", "scenes"],
  properties: {
    title: { type: "string" },
    author: { type: "string" },
    originalText: { type: "string" },
    explanation: { type: "string" },
    sources: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "excerpt"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          excerpt: { type: "string" },
        },
      },
    },
    scenes: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "narration", "visualPrompt", "durationSeconds"],
        properties: {
          id: { type: "string" },
          narration: { type: "string" },
          visualPrompt: { type: "string" },
          durationSeconds: { type: "integer", minimum: 4, maximum: 30 },
        },
      },
    },
  },
} as const;

type Fetch = typeof fetch;

export class OpenAIScriptProvider implements ScriptProvider {
  constructor(private request: Fetch = fetch) {}

  async create(input: JobInput, context: CallContext): Promise<Script> {
    const settings = config();
    if (!settings.openaiApiKey)
      throw unavailable("OpenAI 脚本服务尚未配置");
    const response = await this.request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openaiApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": context.idempotencyKey,
      },
      signal: context.signal,
      body: JSON.stringify({
        model: settings.openaiTextModel,
        store: false,
        instructions:
          "你是中国古典文学动画编导。核实题目、作者、原文与含义，面向指定年龄写成国风动画分镜。引用真实可访问的资料页，不编造来源。画面提示不得含现代品牌、血腥或恐怖内容。",
        input: `题目：${input.title}\n类型：${input.kind}\n受众：${input.age}\n画幅：${input.ratio}`,
        tools: [{ type: "web_search" }],
        text: {
          format: {
            type: "json_schema",
            name: "shiyu_animation_script",
            strict: true,
            schema: jsonSchema,
          },
        },
      }),
    });
    if (!response.ok) {
      const requestId = response.headers.get("x-request-id");
      throw new AppError(
        response.status === 429 ? 429 : 503,
        "SCRIPT_PROVIDER_FAILED",
        `AI 脚本生成失败${requestId ? `（请求 ${requestId}）` : ""}`,
      );
    }
    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text = payload.output_text || payload.output
      ?.flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")?.text;
    if (!text)
      throw new AppError(503, "SCRIPT_PROVIDER_INVALID", "AI 脚本结果为空");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError(503, "SCRIPT_PROVIDER_INVALID", "AI 脚本格式无效");
    }
    const validated = scriptSchema.safeParse(parsed);
    if (!validated.success)
      throw new AppError(503, "SCRIPT_PROVIDER_INVALID", "AI 脚本内容未通过校验");
    return validated.data;
  }
}
