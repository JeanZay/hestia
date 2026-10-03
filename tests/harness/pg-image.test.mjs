import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSTGRES_DIGEST, POSTGRES_IMAGE, resolvePostgresImage, assertPostgresContainerImage } from '../helpers/postgres-image.mjs';

const classicImageId = `sha256:${'a'.repeat(64)}`;
const otherImageId = `sha256:${'b'.repeat(64)}`;

test('classic Docker resolves a pinned manifest to a distinct local image ID', () => {
  const resolved = resolvePostgresImage([{ Id: classicImageId, RepoDigests: [POSTGRES_IMAGE] }]);
  assert.equal(resolved.reference, POSTGRES_IMAGE);
  assert.equal(resolved.repoDigest, POSTGRES_IMAGE);
  assert.notEqual(resolved.id, POSTGRES_DIGEST);
  assert.doesNotThrow(() => assertPostgresContainerImage(classicImageId, resolved.id));
  assert.throws(() => assertPostgresContainerImage(POSTGRES_DIGEST, resolved.id), /CONTAINER_IMAGE_MISMATCH/);
});

test('containerd-backed Docker can report the same digest and local image ID', () => {
  const resolved = resolvePostgresImage([{ Id: POSTGRES_DIGEST, RepoDigests: [POSTGRES_IMAGE] }]);
  assert.doesNotThrow(() => assertPostgresContainerImage(POSTGRES_DIGEST, resolved.id));
});

test('only official PostgreSQL repository aliases with the exact pinned digest are accepted', () => {
  for (const repo of ['postgres', 'library/postgres', 'docker.io/library/postgres']) {
    assert.equal(resolvePostgresImage([{ Id: classicImageId, RepoDigests: [`${repo}@${POSTGRES_DIGEST}`] }]).id, classicImageId);
  }
  for (const RepoDigests of [undefined, null, [], ['postgres:latest'], [`postgres@${otherImageId}`], [`untrusted/postgres@${POSTGRES_DIGEST}`]]) {
    assert.throws(() => resolvePostgresImage([{ Id: classicImageId, RepoDigests }]), /DIGEST_MISMATCH/);
  }
});

test('missing or ambiguous inspection results and malformed image IDs fail closed', () => {
  for (const inspected of [null, {}, [], [{}, {}]]) {
    assert.throws(() => resolvePostgresImage(inspected), /INSPECTION_INVALID/);
  }
  for (const Id of [undefined, null, '', 'latest', 'sha256:abc', classicImageId + 'extra']) {
    assert.throws(() => resolvePostgresImage([{ Id, RepoDigests: [POSTGRES_IMAGE] }]), /IMAGE_ID_INVALID/);
  }
});

test('a container created from any other image is refused', () => {
  for (const actual of [undefined, null, '', otherImageId]) {
    assert.throws(() => assertPostgresContainerImage(actual, classicImageId), /CONTAINER_IMAGE_MISMATCH/);
  }
  assert.throws(() => assertPostgresContainerImage('same-invalid-id', 'same-invalid-id'), /CONTAINER_IMAGE_MISMATCH/);
});
