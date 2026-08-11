import { describe, expect, it } from "vitest";
import {
  hasRecognizedNewQuestion,
  shouldResetFloatingPanelSelection,
} from "../graph/floatingPanelSelection";
import type { FloatingPanelState } from "../shared/messages";

function incomingState(
  overrides: Partial<FloatingPanelState> = {},
): FloatingPanelState {
  return {
    captureEnabled: true,
    projectId: "project-1",
    projectTitle: "Project",
    projects: [],
    graphNodes: [{
      id: "selected-node",
      parentId: null,
      question: "Selected",
      status: "pending",
    }],
    latestQuestionKey: "question-1",
    parentState: "empty",
    recommendedParents: [],
    parentOptions: [],
    ...overrides,
  };
}

describe("floating panel graph selection", () => {
  const previous = {
    projectId: "project-1",
    latestQuestionKey: "question-1",
  };

  it("keeps the selected node across ordinary state broadcasts", () => {
    expect(shouldResetFloatingPanelSelection(
      "selected-node",
      previous,
      incomingState(),
    )).toBe(false);
  });

  it("resets for a new question, project change, or removed node", () => {
    expect(shouldResetFloatingPanelSelection(
      "selected-node",
      previous,
      incomingState({ latestQuestionKey: "question-2" }),
    )).toBe(true);
    expect(shouldResetFloatingPanelSelection(
      "selected-node",
      previous,
      incomingState({ projectId: "project-2" }),
    )).toBe(true);
    expect(shouldResetFloatingPanelSelection(
      "selected-node",
      previous,
      incomingState({ graphNodes: [] }),
    )).toBe(true);
  });

  it("recognizes only a different, available latest-question key as new", () => {
    expect(hasRecognizedNewQuestion(
      previous,
      incomingState({ latestQuestionKey: "question-2" }),
    )).toBe(true);
    expect(hasRecognizedNewQuestion(previous, incomingState())).toBe(false);
    expect(hasRecognizedNewQuestion(
      previous,
      { projectId: "project-1" },
    )).toBe(false);
    expect(hasRecognizedNewQuestion(
      previous,
      incomingState({ projectId: "project-2", latestQuestionKey: "question-2" }),
    )).toBe(false);
  });
});
