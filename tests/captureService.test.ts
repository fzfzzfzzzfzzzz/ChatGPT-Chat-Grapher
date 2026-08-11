import { describe, expect, it } from "vitest";
import {
  canCaptureQuestion,
  captureServiceEnabledFromStorage,
} from "../shared/captureService";

describe("capture service preference", () => {
  it("defaults to enabled when no preference has been saved", () => {
    expect(captureServiceEnabledFromStorage(undefined)).toBe(true);
  });

  it("is disabled only by an explicit false value", () => {
    expect(captureServiceEnabledFromStorage(false)).toBe(false);
    expect(captureServiceEnabledFromStorage(true)).toBe(true);
    expect(captureServiceEnabledFromStorage("false")).toBe(true);
  });

  it("allows a one-off manual capture while continuous capture is paused", () => {
    expect(canCaptureQuestion(false, false)).toBe(false);
    expect(canCaptureQuestion(false, true)).toBe(true);
    expect(canCaptureQuestion(true, false)).toBe(true);
  });
});
