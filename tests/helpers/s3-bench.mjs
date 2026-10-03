import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// RustFS 1.0.1, Linux amd64. Disposable test server only, not an application dependency.
export const S3_IMAGE = 'rustfs/rustfs@sha256:7465b31993156ca5cc0eb4b3c59a01ff69651961be62bcfeb6ce569f22034a56';

export async function startS3Bench({ docker, runId, network, accessKey, secretKey, interrupted }) {
  const name = `${runId}-s3`;
  const inspected = JSON.parse(docker(['image', 'inspect', S3_IMAGE]));
  if (inspected.length !== 1 || !inspected[0].RepoDigests?.some(ref => ref === S3_IMAGE || ref === `docker.io/${S3_IMAGE}`)) throw Error('S3_IMAGE_DIGEST_MISMATCH');
  const id = docker(['run', '--detach', '--rm', '--pull', 'never', '--name', name, '--label', `hestia.qualification=${runId}`, '--network', network,
    '--memory', '1536m', '--cpus', '1', '--pids-limit', '256', '--publish', '127.0.0.1::9000',
    '--tmpfs', '/data:rw,nosuid,nodev,size=536870912,uid=10001,gid=10001',
    '--tmpfs', '/logs:rw,nosuid,nodev,size=16777216,uid=10001,gid=10001',
    '--env', 'RUSTFS_ACCESS_KEY', '--env', 'RUSTFS_SECRET_KEY', '--env', 'RUSTFS_CONSOLE_ENABLE=false',
    '--env', 'RUSTFS_OBS_LOGGER_LEVEL=error', '--env', 'RUSTFS_OBS_LOG_DIRECTORY=/logs', S3_IMAGE, '/data']);
  const info = JSON.parse(docker(['inspect', id]))[0];
  const bindings = info.NetworkSettings.Ports['9000/tcp'];
  if (info.Image !== inspected[0].Id || info.Config.Labels['hestia.qualification'] !== runId
    || bindings?.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || info.Mounts.some(m => m.Type !== 'tmpfs')
    || !info.HostConfig.Tmpfs['/data'] || !info.HostConfig.Tmpfs['/logs']) throw Error('S3_ISOLATION_MISMATCH');
  const port = Number(bindings[0].HostPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('S3_PORT_INVALID');
  const endpoint = `http://127.0.0.1:${port}`;
  const bucket = `hestia-test-${runId.slice('hestia-app-'.length)}`;
  const client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey }, maxAttempts: 1 });
  try {
    let ready = false;
    for (let i = 0; i < 100 && !interrupted(); i++) {
      try { await client.send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(1500) }); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    if (!ready) throw Error('S3_NOT_READY');
    const key = 'qualification-private-probe', bytes = Buffer.from('synthetic-range-proof');
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }));
    const anonymous = await fetch(`${endpoint}/${bucket}/${key}`, { signal: AbortSignal.timeout(3000) });
    await anonymous.body?.cancel();
    if (anonymous.status !== 403) throw Error('S3_ANONYMOUS_ACCESS_NOT_DENIED');
    const partial = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=2-8' }));
    if (!Buffer.from(await partial.Body.transformToByteArray()).equals(bytes.subarray(2, 9))) throw Error('S3_RANGE_MISMATCH');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return { env: { AWS_ENDPOINT_URL_S3: endpoint, AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: accessKey,
      AWS_SECRET_ACCESS_KEY: secretKey, HESTIA_S3_BUCKET: bucket, HESTIA_STORAGE_MODE: 'local', HESTIA_S3_BUCKET_ACCESS: 'private' },
      receipt: { image: S3_IMAGE, resolvedImage: inspected[0].Id, containerId: id, bindings, bucket,
        storage: 'tmpfs-only', anonymousStatus: anonymous.status, signedRange: 'PASS' } };
  } finally { client.destroy(); }
}

export function stopS3Bench(docker, runId) {
  const name = `${runId}-s3`;
  const ids = docker(['ps', '-a', '--no-trunc', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']).split('\n').filter(Boolean);
  if (ids.length > 1) throw Error('S3_OWNERSHIP_MISMATCH');
  if (ids.length) {
    const info = JSON.parse(docker(['inspect', ids[0]]))[0];
    if (info.Name !== `/${name}` || info.Config.Labels['hestia.qualification'] !== runId) throw Error('S3_OWNERSHIP_MISMATCH');
    docker(['stop', '--time', '3', info.Id]);
  }
  return docker(['ps', '-a', '--no-trunc', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']) === '';
}
