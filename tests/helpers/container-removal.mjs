// Docker stop waits for not-running; daemon-side --rm may complete afterwards.
// This observes only the already-owned exact name/ID, never deletes resources.
export async function waitForContainerRemoval(docker, name, expectedId, {
  now = () => performance.now(),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!/^hestia-app-[a-f0-9]{16}(?:-s3)?$/.test(name)
    || (expectedId !== null && !/^[a-f0-9]{64}$/.test(expectedId))) throw Error('REMOVAL_OWNERSHIP_INVALID');
  const deadline = now() + 5000;
  for (let attempt = 0; attempt < 51; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    const ids = docker(['ps', '-a', '--no-trunc', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'], Math.ceil(remaining))
      .split('\n').filter(Boolean);
    if (now() > deadline) return false;
    if (ids.length === 0) return true;
    if (ids.length !== 1 || ids[0] !== expectedId) throw Error('REMOVAL_OWNERSHIP_MISMATCH');
    const delay = Math.min(100, deadline - now());
    if (delay <= 0) return false;
    await pause(delay);
  }
  return false;
}
