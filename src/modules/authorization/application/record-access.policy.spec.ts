import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import {
  auditAccessWhere,
  capaAccessWhere,
  changeAccessWhere,
  complaintAccessWhere,
  deviationAccessWhere,
  documentAccessWhere,
  equipmentAccessWhere,
  productReviewAccessWhere,
  recallAccessWhere,
  riskAccessWhere,
  supplierAccessWhere,
} from './record-access.policy.js';

const userId = '10000000-0000-4000-8000-000000000001';

const policies = [
  ['documents', documentAccessWhere],
  ['deviations', deviationAccessWhere],
  ['capas', capaAccessWhere],
  ['changes', changeAccessWhere],
  ['audits', auditAccessWhere],
  ['risks', riskAccessWhere],
  ['suppliers', supplierAccessWhere],
  ['equipment', equipmentAccessWhere],
  ['complaints', complaintAccessWhere],
  ['recalls', recallAccessWhere],
  ['product_reviews', productReviewAccessWhere],
] as const;

describe('record access policy', () => {
  it.each(policies)(
    'limits %s reads to records related to the current user',
    (_module, policy) => {
      const where = policy(principal([]));

      expect(where).not.toEqual({});
      expect(JSON.stringify(where)).toContain(userId);
    },
  );

  it.each(policies)(
    'allows organization-wide %s reads only with read_all',
    (module, policy) => {
      expect(policy(principal([`${module}.read_all`]))).toEqual({});
    },
  );
});

function principal(
  effectivePermissions: readonly string[],
): AuthenticatedPrincipal {
  return {
    tenantId: '20000000-0000-4000-8000-000000000001',
    userId,
    sessionId: '30000000-0000-4000-8000-000000000001',
    tokenVersion: 0,
    effectivePermissions,
  };
}
