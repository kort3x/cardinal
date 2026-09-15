// Page anchors resolve through the renderer's camera; snapshots retain selectors,
// never DOM nodes or page rectangles. Missing anchors retain their last valid size.
export function resolveZones(snapshot, renderer, previous = new Map()) {
  const resolved = new Map();
  for (const zone of snapshot.zones) {
    const measured = zone.anchor ? renderer.measureZone?.(zone) : { geometry: zone.geometry, visible: true };
    const valid = measured?.geometry;
    resolved.set(zone.id, {
      ...zone,
      geometry: valid ?? previous.get(zone.id)?.geometry ?? { x: 0, y: 0, width: 1, height: 1, depth: zone.depth ?? 0 },
      visible: zone.visible !== false && measured?.visible === true && Boolean(valid),
    });
  }
  return resolved;
}
