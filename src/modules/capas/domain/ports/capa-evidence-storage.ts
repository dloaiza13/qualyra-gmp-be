export interface StoredEvidenceObject {
  objectKey: string;
  storageDriver: string;
}

export abstract class CapaEvidenceStorage {
  abstract checkHealth(): Promise<void>;

  abstract store(
    objectKey: string,
    bytes: Buffer,
    contentType: string,
    sha256: string,
  ): Promise<StoredEvidenceObject>;

  abstract read(objectKey: string): Promise<Buffer>;

  abstract remove(objectKey: string): Promise<void>;
}
