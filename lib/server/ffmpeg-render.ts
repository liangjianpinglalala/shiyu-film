import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { AppError, unavailable } from "./errors";
import { VercelBlobStore } from "./artifact-store";
import type { ArtifactStore, CallContext, RenderProvider } from "./media-contracts";

type Runner = (binary: string, args: string[], signal: AbortSignal) => Promise<void>;

const run: Runner = (binary, args, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { signal, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`)),
    );
  });

function srtTime(milliseconds: number) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export class FfmpegRenderProvider implements RenderProvider {
  constructor(
    private store: ArtifactStore = new VercelBlobStore(),
    private runner: Runner = run,
    private binary = ffmpegPath,
  ) {}

  async render(input: Parameters<RenderProvider["render"]>[0], context: CallContext) {
    if (!this.binary) throw unavailable("MP4 渲染器尚未安装");
    if (input.imageKeys.length !== input.script.scenes.length || !input.audioKeys[0])
      throw new AppError(400, "INVALID_RENDER_INPUT", "渲染素材不完整");
    const dir = await mkdtemp(join(tmpdir(), "shiyu-render-"));
    try {
      const imagePaths: string[] = [];
      for (let index = 0; index < input.imageKeys.length; index++) {
        const asset = await this.store.read(input.imageKeys[index]);
        const path = join(dir, `scene-${index}.png`);
        await writeFile(path, asset.data);
        imagePaths.push(path);
      }
      const audio = await this.store.read(input.audioKeys[0]);
      const audioPath = join(dir, "narration.mp3");
      await writeFile(audioPath, audio.data);
      let cursor = 0;
      const subtitles = input.script.scenes.map((scene, index) => {
        const start = cursor;
        cursor += scene.durationSeconds * 1000;
        return `${index + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${scene.narration}\n`;
      }).join("\n");
      const subtitlePath = join(dir, "captions.srt");
      await writeFile(subtitlePath, subtitles, "utf8");
      const outputPath = join(dir, "output.mp4");
      const [width, height] = input.ratio === "9:16 竖屏" ? [720, 1280] : [1280, 720];
      const args: string[] = ["-y"];
      input.script.scenes.forEach((scene, index) => {
        args.push("-loop", "1", "-t", String(scene.durationSeconds), "-i", imagePaths[index]);
      });
      args.push("-i", audioPath);
      const prepared = input.script.scenes.map((_, index) =>
        `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[v${index}]`,
      );
      const joined = input.script.scenes.map((_, index) => `[v${index}]`).join("");
      const escapedSubtitlePath = subtitlePath
        .replaceAll("\\", "/")
        .replace(":", "\\:")
        .replaceAll("'", "\\'");
      prepared.push(`${joined}concat=n=${input.script.scenes.length}:v=1:a=0[joined]`);
      prepared.push(
        `[joined]subtitles='${escapedSubtitlePath}':force_style='FontName=sans-serif,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=36'[video]`,
      );
      args.push(
        "-filter_complex", prepared.join(";"),
        "-map", "[video]", "-map", `${input.script.scenes.length}:a`,
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", outputPath,
      );
      await this.runner(this.binary, args, context.signal);
      const video = new Uint8Array(await readFile(outputPath));
      const assetKey = `jobs/${context.idempotencyKey}/film.mp4`;
      await this.store.put(assetKey, video, "video/mp4");
      return { assetKey, durationMs: cursor, mimeType: "video/mp4" as const };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, "RENDER_FAILED", "MP4 合成失败");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
