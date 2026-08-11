import type { FloatingPanelState } from "../shared/messages";

type SelectionSnapshot = Pick<
  FloatingPanelState,
  "projectId" | "latestQuestionKey" | "graphNodes"
>;

type PreviousSelectionSnapshot = {
  projectId: string | undefined;
  latestQuestionKey: string | undefined;
};

export function shouldResetFloatingPanelSelection(
  selectedNodeId: string | undefined,
  previous: PreviousSelectionSnapshot,
  incoming: SelectionSnapshot,
): boolean {
  if (!selectedNodeId) return false;
  return (
    previous.projectId !== incoming.projectId ||
    previous.latestQuestionKey !== incoming.latestQuestionKey ||
    !incoming.graphNodes.some((node) => node.id === selectedNodeId)
  );
}

export function hasRecognizedNewQuestion(
  previous: PreviousSelectionSnapshot,
  incoming: Pick<SelectionSnapshot, "projectId" | "latestQuestionKey">,
): boolean {
  return Boolean(
    previous.projectId === incoming.projectId &&
    incoming.latestQuestionKey &&
    incoming.latestQuestionKey !== previous.latestQuestionKey,
  );
}
