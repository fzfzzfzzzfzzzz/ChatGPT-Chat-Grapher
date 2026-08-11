export const CAPTURE_SERVICE_ENABLED_KEY = "captureServiceEnabled";

export function captureServiceEnabledFromStorage(value: unknown): boolean {
  return value !== false;
}

export function canCaptureQuestion(captureEnabled: boolean, manual: boolean): boolean {
  return captureEnabled || manual;
}
