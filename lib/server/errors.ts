export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const unavailable = (message: string) =>
  new AppError(503, "SERVICE_NOT_CONFIGURED", message);
