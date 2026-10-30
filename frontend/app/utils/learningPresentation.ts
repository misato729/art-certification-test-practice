export const passageAnchorId = (passageId: number, anchorId?: string | null) => anchorId ? `passage-${passageId}-${anchorId}` : `passage-${passageId}`
