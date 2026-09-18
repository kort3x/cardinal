/**
 * Shares textures only while surfaces hold leases. There is no idle cache.
 *
 * Keys describe all drawing inputs. The synchronous factory must return a fresh
 * disposable texture (or null on unavailable allocation); the pool owns disposal
 * from then on. Callers detach maps
 * before releasing leases and guard asynchronous redraws with texture disposal,
 * not the lifetime of the surface that first acquired the texture.
 */
export function createTexturePool() {
  const entries = new Map();
  let destroyed = false;

  function disposeEntry(key, entry) {
    entry.disposed = true;
    entries.delete(key);
    entry.texture.dispose();
  }

  return {
    acquire(key, create) {
      if (destroyed) throw new Error("Cannot acquire from a destroyed texture pool");
      let entry = entries.get(key);
      if (!entry) {
        const texture = create();
        if (texture === null) return null;
        if (!texture || typeof texture.dispose !== "function") {
          throw new TypeError("Texture pool factory must return a disposable texture");
        }
        entry = { texture, references: 0, disposed: false };
        entries.set(key, entry);
      }
      entry.references += 1;
      let released = false;
      return {
        texture: entry.texture,
        release() {
          if (released) return;
          released = true;
          if (entry.disposed) return;
          entry.references -= 1;
          if (entry.references === 0) disposeEntry(key, entry);
        },
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const remaining = [...entries.values()];
      entries.clear();
      // Invalidate every lease before disposal listeners can run.
      for (const entry of remaining) entry.disposed = true;
      const errors = [];
      for (const entry of remaining) {
        try {
          entry.texture.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "Texture pool disposal failed");
    },
  };
}
