import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import {
  CapaEvidenceStorage,
  type StoredEvidenceObject,
} from '../domain/ports/capa-evidence-storage.js';

@Injectable()
export class S3CapaEvidenceStorage extends CapaEvidenceStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly autoCreateBucket: boolean;
  private ready?: Promise<void>;

  constructor(config: ConfigService<Environment, true>) {
    super();
    this.bucket = config.getOrThrow('CAPA_EVIDENCE_S3_BUCKET', {
      infer: true,
    });
    this.autoCreateBucket = config.getOrThrow(
      'CAPA_EVIDENCE_S3_AUTO_CREATE_BUCKET',
      { infer: true },
    );
    this.client = new S3Client({
      endpoint: config.getOrThrow('CAPA_EVIDENCE_S3_ENDPOINT', { infer: true }),
      region: config.getOrThrow('CAPA_EVIDENCE_S3_REGION', { infer: true }),
      forcePathStyle: config.getOrThrow('CAPA_EVIDENCE_S3_FORCE_PATH_STYLE', {
        infer: true,
      }),
      credentials: {
        accessKeyId: config.getOrThrow('CAPA_EVIDENCE_S3_ACCESS_KEY', {
          infer: true,
        }),
        secretAccessKey: config.getOrThrow('CAPA_EVIDENCE_S3_SECRET_KEY', {
          infer: true,
        }),
      },
    });
  }

  checkHealth(): Promise<void> {
    return this.ensureBucket();
  }

  async store(
    objectKey: string,
    bytes: Buffer,
    contentType: string,
    sha256: string,
  ): Promise<StoredEvidenceObject> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: bytes,
        ContentLength: bytes.length,
        ContentType: contentType,
        Metadata: { sha256 },
      }),
    );
    return { objectKey, storageDriver: 'S3' };
  }

  async read(objectKey: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!response.Body)
      throw new Error('The managed evidence object is empty.');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  private ensureBucket(): Promise<void> {
    this.ready ??= this.checkOrCreateBucket();
    return this.ready;
  }

  private async checkOrCreateBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!this.autoCreateBucket) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}
