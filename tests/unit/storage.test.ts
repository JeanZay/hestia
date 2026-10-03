import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Storage, storageConfigFromEnv, validateStorageConfig, type StorageConfig } from "../../src/server/storage";

const config: StorageConfig = {
  endpoint: "http://127.0.0.1:19000", region: "us-east-1", bucket: "synthetic-documents",
  accessKeyId: "synthetic-test-only", secretAccessKey: "synthetic-test-only", mode: "local", bucketAccess: "private",
};
afterEach(() => vi.restoreAllMocks());

describe("private bounded S3 transport", () => {
  it("requires explicit configuration rather than SDK ambient credentials", () => {
    expect(() => storageConfigFromEnv({})).toThrow("storage_configuration");
    expect(() => validateStorageConfig({ ...config, accessKeyId: "" })).toThrow("storage_configuration");
    expect(() => validateStorageConfig({ ...config, bucketAccess: "public_read" as "private" })).toThrow("storage_configuration");
  });
  it.each(["https://storage.example.org", "http://localhost:19000", "http://192.168.1.1", "http://127.0.0.1.evil.example", "http://127.0.0.1/?endpoint=remote", "http://user:password@127.0.0.1"])("refuses unsafe local endpoint %s", endpoint => {
    expect(() => validateStorageConfig({ ...config, endpoint })).toThrow("storage_configuration");
  });
  it("requires TLS for remote configuration", () => {
    expect(() => validateStorageConfig({ ...config, mode: "remote" })).toThrow("storage_configuration");
  });
  it("sends the exact original without public ACL or client URL", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const original = Buffer.from("synthetic fragment");
    const store = createS3Storage(config);
    await store.put("operations/abc/original", original, "application/pdf");
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command.input).toMatchObject({ Bucket: config.bucket, Key: "operations/abc/original", Body: original,
      ContentLength: original.length, CacheControl: "private, no-store" });
    expect(command.input.ACL).toBeUndefined();
    expect(Object.keys(store).sort()).toEqual(["delete", "getRange", "put"]);
  });
  it("reads exactly one bounded portion and validates Content-Range", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: Readable.from([Buffer.from([2, 3])]), ContentLength: 2, ContentRange: "bytes 1-2/4", $metadata: { httpStatusCode: 206 },
    } as never);
    expect(await createS3Storage(config).getRange("original/abc", 1, 2)).toEqual(new Uint8Array([2, 3]));
    expect((send.mock.calls[0][0] as GetObjectCommand).input.Range).toBe("bytes=1-2");
  });
  it.each([
    { ContentLength: 4, ContentRange: undefined, $metadata: { httpStatusCode: 200 } },
    { ContentLength: 2, ContentRange: "bytes 0-1/4", $metadata: { httpStatusCode: 206 } },
    { ContentLength: 2, ContentRange: "bytes 1-2/4", $metadata: { httpStatusCode: 206 } },
  ])("rejects ignored, incorrect or oversized range responses", async headers => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ ...headers, Body: Readable.from([Buffer.alloc(4)]) } as never);
    await expect(createS3Storage(config).getRange("original/abc", 1, 2)).rejects.toThrow("storage_unavailable");
  });
  it("rejects short response bodies", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentLength: 2, ContentRange: "bytes 1-2/4", $metadata: { httpStatusCode: 206 }, Body: Readable.from([Buffer.alloc(1)]),
    } as never);
    await expect(createS3Storage(config).getRange("original/abc", 1, 2)).rejects.toThrow("storage_unavailable");
  });
  it("refuses unbounded reads and invalid keys before network activity", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    const store = createS3Storage(config);
    await expect(store.getRange("original/abc", 0, 2 * 1024 * 1024)).rejects.toThrow("invalid_storage_request");
    await expect(store.getRange("original/abc", -1, 1)).rejects.toThrow("invalid_storage_request");
    await expect(store.delete("../outside")).rejects.toThrow("invalid_storage_request");
    expect(send).not.toHaveBeenCalled();
  });
  it("redacts backend errors and credentials", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(new Error("credential contents and backend details"));
    await expect(createS3Storage(config).delete("original/abc")).rejects.toThrow(/^storage_unavailable$/);
  });
  it("bounds a stalled S3 operation even if the transport does not settle", async () => {
    vi.spyOn(S3Client.prototype, "send").mockImplementation(() => new Promise(() => undefined));
    await expect(createS3Storage({ ...config, timeoutMs: 100 }).delete("original/abc"))
      .rejects.toThrow("storage_unavailable");
  });
  it("destroys a stalled range body when its deadline expires", async () => {
    const body = new Readable({ read() {} });
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentLength: 2, ContentRange: "bytes 1-2/4", $metadata: { httpStatusCode: 206 }, Body: body,
    } as never);
    await expect(createS3Storage({ ...config, timeoutMs: 100 }).getRange("original/abc", 1, 2))
      .rejects.toThrow("storage_unavailable");
    expect(body.destroyed).toBe(true);
  });
});
