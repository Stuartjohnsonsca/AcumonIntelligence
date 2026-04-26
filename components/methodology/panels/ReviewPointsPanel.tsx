'use client';

import { RIMattersPanel } from './RIMattersPanel';

/**
 * Thin wrapper that re-uses the generic audit-points panel from
 * RIMattersPanel.tsx with pointType='review_point'. Per spec, Review
 * Points and RI Matters share the same UX (collapsible list, traffic
 * lights, status badges, RI-only close, Send to Portal/Technical/
 * Ethics, Raise as Error/Management/Representation, history popover,
 * floating draggable window). The wrapper exists so EngagementTabs
 * can keep its existing import surface.
 */

interface Props {
  engagementId: string;
  userId: string;
  userRole?: string;
  onClose: () => void;
  onAction?: (action: string, pointId: string) => void;
}

export function ReviewPointsPanel(props: Props) {
  return <RIMattersPanel {...props} pointType="review_point" />;
}
