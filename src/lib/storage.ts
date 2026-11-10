import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class LocalStorage implements Storage {
  constructor(private dir: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error("잘못된 저장 경로");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
}

export class S3Storage implements Storage {
  private client: S3Client;
  constructor(private bucket: string) {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || "auto",
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }
  async get(key: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }
}

export function storageFromEnv(): Storage {
  if (process.env.STORAGE_DRIVER === "s3") {
    if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET 환경 변수가 필요합니다");
    return new S3Storage(process.env.S3_BUCKET);
  }
  return new LocalStorage(process.env.STORAGE_LOCAL_DIR ?? "./.storage");
}
