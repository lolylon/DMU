import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;
  private artifactsBucket!: string;
  private recordingsBucket!: string;

  onModuleInit() {
    this.artifactsBucket = process.env.S3_BUCKET_ARTIFACTS ?? 'miru-artifacts';
    this.recordingsBucket = process.env.S3_BUCKET_RECORDINGS ?? 'miru-recordings';
    this.client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'miru_minio',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'miru_dev_only_change_me',
      },
    });
  }

  async assertHealthy() {
    await this.ensureBucket(this.recordingsBucket);
    await this.ensureBucket(this.artifactsBucket);
    const probeKey = `health/${Date.now()}.txt`;
    const body = Buffer.from(`ok ${new Date().toISOString()}`, 'utf8');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.recordingsBucket,
        Key: probeKey,
        Body: body,
        ContentType: 'text/plain',
      }),
    );
    return true;
  }

  async putRecordingObject(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.recordingsBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return {
      bucket: this.recordingsBucket,
      key,
      checksumSha256: createHash('sha256').update(body).digest('hex'),
      byteSize: body.length,
    };
  }

  async putArtifactObject(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.artifactsBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return {
      bucket: this.artifactsBucket,
      key,
      checksumSha256: createHash('sha256').update(body).digest('hex'),
      byteSize: body.length,
    };
  }

  async signedGetUrl(bucket: 'recordings' | 'artifacts', key: string, expiresInSec = 120) {
    const Bucket = bucket === 'recordings' ? this.recordingsBucket : this.artifactsBucket;
    const cmd = new GetObjectCommand({ Bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSec });
  }

  private async ensureBucket(bucket: string) {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.warn(`Created missing bucket ${bucket}`);
      } catch (e) {
        throw new ServiceUnavailableException(`Object storage unavailable: ${bucket}`);
      }
    }
  }
}
