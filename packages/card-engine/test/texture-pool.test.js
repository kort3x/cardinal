import test from "node:test";
import assert from "node:assert/strict";
import { Texture } from "three";
import { createTexturePool } from "../src/renderers/texture-pool.js";

function trackedTexture() {
  const texture = new Texture();
  let disposals = 0;
  texture.addEventListener("dispose", () => { disposals += 1; });
  return { texture, get disposals() { return disposals; } };
}

test("mounted surfaces share one texture until the last surface releases it", () => {
  const pool = createTexturePool();
  const resource = trackedTexture();
  let creates = 0;
  const create = () => { creates += 1; return resource.texture; };
  const first = pool.acquire("front", create);
  const second = pool.acquire("front", create);
  assert.equal(first.texture, second.texture);
  assert.equal(creates, 1);

  first.release();
  first.release();
  assert.equal(resource.disposals, 0);
  const third = pool.acquire("front", create);
  second.release();
  assert.equal(resource.disposals, 0);
  assert.equal(creates, 1);
  third.release();
  assert.equal(resource.disposals, 1);
  third.release();
  pool.destroy();
  assert.equal(resource.disposals, 1);
});

test("concealing the last front evicts it and a later reveal creates a fresh texture", () => {
  const pool = createTexturePool();
  const oldResource = trackedTexture();
  const newResource = trackedTexture();
  const oldLease = pool.acquire("front", () => oldResource.texture);
  oldLease.release();
  assert.equal(oldResource.disposals, 1);

  const newLease = pool.acquire("front", () => newResource.texture);
  assert.equal(newLease.texture, newResource.texture);
  assert.notEqual(newLease.texture, oldLease.texture);
  oldLease.release();
  assert.equal(newResource.disposals, 0);
  newLease.release();
  assert.equal(newResource.disposals, 1);
});

test("different drawing keys have independent ownership", () => {
  const pool = createTexturePool();
  const small = trackedTexture();
  const large = trackedTexture();
  const first = pool.acquire("front:180x250", () => small.texture);
  const second = pool.acquire("front:180x300", () => large.texture);
  first.release();
  assert.equal(small.disposals, 1);
  assert.equal(large.disposals, 0);
  second.release();
  assert.equal(large.disposals, 1);
});

test("pending image redraws survive the first owner but stop on final disposal", async () => {
  const pool = createTexturePool();
  const resource = trackedTexture();
  let disposed = false;
  resource.texture.addEventListener("dispose", () => { disposed = true; });
  // Models the renderer's disposal guard, independently of any surface owner.
  const redrawWhenLoaded = (loaded) => loaded.then(() => {
    if (!disposed) resource.texture.needsUpdate = true;
  });
  const first = pool.acquire("front", () => resource.texture);
  const second = pool.acquire("front", () => assert.fail("must share"));
  const initialVersion = resource.texture.version;
  const firstLoad = redrawWhenLoaded(Promise.resolve());
  first.release();
  await firstLoad;
  assert.equal(resource.texture.version, initialVersion + 1);

  const lateLoad = redrawWhenLoaded(Promise.resolve());
  second.release();
  await lateLoad;
  assert.equal(resource.disposals, 1);
  assert.equal(resource.texture.version, initialVersion + 1);
});

test("failed factories leave no cached entry and can be retried", () => {
  const pool = createTexturePool();
  const failure = new Error("drawing failed");
  assert.throws(() => pool.acquire("front", () => { throw failure; }), (error) => error === failure);
  assert.equal(pool.acquire("front", () => null), null);
  assert.throws(() => pool.acquire("front", () => ({})), /disposable texture/);
  const resource = trackedTexture();
  const lease = pool.acquire("front", () => resource.texture);
  lease.release();
  assert.equal(resource.disposals, 1);
});

test("destroy disposes each shared texture once and invalidates outstanding leases", () => {
  const pool = createTexturePool();
  const front = trackedTexture();
  const back = trackedTexture();
  const first = pool.acquire("front", () => front.texture);
  const second = pool.acquire("front", () => assert.fail("must share"));
  const third = pool.acquire("back", () => back.texture);
  // A disposal callback may release another outstanding lease.
  front.texture.addEventListener("dispose", () => { third.release(); });
  pool.destroy();
  assert.equal(front.disposals, 1);
  assert.equal(back.disposals, 1);
  first.release();
  second.release();
  third.release();
  pool.destroy();
  assert.equal(front.disposals, 1);
  assert.equal(back.disposals, 1);
  assert.throws(() => pool.acquire("front", () => assert.fail("must not create")), /destroyed/);
});

test("final release removes the entry before disposal callbacks acquire the same key", () => {
  const pool = createTexturePool();
  const oldResource = trackedTexture();
  const replacement = trackedTexture();
  let newLease;
  oldResource.texture.addEventListener("dispose", () => {
    newLease = pool.acquire("front", () => replacement.texture);
  });
  const oldLease = pool.acquire("front", () => oldResource.texture);
  oldLease.release();
  assert.equal(newLease.texture, replacement.texture);
  const shared = pool.acquire("front", () => assert.fail("replacement must remain cached"));
  newLease.release();
  assert.equal(replacement.disposals, 0);
  shared.release();
  assert.equal(replacement.disposals, 1);
});

test("a throwing disposal listener cannot leave a released texture cached", () => {
  const pool = createTexturePool();
  const resource = trackedTexture();
  resource.texture.addEventListener("dispose", () => { throw new Error("listener failed"); });
  const lease = pool.acquire("front", () => resource.texture);
  assert.throws(() => lease.release(), /listener failed/);
  lease.release();
  const replacement = trackedTexture();
  const next = pool.acquire("front", () => replacement.texture);
  next.release();
  assert.equal(resource.disposals, 1);
  assert.equal(replacement.disposals, 1);
});

test("destroy attempts all disposals even when a listener throws", () => {
  const pool = createTexturePool();
  const front = trackedTexture();
  const back = trackedTexture();
  const failure = new Error("listener failed");
  front.texture.addEventListener("dispose", () => { throw failure; });
  const first = pool.acquire("front", () => front.texture);
  const second = pool.acquire("back", () => back.texture);
  assert.throws(() => pool.destroy(), (error) => error instanceof AggregateError && error.errors[0] === failure);
  assert.equal(front.disposals, 1);
  assert.equal(back.disposals, 1);
  first.release();
  second.release();
  pool.destroy();
});
