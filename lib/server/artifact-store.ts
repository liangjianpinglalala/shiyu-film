import { del, get, put } from "@vercel/blob";
import { config } from "./config";
import { AppError, unavailable } from "./errors";
import type { ArtifactStore } from "./media-contracts";

export class VercelBlobStore implements ArtifactStore {
  async put(key: string, data: Uint8Array, mimeType: string) {
    if (!config().blobReady) throw unavailable("素材存储尚未配置");
    await put(key, Buffer.from(data), {
      access: "private", contentType: mimeType, addRandomSuffix: false,
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
