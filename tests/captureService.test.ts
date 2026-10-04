import { describe, expect, it } from "vitest";
import {
  canAutoCaptureQuestion,
  canCaptureQuestion,
} from "../shared/captureService";

describe("capture service", () => {
  it("allows a one-off manual capture while continuous capture is paused", () => {
    expect(canCaptureQuestion(false, false)).toBe(false);
    expect(canCaptureQuestion(false, true)).toBe(true);
    expect(canCaptureQuestion(true, false)).toBe(true);
  });

  it("requires both an enabled switch and an explicitly selected project for auto capture", () => {
    expect(canAutoCaptureQuestion(true, true)).toBe(true);
    expect(canAutoCaptureQuestion(true, false)).toBe(false);
    expect(canAutoCaptureQuestion(false, true)).toBe(false);
    expect(canAutoCaptureQuestion(false, false)).toBe(false);
  });
});
