export const POSTGRES_DIGEST = 'sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';
export const POSTGRES_IMAGE = `postgres@${POSTGRES_DIGEST}`;

const imageIdPattern = /^sha256:[a-f0-9]{64}$/;
const acceptedRepoDigests = new Set([
  POSTGRES_IMAGE,
  `library/postgres@${POSTGRES_DIGEST}`,
  `docker.io/library/postgres@${POSTGRES_DIGEST}`,
]);

// A registry manifest digest is not necessarily the local Docker image ID.
// Resolve the pinned reference, prove its repository digest, then retain its ID.
export function resolvePostgresImage(inspected) {
  if (!Array.isArray(inspected) || inspected.length !== 1) throw Error('POSTGRES_IMAGE_INSPECTION_INVALID');
  const image = inspected[0];
  if (typeof image?.Id !== 'string' || !imageIdPattern.test(image.Id)) throw Error('POSTGRES_IMAGE_ID_INVALID');
  const repoDigest = Array.isArray(image.RepoDigests)
    ? image.RepoDigests.find(value => acceptedRepoDigests.has(value)) : undefined;
  if (!repoDigest) throw Error('POSTGRES_IMAGE_DIGEST_MISMATCH');
  return { reference: POSTGRES_IMAGE, id: image.Id, repoDigest };
}

export function assertPostgresContainerImage(containerImageId, resolvedImageId) {
  if (typeof resolvedImageId !== 'string' || !imageIdPattern.test(resolvedImageId)
    || containerImageId !== resolvedImageId) throw Error('POSTGRES_CONTAINER_IMAGE_MISMATCH');
}
