export interface CapaMonitoringMessage {
  deliveryId?: string;
  email: string;
  displayName: string;
  tenantName: string;
  capaId: string;
  capaCode: string;
  capaTitle: string;
  subjectType: 'ACTION' | 'EFFECTIVENESS_REVIEW';
  subjectTitle: string;
  dueState: 'DUE_SOON' | 'OVERDUE' | 'ESCALATED';
  dueAt: Date;
}

export abstract class CapaMonitoringNotifier {
  abstract send(message: CapaMonitoringMessage): Promise<void>;
}
