export function canCaptureQuestion(captureEnabled: boolean, manual: boolean): boolean {
  return captureEnabled || manual;
}

export function canAutoCaptureQuestion(
  captureEnabled: boolean,
  projectSelected: boolean,
): boolean {
  return captureEnabled && projectSelected;
}
