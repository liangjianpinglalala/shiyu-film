export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobInput = {
  title: string;
  kind: "自动识别" | "古诗" | "成语";
  ratio: "16:9 横屏" | "9:16 竖屏";
  age: "小学阶段" | "初中阶段" | "全年龄";
};
export type StoryboardScript = {
  title: string;
  author?: string;
  originalText?: string;
  explanation: string;
  sources: { title: string; url: string; excerpt?: string }[];
  scenes: {
    id: string;
    narration: string;
    visualPrompt: string;
    durationSeconds: number;
  }[];
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
  imageReady: boolean;
  speechReady: boolean;
  storageReady: boolean;
  generationReady: boolean;
  message: string;
};
