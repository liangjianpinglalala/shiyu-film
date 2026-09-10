export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobInput = {
  title: string;
  kind: "自动识别" | "古诗" | "成语";
  ratio: "16:9 横屏" | "9:16 竖屏";
  age: "小学阶段" | "初中阶段" | "全年龄";
};
export type Work = JobInput & {
  id: string;
  date: string;
  status: JobStatus;
  step: number;
  error: string | null;
  attempts: number;
  mode: "demo" | "live";
  createdAt: number;
};
export type Capabilities = {
  mode: "demo" | "live";
  authReady: boolean;
  scriptReady: boolean;
  generationReady: boolean;
  message: string;
};
