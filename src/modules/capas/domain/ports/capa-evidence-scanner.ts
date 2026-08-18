export interface EvidenceScanResult {
  engine: string;
  result: string;
}

export interface EvidenceScanInput {
  bytes: Buffer;
  contentType: string;
  fileName: string;
}

export abstract class CapaEvidenceScanner {
  abstract checkHealth(): Promise<void>;

  abstract scan(input: EvidenceScanInput): Promise<EvidenceScanResult>;
}
