import * as THREE from "three";
import { createHeadlessRenderer, filterContentElements } from "../renderer.js";
import { attachmentContent } from "../attachments.js";
import { DEFAULT_CARD_THICKNESS, cardDimensions, cardThickness, spacerHeight } from "../layout.js";
import { createTexturePool } from "./texture-pool.js";
import { reconcileAttachmentControls, resolveAttachmentGeometry } from "./attachment-renderer.js";

const radians = (degrees) => degrees * Math.PI / 180;
const CARD_BEVEL_SIZE = 1.2;
const CARD_BEVEL_SEGMENTS = 2;
const CARD_CURVE_SEGMENTS = 24;
const CARD_FACE_CURVE_SEGMENTS = 8;
const SELECTION_FRAME_CURVE_SEGMENTS = 64;
const SELECTION_FRAME_PADDING = 8;
const zeroShaderPrecision = Object.freeze({ rangeMin: 0, rangeMax: 0, precision: 0 });
const webglContextAttributes = Object.freeze({
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
});

function normalizeWebGLContext(context) {
  if (!context || typeof context.getShaderPrecisionFormat !== "function") return null;

  const queryShaderPrecision = context.getShaderPrecisionFormat.bind(context);

  Object.defineProperty(context, "getShaderPrecisionFormat", {
    configurable: true,
    value: (...args) => queryShaderPrecision(...args) ?? zeroShaderPrecision,
  });
  return context;
}

export function createSafeWebGLContext(canvas) {
  return normalizeWebGLContext(canvas.getContext("webgl2", webglContextAttributes));
}

export function createCardCamera({ projection = "orthographic", width = 1, height = 1, distance = 1000, fov = 35, zoom = 1 } = {}) {
  if (projection !== "orthographic" && projection !== "perspective") {
    throw new TypeError(`Unknown camera projection: ${projection}`);
  }
  if (![width, height, distance, fov, zoom].every(Number.isFinite) || width <= 0 || height <= 0 || distance <= 0 || fov <= 0 || zoom <= 0) {
    throw new RangeError("Camera dimensions and settings must be positive and finite");
  }

  const aspect = width / height;
  const camera = projection === "orthographic"
    ? new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 1, 5000)
    : new THREE.PerspectiveCamera(fov, aspect, 1, 5000);
  camera.zoom = zoom;
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return camera;
}

function elementSize(element) {
  const rect = element.getBoundingClientRect?.();
  return {
    width: Math.max(1, element.clientWidth || rect?.width || 1),
    height: Math.max(1, element.clientHeight || rect?.height || 1),
  };
}

export function cameraViewportForStage({ stageWidth, stageHeight, sceneWidth, sceneHeight, projection = "orthographic", scaleMode, unitsPerPixel = 1 } = {}) {
  const hasSceneDimensions = sceneWidth !== undefined || sceneHeight !== undefined;
  const resolvedScaleMode = scaleMode ?? (hasSceneDimensions ? "fit" : "stage");
  if (![stageWidth, stageHeight, unitsPerPixel].every(Number.isFinite)
    || stageWidth <= 0 || stageHeight <= 0 || unitsPerPixel <= 0) {
    throw new RangeError("Stage dimensions and camera scale must be positive and finite");
  }
  if (!["fit", "stage"].includes(resolvedScaleMode)) {
    throw new TypeError(`Unknown camera scale mode: ${resolvedScaleMode}`);
  }
  if (resolvedScaleMode === "stage") {
    return { width: stageWidth / unitsPerPixel, height: stageHeight / unitsPerPixel };
  }
  if (![sceneWidth, sceneHeight].every(Number.isFinite) || sceneWidth <= 0 || sceneHeight <= 0) {
    throw new RangeError("Fit camera mode requires positive and finite scene dimensions");
  }
  if (projection !== "orthographic") return { width: stageWidth, height: stageHeight };

  const stageAspect = stageWidth / stageHeight;
  const sceneAspect = sceneWidth / sceneHeight;
  return stageAspect >= sceneAspect
    ? { width: sceneHeight * stageAspect, height: sceneHeight }
    : { width: sceneWidth, height: sceneWidth / stageAspect };
}

function wrapText(context, text, width) {
  return String(text ?? "").split("\n").map((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > width) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
    return lines.join("\n");
  }).join("\n");
}

function drawLines(context, text, x, y, lineHeight) {
  for (const line of String(text ?? "").split("\n")) {
    context.fillText(line, x, y);
    y += lineHeight;
  }
}

function makeRoundedRectangleShape(width, height, radius) {
  const shape = new THREE.Shape();
  const left = -width / 2;
  const right = width / 2;
  const top = height / 2;
  const bottom = -height / 2;
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.absarc(right - radius, bottom + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(right, top - radius);
  shape.absarc(right - radius, top - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(left + radius, top);
  shape.absarc(left + radius, top - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(left, bottom + radius);
  shape.absarc(left + radius, bottom + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function makeShieldShape(width, height) {
  const shape = new THREE.Shape();
  const left = -width / 2;
  const right = width / 2;
  const top = height / 2;
  const bottom = -height / 2;
  const radius = Math.min(14, width * 0.1, height * 0.06);
  const shoulderY = top - height * 0.2;
  const taperY = bottom + height * 0.2;
  const lowerControlX = width * 0.16;

  shape.moveTo(left + radius, top);
  shape.lineTo(right - radius, top);
  shape.quadraticCurveTo(right, top, right, top - radius);
  shape.lineTo(right, shoulderY);
  shape.quadraticCurveTo(right, taperY, lowerControlX, bottom + radius * 0.4);
  shape.quadraticCurveTo(width * 0.08, bottom, 0, bottom);
  shape.quadraticCurveTo(-width * 0.08, bottom, -lowerControlX, bottom + radius * 0.4);
  shape.quadraticCurveTo(left, taperY, left, shoulderY);
  shape.lineTo(left, top - radius);
  shape.quadraticCurveTo(left, top, left + radius, top);
  return shape;
}

export function createCardShape(shapeDefinition, dimensions) {
  const type = typeof shapeDefinition === "string"
    ? shapeDefinition
    : shapeDefinition?.type ?? "rounded-rectangle";
  const { width, height } = dimensions;
  if (type === "rounded-rectangle") {
    return makeRoundedRectangleShape(width, height, Math.min(14, width / 2, height / 2));
  }
  if (type === "shield") return makeShieldShape(width, height);
  throw new TypeError(`Unknown card shape: ${type}`);
}

export function createCardFaceMaterial() {
  return createCardFaceSurfaceMaterial(0xffffff);
}

export function resolveFaceVisibility({
  faceUp = true,
  frontSuppressed = false,
  frontReady = false,
  backReady = false,
  poseVisible = true,
  flipX = 0,
  flipY = 0,
} = {}) {
  const safeFrontReady = frontSuppressed || frontReady;
  const side = physicalSide({ flipX, flipY });
  const concealingFront = faceUp === false && !frontSuppressed && frontReady && side !== "back";
  const card = poseVisible !== false && (faceUp !== false ? safeFrontReady && backReady : concealingFront || backReady);
  const front = card && (faceUp !== false ? frontReady : concealingFront);
  const concealedCover = card && faceUp === false && !concealingFront && side !== "back";
  return {
    front,
    frontBase: front || concealedCover,
    back: card && backReady,
    backBase: card && backReady,
    card,
  };
}

export function clearCardDepth(renderer, scene, camera, geometry, material, group) {
  if (!group || group.materialIndex === 0) renderer.clearDepth();
}

function createCardFaceSurfaceMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    metalness: 0,
    side: THREE.FrontSide,
    // Face content is a surface layer on top of the solid cuboid caps.
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

function createCardFaceBaseMaterial(color) {
  return createCardFaceSurfaceMaterial(color);
}

function contentIdentityKey(content) {
  return JSON.stringify([
    content?.title,
    content?.image,
    content?.imageAlt,
    content?.flavour,
    content?.background,
    content?.backgroundImage,
    content?.textColor,
    content?.mutedTextColor,
    content?.elements,
  ]);
}

function contentKey(content, dimensions) {
  return JSON.stringify([
    contentIdentityKey(content),
    dimensions.width,
    dimensions.height,
  ]);
}

function contentElements(content) {
  return content?.elements ?? [];
}

function elementContent(element) {
  if (element?.content && typeof element.content === "object") return element.content;
  return { text: element?.content ?? "" };
}

function elementText(element) {
  const content = elementContent(element);
  return content.text ?? content.value ?? "";
}

function elementImageSource(element) {
  const content = elementContent(element);
  return content.src ?? content.url ?? content.image;
}

function elementImageAlt(element) {
  const content = elementContent(element);
  return content.alt ?? content.imageAlt ?? content.label;
}

function backgroundImageSource(content) {
  const backgroundImage = content?.backgroundImage;
  return typeof backgroundImage === "string" ? backgroundImage : backgroundImage?.src;
}

function imageSourcesForContent(content) {
  return [
    backgroundImageSource(content),
    ...contentElements(content)
      .filter((element) => elementVisible(element) && element.type === "image")
      .map((element) => elementImageSource(element)),
    ...contentElements(content)
      .filter((element) => elementVisible(element) && element.type !== "image")
      .map((element) => elementContent(element)?.src),
  ].filter(Boolean);
}

function backgroundImageFit(content) {
  const backgroundImage = content?.backgroundImage;
  return typeof backgroundImage === "object" ? backgroundImage.fit ?? "cover" : "cover";
}

function elementVisible(element) {
  return element?.visible !== false;
}

function elementReservesSpace(element) {
  return elementVisible(element) || element.visibilityMode === "preserve-space";
}

function sortedElements(content, includePreserved = false) {
  return contentElements(content)
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => includePreserved ? elementReservesSpace(element) : elementVisible(element))
    .sort((first, second) => (first.element.layout?.order ?? first.index) - (second.element.layout?.order ?? second.index) || first.index - second.index);
}

function flowEntries(content) {
  return sortedElements(content, true).filter(({ element }) => (element.layout?.mode ?? "flow") === "flow");
}

export function flowTransitionPolicy(previousContent, nextContent) {
  if (!previousContent) return { preserveBottom: false, deferFlowIds: [], gapIndex: null };
  const previousFlow = flowEntries(previousContent);
  const nextFlow = flowEntries(nextContent);
  const previousIds = new Set(previousFlow.map(({ element }) => element.id));
  const nextIds = new Set(nextFlow.map(({ element }) => element.id));
  const removedIndex = previousFlow.findIndex(({ element }, index) => !nextIds.has(element.id)
    && previousFlow.slice(index + 1).some(({ element: later }) => nextIds.has(later.id)));
  const addedIndex = nextFlow.findIndex(({ element }, index) => elementVisible(element) && !previousIds.has(element.id)
    && nextFlow.slice(index + 1).some(({ element: later }) => previousIds.has(later.id)));
  const removedBeforeSurvivor = removedIndex !== -1;
  const addedBeforeSurvivor = addedIndex !== -1;
  const preserveBottom = removedBeforeSurvivor || addedBeforeSurvivor;
  const deferFlowIds = nextFlow
    .filter(({ element }) => elementVisible(element) && !previousIds.has(element.id))
    .map(({ element }) => element.id);
  const gapIndex = addedBeforeSurvivor
    ? nextFlow.slice(0, addedIndex).filter(({ element }) => previousIds.has(element.id)).length
    : removedBeforeSurvivor
      ? previousFlow.slice(0, removedIndex).filter(({ element }) => nextIds.has(element.id)).length
      : null;
  return { preserveBottom, deferFlowIds, gapIndex };
}

function imageFrom(images, element, fallback) {
  const source = elementImageSource(element);
  if (images instanceof Map) return images.get(source) ?? null;
  return source && fallback ? fallback : null;
}

function drawTextElement(context, element, dimensions, x, y, width, color, variant = "body") {
  const style = element.style ?? {};
  const isTitle = style.variant === "title" || element.variant === "title" || variant === "title";
  context.fillStyle = style.color ?? color;
  context.font = style.font ?? (isTitle ? "700 18.4px system-ui, sans-serif" : "14.4px system-ui, sans-serif");
  context.textBaseline = "top";
  const lineHeight = style.lineHeight ?? (isTitle ? 21 : 20);
  const text = wrapText(context, elementText(element), Math.max(1, width));
  if (elementVisible(element)) drawLines(context, text, x, y, lineHeight);
  return text.split("\n").length * lineHeight;
}

function flowElementHeight(context, element, dimensions, width) {
  if (element.type === "spacer") return spacerHeight(element);
  if (element.type === "image") return element.layout?.height ? dimensions.height * element.layout.height : 120;
  if (element.type === "text") {
    const style = element.style ?? {};
    const isTitle = style.variant === "title" || element.variant === "title" || element.id === "title";
    context.font = style.font ?? (isTitle ? "700 18.4px system-ui, sans-serif" : "14.4px system-ui, sans-serif");
    const lineHeight = style.lineHeight ?? (isTitle ? 21 : 20);
    return wrapText(context, elementText(element), Math.max(1, width)).split("\n").length * lineHeight;
  }
  return 20;
}

function registeredElementHeight(context, element, dimensions, width, elementRenderers) {
  const renderer = elementRendererFor(element.type, elementRenderers);
  if (!renderer) return null;
  if (typeof renderer.measure === "function") {
    const height = renderer.measure({ context, element, dimensions, width });
    if (!Number.isFinite(height) || height < 0) throw new RangeError(`Element renderer ${element.type} returned an invalid height`);
    return height;
  }
  return Number.isFinite(renderer.height) ? renderer.height : 20;
}

function drawRegisteredElement(context, element, dimensions, x, y, width, height, elementRenderers, images, content) {
  const renderer = elementRendererFor(element.type, elementRenderers);
  if (!renderer) return false;
  if (elementVisible(element) && typeof renderer.draw === "function") {
    renderer.draw({ context, element, dimensions, x, y, width, height, images, content });
  }
  return true;
}

function drawImageElement(context, element, dimensions, x, y, width, height, images, fallbackImage) {
  if (!elementVisible(element)) return height;
  const image = imageFrom(images, element, fallbackImage);
  if (!image) return height;
  drawFittedImage(context, image, x, y, width, height, "contain");
  return height;
}

function drawFittedImage(context, image, x, y, width, height, fit) {
  const sourceWidth = image.naturalWidth ?? image.videoWidth ?? image.width;
  const sourceHeight = image.naturalHeight ?? image.videoHeight ?? image.height;
  if (fit === "stretch" || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    context.drawImage(image, x, y, width, height);
    return;
  }
  const scale = (fit === "cover" ? Math.max : Math.min)(width / sourceWidth, height / sourceHeight);
  const fittedWidth = sourceWidth * scale;
  const fittedHeight = sourceHeight * scale;
  context.drawImage(image, x + (width - fittedWidth) / 2, y + (height - fittedHeight) / 2, fittedWidth, fittedHeight);
}

function drawBackgroundImage(context, content, dimensions, images) {
  const source = backgroundImageSource(content);
  const image = images instanceof Map ? images.get(source) : null;
  if (!image) return;
  drawFittedImage(context, image, 0, 0, dimensions.width, dimensions.height, backgroundImageFit(content));
}

const builtInElementRenderers = {
  spacer: {
    measure: ({ element }) => spacerHeight(element),
  },
  text: {
    measure: ({ context, element, dimensions, width }) => flowElementHeight(context, element, dimensions, width),
    draw: ({ context, element, dimensions, x, y, width, content }) => {
      const color = element.style?.variant === "flavour" || element.id === "flavour"
        ? content?.mutedTextColor ?? "#78838c"
        : content?.textColor ?? "#17212b";
      drawTextElement(context, element, dimensions, x, y, width, color, element.id === "title" ? "title" : "body");
    },
  },
  image: {
    measure: ({ element, dimensions }) => element.layout?.height ? dimensions.height * element.layout.height : 120,
    draw: ({ context, element, dimensions, x, y, width, height, images }) => drawImageElement(context, element, dimensions, x, y, width, height, images, images && !(images instanceof Map) ? images : null),
  },
};

function elementRendererFor(type, customRenderers) {
  return customRenderers?.[type] ?? builtInElementRenderers[type];
}

export function drawCardTextureContent(context, content, dimensions, images = null, { preserveBottom = false, deferFlowIds = [], gapIndex = null, elementRenderers = {} } = {}) {
  context.fillStyle = content?.background ?? "#ffffff";
  context.fillRect(0, 0, dimensions.width, dimensions.height);
  drawBackgroundImage(context, content, dimensions, images);
  const boxes = resolveAttachmentGeometry(content, dimensions, elementRenderers,
    (element, width) => registeredElementHeight(context, element, dimensions, width, elementRenderers)
      ?? flowElementHeight(context, element, dimensions, width), null,
    { preserveBottom, deferFlowIds, gapIndex });
  const ordered = [...boxes.values()].filter(({ element }) => elementVisible(element))
    .sort((a, b) => (a.mode === "overlay") - (b.mode === "overlay")
      || (a.mode === "overlay" ? (a.zIndex ?? 0) - (b.zIndex ?? 0) || String(a.element.id).localeCompare(String(b.element.id)) : 0));
  for (const { element, mode, x, y, width, height } of ordered) {
    // Overlay attachments have their own ordered, optionally clipped surfaces.
    if (mode === "overlay" && element.source === "attachment") continue;
    if (!drawRegisteredElement(context, element, dimensions, x, y, width, height, elementRenderers, images, content)) {
      drawTextElement(context, { ...element, content: { text: `Unsupported element: ${element.type}` } }, dimensions, x, y, width, "#a85f3f");
    }
  }
}

function accessibleElementText(content, accessibleLabel, elementRenderers = {}) {
  return sortedElements(content).map(({ element }) => {
    if (element.source === "attachment") {
      const label = accessibleLabel?.({ element }) ?? elementRenderers[element.type]?.accessibleLabel?.({ element });
      if (label !== undefined) return label;
    }
    if (element.type === "text") return elementText(element);
    if (element.type === "image") return elementImageAlt(element);
    if (element.type === "spacer") return "";
    return element.content?.label ?? `${element.type} element`;
  }).filter(Boolean).join(". ");
}

function logicalFaceContent(card, side, presentation) {
  if (side === "back") return filterContentElements(attachmentContent(card, "back", presentation) ?? { elements: [{ id: "concealed", type: "text", content: { text: "Concealed" }, style: { variant: "title" } }] }, presentation);
  if (card.faceUp === false) return { elements: [] };
  if (!card.faceCycle || !card.faceCycleNextFaceId) return filterContentElements(attachmentContent(card, card.activeFaceId, presentation) ?? {}, presentation);

  return filterContentElements(attachmentContent(card, card.faceCycleNextFaceId ?? card.activeFaceId, presentation) ?? {}, presentation);
}

export function createCardGeometry(shape, {
  depth = DEFAULT_CARD_THICKNESS,
  bevelSize = CARD_BEVEL_SIZE,
  bevelSegments = CARD_BEVEL_SEGMENTS,
  curveSegments = CARD_CURVE_SEGMENTS,
} = {}) {
  // The bevel is part of the requested depth. Keep the body inside its depth
  // envelope so the face layers remain visible even on very thin cards.
  const safeBevelSize = Math.min(bevelSize, Math.max(0, depth / 2 - 0.06));
  const extrusionDepth = Math.max(0.001, depth - safeBevelSize * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: extrusionDepth,
    bevelEnabled: true,
    bevelThickness: safeBevelSize,
    bevelSize: safeBevelSize,
    bevelSegments,
    curveSegments,
  });
  geometry.translate(0, 0, -extrusionDepth / 2);
  return geometry;
}

export function createCardFaceGeometry(shape, dimensions, curveSegments = CARD_FACE_CURVE_SEGMENTS) {
  const geometry = new THREE.ShapeGeometry(shape, curveSegments);
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(
      index,
      (uv.getX(index) + dimensions.width / 2) / dimensions.width,
      (uv.getY(index) + dimensions.height / 2) / dimensions.height,
    );
  }
  uv.needsUpdate = true;
  return geometry;
}

function createCardFrameGeometry(shape, curveSegments = SELECTION_FRAME_CURVE_SEGMENTS) {
  const points = shape.getPoints(curveSegments).map(({ x, y }) => new THREE.Vector3(x, y, 0));
  return new THREE.BufferGeometry().setFromPoints(points);
}

function createSelectionHaloGeometry(shapeDefinition, outerDimensions, innerDimensions, curveSegments = CARD_FACE_CURVE_SEGMENTS) {
  const outer = createCardShape(shapeDefinition, outerDimensions);
  outer.holes = [createCardShape(shapeDefinition, innerDimensions)];
  return new THREE.ShapeGeometry(outer, curveSegments);
}

function stableGeometryValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableGeometryValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableGeometryValue(value[key])]));
}

export function cardGeometryKey(shapeDefinition, dimensions, thickness, {
  bevelSize = CARD_BEVEL_SIZE,
  bevelSegments = CARD_BEVEL_SEGMENTS,
  curveSegments = CARD_CURVE_SEGMENTS,
  faceCurveSegments = CARD_FACE_CURVE_SEGMENTS,
  selectionFrameCurveSegments = SELECTION_FRAME_CURVE_SEGMENTS,
  selectionPadding = SELECTION_FRAME_PADDING,
} = {}) {
  return JSON.stringify({
    shape: stableGeometryValue(shapeDefinition),
    dimensions: { width: dimensions.width, height: dimensions.height },
    thickness,
    bevelSize,
    bevelSegments,
    curveSegments,
    faceCurveSegments,
    selectionFrameCurveSegments,
    selectionPadding,
  });
}

export function createCardGeometryBundle(shapeDefinition, dimensions, thickness, {
  bevelSize = CARD_BEVEL_SIZE,
  bevelSegments = CARD_BEVEL_SEGMENTS,
  curveSegments = CARD_CURVE_SEGMENTS,
  faceCurveSegments = CARD_FACE_CURVE_SEGMENTS,
  selectionFrameCurveSegments = SELECTION_FRAME_CURVE_SEGMENTS,
  selectionPadding = SELECTION_FRAME_PADDING,
} = {}) {
  const width = dimensions.width;
  const height = dimensions.height;
  const shape = createCardShape(shapeDefinition, { width, height });
  const faceDimensions = {
    width: Math.max(1, width - bevelSize * 2),
    height: Math.max(1, height - bevelSize * 2),
  };
  const faceShape = createCardShape(shapeDefinition, faceDimensions);
  const selectionFrameDimensions = {
    width: faceDimensions.width + selectionPadding * 2,
    height: faceDimensions.height + selectionPadding * 2,
  };
  const selectionFrameShape = createCardShape(shapeDefinition, selectionFrameDimensions);
  return {
    bodyGeometry: createCardGeometry(shape, { depth: thickness, bevelSize, bevelSegments, curveSegments }),
    faceGeometry: createCardFaceGeometry(faceShape, faceDimensions, faceCurveSegments),
    selectionFrameGeometry: createCardFrameGeometry(selectionFrameShape, selectionFrameCurveSegments),
    selectionHaloGeometry: createSelectionHaloGeometry(shapeDefinition, selectionFrameDimensions, faceDimensions, faceCurveSegments),
  };
}

function disposeGeometryBundle(bundle) {
  const resources = new Set(Object.values(bundle ?? {}));
  for (const resource of resources) resource?.dispose?.();
}

export function createGeometryCache() {
  const entries = new Map();
  let destroyed = false;

  const releaseEntry = (key, entry) => {
    if (entry.disposed) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    if (entries.get(key) === entry) entries.delete(key);
    entry.disposed = true;
    disposeGeometryBundle(entry.value);
  };

  return {
    acquire(key, factory) {
      if (destroyed) throw new Error("Cannot acquire geometry after cache destruction");
      let entry = entries.get(key);
      if (!entry) {
        entry = { value: factory(), refs: 0, disposed: false };
        entries.set(key, entry);
      }
      entry.refs += 1;
      let released = false;
      return {
        value: entry.value,
        release() {
          if (released) return;
          released = true;
          releaseEntry(key, entry);
        },
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [key, entry] of entries) {
        entries.delete(key);
        if (entry.disposed) continue;
        entry.disposed = true;
        disposeGeometryBundle(entry.value);
      }
    },
    get size() {
      return entries.size;
    },
  };
}

export function textureDimensionsForPose(card, pose, templates = {}, elementRenderers = {}, presentation) {
  const dimensions = cardDimensions(card, templates, elementRenderers, presentation);
  const template = templates[card.template] ?? {};
  const sizing = card.sizing ?? template.sizing;
  if (sizing?.mode !== "content" || !Number.isFinite(pose?.height)) return dimensions;
  return { width: dimensions.width, height: Math.max(1, pose.height) };
}

function physicalSide(pose) {
  const facing = Math.cos(radians(pose.flipX ?? 0)) * Math.cos(radians(pose.flipY ?? 0));
  if (Math.abs(facing) < 0.000001) return "edge";
  return facing > 0 ? "front" : "back";
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function finiteBounds(bounds) {
  return bounds && [bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width > 0 && bounds.height > 0;
}

function finiteCenter(center) {
  return center && Number.isFinite(center.x) && Number.isFinite(center.y);
}

function grabRay(camera, bounds, clientPoint) {
  if (!camera || !finiteBounds(bounds) || !finitePoint(clientPoint)) return null;
  const raycaster = new THREE.Raycaster();
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera({
    x: (clientPoint.x - bounds.left) / bounds.width * 2 - 1,
    y: 1 - (clientPoint.y - bounds.top) / bounds.height * 2,
  }, camera);
  return raycaster;
}

function serializableVector(point) {
  return { x: point.x, y: point.y, z: point.z };
}

/**
 * Capture a physical point in the card's face-group coordinate system. The
 * point remains attached to the same material through a flip: a back hit is
 * anchored to the back surface, and an edge/body hit is anchored to that
 * actual 3D surface. If the ray misses the mounted geometry, the token uses
 * the transformed card reference plane (local z = 0) instead.
 */
export function captureGrabToken({ camera, bounds, cardId, cardGroup, faceGroup, pose, clientPoint, sideForObject } = {}) {
  if (typeof cardId !== "string" || !cardGroup || !faceGroup || !pose || !finitePoint(clientPoint)) return null;
  const raycaster = grabRay(camera, bounds, clientPoint);
  if (!raycaster || cardGroup.visible === false) return null;
  cardGroup.updateMatrixWorld(true);

  const intersections = raycaster.intersectObject(cardGroup, true);
  let point;
  let source = "reference-plane";
  let side;
  const hit = intersections.find((intersection) => intersection?.point && intersection.object?.visible !== false);
  if (hit) {
    point = faceGroup.worldToLocal(hit.point.clone());
    source = "surface";
    side = typeof sideForObject === "function" ? sideForObject(hit.object) : undefined;
  } else {
    const origin = faceGroup.localToWorld(new THREE.Vector3());
    const normal = faceGroup.localToWorld(new THREE.Vector3(0, 0, 1)).sub(origin).normalize();
    const referencePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const worldPoint = raycaster.ray.intersectPlane(referencePlane, new THREE.Vector3());
    if (!worldPoint) return null;
    point = faceGroup.worldToLocal(worldPoint);
    side = physicalSide(pose);
  }
  if (![point.x, point.y, point.z].every(Number.isFinite)) return null;
  return {
    version: 1,
    cardId,
    space: "card-face",
    source,
    ...(side ? { side } : {}),
    physicalSide: physicalSide(pose),
    localPoint: serializableVector(point),
  };
}

/**
 * Project a token's local material point through the renderer's card transform.
 * This mirrors update(): face flip first, then body tilt/angle, then the
 * combined rendered scale and card-group translation.
 */
export function projectGrabPoint(localPoint, pose, center = { x: 0, y: 0 }) {
  if (!localPoint || !pose || !finiteCenter(center)
    || ![localPoint.x, localPoint.y, localPoint.z, pose.x, pose.y].every(Number.isFinite)) return null;
  const renderedScale = (pose.scale ?? 1) * (pose.layoutScale ?? 1) * (pose.depthScale ?? 1);
  if (!Number.isFinite(renderedScale)) return null;
  const point = new THREE.Vector3(localPoint.x, localPoint.y, localPoint.z);
  point.applyEuler(new THREE.Euler(
    radians(pose.flipX ?? 0),
    radians(pose.flipY ?? 0),
    0,
    "YXZ",
  ));
  point.applyEuler(new THREE.Euler(
    radians(pose.tiltX ?? 0),
    radians(pose.tiltY ?? 0),
    radians(pose.angle ?? 0),
    "ZXY",
  ));
  point.multiplyScalar(renderedScale);
  point.add(new THREE.Vector3(pose.x - center.x, center.y - pose.y, pose.z ?? 0));
  return point;
}

/**
 * Return a scene-coordinate correction for a final rendered pose. This pure
 * helper returns a delta; the renderer capability below converts it to the
 * absolute x/y fields expected by scene render merging. z is deliberately
 * omitted so the scene-owned render layer is preserved.
 */
export function resolveGrabCorrection({ camera, bounds, center = { x: 0, y: 0 }, pose, grabToken, clientPoint } = {}) {
  if (!grabToken?.localPoint || !finitePoint(clientPoint) || !finiteCenter(center)) return null;
  const grabbedWorld = projectGrabPoint(grabToken.localPoint, pose, center);
  const raycaster = grabRay(camera, bounds, clientPoint);
  if (!grabbedWorld || !raycaster) return null;
  const target = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -grabbedWorld.z),
    new THREE.Vector3(),
  );
  if (!target) return null;
  const correction = { x: target.x - grabbedWorld.x, y: -(target.y - grabbedWorld.y) };
  return [correction.x, correction.y].every(Number.isFinite) ? correction : null;
}

const INTERACTION_PHASES = new Set(["dragging", "pending"]);
const INTERACTION_ALLOWED_COLOR = 0xe5c07b;
const INTERACTION_DENIED_COLOR = 0xf87171;
const INTERACTION_PREVIEW_RENDER_ORDER = 100000;

function cardRootFor(object) {
  while (object && !object.userData?.cardId) object = object.parent;
  return object;
}

export function selectCardIntersection(intersections, cards) {
  const nearestHitByCard = new Map();
  for (const intersection of intersections ?? []) {
    const root = cardRootFor(intersection.object);
    const cardId = root?.userData?.cardId;
    if (!cardId || nearestHitByCard.has(cardId) && nearestHitByCard.get(cardId).distance <= intersection.distance) continue;
    // Keep the intersected mesh for side reporting; the root is only used for identity.
    nearestHitByCard.set(cardId, { ...intersection, cardId });
  }
  return [...nearestHitByCard.values()].sort((first, second) => {
    const firstOrder = cards.get(first.cardId)?.cardGroup.renderOrder ?? 0;
    const secondOrder = cards.get(second.cardId)?.cardGroup.renderOrder ?? 0;
    return secondOrder - firstOrder || first.distance - second.distance || String(first.cardId).localeCompare(String(second.cardId));
  })[0] ?? null;
}

export function cardSideForIntersection(object, mounted) {
  if (object.userData?.attachmentId) return object.userData.cardSide ?? "edge";
  return object === mounted.back || object === mounted.backBase ? "back"
    : object === mounted.front || object === mounted.frontBase ? "front"
      : "edge";
}

function accessibleContent(card, pose, presentation) {
  const side = card.faceUp === false ? "back" : physicalSide(pose);
  if (side === "edge") return { side, content: { elements: [{ id: "edge", type: "text", content: { text: "Card edge" } }] } };
  if (side === "back") return { side, content: filterContentElements(attachmentContent(card, "back", presentation) ?? { elements: [{ id: "concealed", type: "text", content: { text: "Concealed card" } }] }, presentation) };
  return { side, content: filterContentElements(attachmentContent(card, card.faceCycleNextFaceId ?? card.activeFaceId, presentation) ?? {}, presentation) };
}

export function createWebGLRenderer({ element, templates = {}, camera: cameraOptions = {}, elementRenderers = {}, onStatus = () => {}, onAction, accessibleLabel } = {}) {
  if (!element) return createHeadlessRenderer({ reason: "no-element" });
  if (typeof document === "undefined") throw new Error("Cardinal WebGL renderer requires a browser document");

  const canvas = document.createElement("canvas");
  let webgl;
  try {
    const nativeGetContext = canvas.getContext.bind(canvas);
    canvas.getContext = (name, attributes) => {
      const context = nativeGetContext(name, attributes);
      return name === "webgl2" ? normalizeWebGLContext(context) : context;
    };
    webgl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cardinal WebGL renderer initialization failed: ${message}`);
  }

  const renderScene = new THREE.Scene();
  const projection = cameraOptions.projection ?? "orthographic";
  const scaleMode = cameraOptions.scaleMode ?? (cameraOptions.width !== undefined || cameraOptions.height !== undefined ? "fit" : "stage");
  const unitsPerPixel = cameraOptions.unitsPerPixel ?? 1;
  const sceneWidth = cameraOptions.width;
  const sceneHeight = cameraOptions.height;
  const center = cameraOptions.center ?? { x: 0, y: 0 };
  if (![center.x, center.y].every(Number.isFinite)) throw new RangeError("Camera center must be finite");
  let stageSize = elementSize(element);
  let viewport = cameraViewportForStage({
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
    sceneWidth,
    sceneHeight,
    projection,
    scaleMode,
    unitsPerPixel,
  });
  let camera = createCardCamera({
    ...cameraOptions,
    projection,
    ...viewport,
  });
  const ambient = new THREE.AmbientLight(0xffffff, 1.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-240, 360, 700);
  renderScene.add(ambient, keyLight);
  canvas.className = "cardinal-webgl-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  element.classList.add("cardinal-stage");
  element.append(canvas);
  element.classList.add("cardinal-stage--webgl");
  const accessibilityLayer = document.createElement("div");
  accessibilityLayer.className = "cardinal-webgl-accessibility";
  element.append(accessibilityLayer);
  const attachmentControlsLayer = document.createElement("div");
  attachmentControlsLayer.className = "cardinal-webgl-attachment-controls-layer";
  element.append(attachmentControlsLayer);

  let contextAvailable = true;
  let disposed = false;
  let rendererReason = null;
  const setRendererReason = (reason) => {
    rendererReason = reason;
    onStatus({ reason });
  };
  const handleContextLost = (event) => {
    event.preventDefault();
    contextAvailable = false;
    setRendererReason("webgl-context-lost");
  };
  const handleContextRestored = () => {
    contextAvailable = true;
    setRendererReason("webgl-context-restored");
    for (const mounted of cards.values()) {
      mounted.frontKey = null;
      mounted.backKey = null;
      if (mounted.lastCard && mounted.lastPose) update(mounted.lastCard, mounted.lastPose, { render: false, presentation: mounted.lastPresentation });
    }
    render();
  };
  canvas.addEventListener("webglcontextlost", handleContextLost, false);
  canvas.addEventListener("webglcontextrestored", handleContextRestored, false);

  const cards = new Map();
  const readyTextures = new WeakSet();
  let imageRenderFrame = null;
  let selectionHighlightVisible = true;
  const imageCache = new Map();
  const texturePool = createTexturePool();
  const measureContext = document.createElement("canvas").getContext("2d");
  const geometryCache = createGeometryCache();
  const selectionFrameMaterials = {
    primary: new THREE.LineBasicMaterial({ color: 0xffd166, depthWrite: false, toneMapped: false }),
    secondary: new THREE.LineBasicMaterial({ color: 0x8fc9ff, depthWrite: false, toneMapped: false }),
  };
  const selectionHaloMaterials = {
    primary: new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    secondary: new THREE.MeshBasicMaterial({ color: 0x50b7ff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  };
  // Cumulative counters are sampled explicitly, never through scene snapshots.
  const work = { renders: 0, renderCpuMs: 0, textureCreates: 0, textureDraws: 0, textureDrawCpuMs: 0, textureUploads: 0, geometryBuilds: 0 };
  const interactionPreview = new THREE.Group();
  interactionPreview.userData.interactionPreview = true;
  renderScene.add(interactionPreview);
  let interactionSessions = [];
  let interactionPreviewKey = null;
  let selectedCardIds = new Set();
  let primaryCardId = null;
  let drawOrderRevision = 0;
  let cardsRevision = 0;
  let interactionPrioritySessionKey = null;
  let interactionPriorityDrawRevision = -1;
  let interactionPriorityCardsRevision = -1;
  let interactionPriorityAssignments = new Map();
  let interactionPriorityCardIds = new Set();
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  const handleWindowResize = () => {
    if (!resizeObserver) resize();
  };
  resizeObserver?.observe(element);
  window.addEventListener("resize", handleWindowResize);

  function resize() {
    if (disposed) return;
    stageSize = elementSize(element);
    const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    webgl.setPixelRatio(pixelRatio);
    webgl.setSize(stageSize.width, stageSize.height, false);
    viewport = cameraViewportForStage({
      stageWidth: stageSize.width,
      stageHeight: stageSize.height,
      sceneWidth,
      sceneHeight,
      projection,
      scaleMode,
      unitsPerPixel,
    });
    camera = createCardCamera({
      ...cameraOptions,
      projection,
      ...viewport,
    });
    onStatus({ reason: rendererReason, viewport: { ...viewport, center: { ...center }, scaleMode, unitsPerPixel } });
    render();
  }

  function render() {
    if (disposed || !contextAvailable) return;
    const started = performance.now();
    webgl.render(renderScene, camera);
    work.renders += 1;
    work.renderCpuMs += performance.now() - started;
  }

  function cachedImage(source) {
    const existing = imageCache.get(source);
    if (existing) return existing;
    let resolveImage;
    let rejectImage;
    const promise = new Promise((resolve, reject) => {
      resolveImage = resolve;
      rejectImage = reject;
    });
    const image = new Image();
    const entry = { image, loaded: false, failed: false, promise,
      cancel: () => rejectImage(new Error("Card image load cancelled by renderer disposal")) };
    image.onload = () => {
      entry.loaded = true;
      resolveImage(image);
    };
    image.onerror = () => {
      entry.failed = true;
      rejectImage(new Error(`Card image failed to load: ${source}`));
    };
    imageCache.set(source, entry);
    image.src = source;
    if (image.complete && image.naturalWidth > 0) {
      entry.loaded = true;
      resolveImage(image);
    }
    return entry;
  }

  function makeTexture(content, dimensions, options = {}) {
    const resolution = Math.min(4, Math.max(2, (globalThis.devicePixelRatio || 1) * 2));
    const canvas2d = document.createElement("canvas");
    canvas2d.width = Math.round(dimensions.width * resolution);
    canvas2d.height = Math.round(dimensions.height * resolution);
    const context = canvas2d.getContext("2d");
    if (!context) return null;
    context.scale(resolution, resolution);
    const texture = new THREE.CanvasTexture(canvas2d);
    work.textureCreates += 1;
    texture.onUpdate = () => { work.textureUploads += 1; };
    let textureDisposed = false;
    texture.addEventListener("dispose", () => { textureDisposed = true; });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = webgl.capabilities.getMaxAnisotropy();
    const imageSources = imageSourcesForContent(content);
    const imageEntries = imageSources
      .filter(Boolean)
      .filter((source, index, sources) => sources.indexOf(source) === index)
      .map((source) => [source, cachedImage(source)]);
    const images = new Map(imageEntries.filter(([, entry]) => entry.loaded).map(([source, entry]) => [source, entry.image]));
    const draw = () => {
      const started = performance.now();
      drawCardTextureContent(context, content, dimensions, images, { ...options, elementRenderers });
      work.textureDraws += 1;
      work.textureDrawCpuMs += performance.now() - started;
    };
    // Publish one complete raster, never the background/text/image fragments
    // produced while independent sources are still arriving. Failed sources
    // settle too, so the existing missing-image fallback remains usable.
    const finish = () => {
      if (disposed || textureDisposed) return;
      draw();
      readyTextures.add(texture);
      texture.needsUpdate = true;
    };
    if (imageEntries.every(([, entry]) => entry.loaded || entry.failed)) {
      finish();
    } else {
      Promise.all(imageEntries.map(([source, entry]) => entry.promise.then(
        (image) => { images.set(source, image); },
        (error) => { if (!disposed && !textureDisposed) onStatus({ reason: "asset-load-failed", source, error }); },
      ))).then(() => {
        if (disposed || textureDisposed) return;
        finish();
        for (const mounted of cards.values()) {
          if (mounted.frontTexture === texture || mounted.backTexture === texture) updateReadyVisibility(mounted);
        }
        // Many faces can finish in the same turn; submit the scene only once.
        if (imageRenderFrame === null) imageRenderFrame = requestAnimationFrame(() => {
          imageRenderFrame = null;
          render();
        });
      });
    }
    return texture;
  }

  function makeAttachmentTexture(element, width, height) {
    const resolution = Math.min(4, Math.max(2, (globalThis.devicePixelRatio || 1) * 2));
    const canvas2d = document.createElement("canvas");
    canvas2d.width = Math.max(1, Math.round(width * resolution));
    canvas2d.height = Math.max(1, Math.round(height * resolution));
    const context = canvas2d.getContext("2d");
    if (!context) return null;
    context.scale(resolution, resolution);
    context.clearRect(0, 0, width, height);
    const content = { textColor: "#17212b", mutedTextColor: "#78838c" };
    const source = elementContent(element)?.src;
    const images = source && imageCache.get(source)?.loaded ? new Map([[source, imageCache.get(source).image]]) : null;
    if (!drawRegisteredElement(context, element, { width, height }, 0, 0, width, height, elementRenderers, images, content)) {
      drawTextElement(context, { ...element, content: { text: `Unsupported element: ${element.type}` } }, { width, height }, 0, 0, width, "#a85f3f");
    }
    const texture = new THREE.CanvasTexture(canvas2d);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = webgl.capabilities.getMaxAnisotropy();
    work.textureCreates += 1;
    return texture;
  }

  function makeClippedAttachmentMaterial(texture, dimensions, box) {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        box: { value: new THREE.Vector4(box.x, box.y, box.width, box.height) },
        dimensions: { value: new THREE.Vector2(dimensions.width, dimensions.height) },
      },
      vertexShader: `varying vec2 cardinalLocal; void main() { cardinalLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform vec4 box; uniform vec2 dimensions; varying vec2 cardinalLocal;
        void main() {
          vec2 point = vec2(cardinalLocal.x + dimensions.x * 0.5, dimensions.y * 0.5 - cardinalLocal.y);
          if (point.x < box.x || point.y < box.y || point.x > box.x + box.z || point.y > box.y + box.w) discard;
          vec2 uv = vec2((point.x - box.x) / max(box.z, 0.0001), 1.0 - (point.y - box.y) / max(box.w, 0.0001));
          gl_FragColor = texture2D(map, uv);
          if (gl_FragColor.a < 0.001) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  function attachmentGeometry(mounted, content, dimensions, side, presentation) {
    return resolveAttachmentGeometry(content, dimensions, elementRenderers,
      (element, width) => registeredElementHeight(measureContext, element, dimensions, width, elementRenderers)
        ?? flowElementHeight(measureContext, element, dimensions, width), presentation,
      mounted[`${side}LayoutOptions`]);
  }

  function updateAttachmentPlanes(mounted, card, content, dimensions, side, presentation) {
    const boxes = attachmentGeometry(mounted, content, dimensions, side, presentation);
    const wanted = new Map();
    for (const [id, box] of side === "edge" ? [] : boxes) {
      const element = box.element;
      if (element?.source !== "attachment" || box.mode !== "overlay") continue;
      const source = elementImageSource(element) ?? elementContent(element)?.src;
      const imageEntry = source ? cachedImage(source) : null;
      const key = JSON.stringify([mounted.geometryKey, id, element, box.width, box.height, box.x, box.y, box.clip, box.zIndex, side, imageEntry?.loaded === true]);
      wanted.set(id, { element, box, key, imageEntry });
    }
    const orderedWanted = [...wanted.values()].sort((first, second) =>
      (first.box.zIndex ?? 0) - (second.box.zIndex ?? 0)
      || String(first.element.attachmentId ?? first.element.id).localeCompare(String(second.element.attachmentId ?? second.element.id)));
    for (const [index, next] of orderedWanted.entries()) next.renderOrder = 3 + index;
    for (const [id, current] of mounted.attachmentPlanes) {
      const next = wanted.get(id);
      if (next?.key === current.key) continue;
      mounted.faceGroup.remove(current.mesh);
      current.material.map = null;
      current.texture.dispose();
      current.material.dispose();
      if (current.ownsGeometry) current.geometry.dispose();
      mounted.attachmentPlanes.delete(id);
    }
    for (const [id, next] of wanted) {
      const existing = mounted.attachmentPlanes.get(id);
      if (existing) {
        existing.mesh.renderOrder = next.renderOrder;
        continue;
      }
      const texture = makeAttachmentTexture(next.element, Math.max(1, next.box.width), Math.max(1, next.box.height));
      if (!texture) continue;
      const material = next.box.clip
        ? makeClippedAttachmentMaterial(texture, dimensions, next.box)
        : new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const geometry = next.box.clip ? mounted.front.geometry : new THREE.PlaneGeometry(next.box.width, next.box.height);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(next.box.clip ? 0 : (side === "back" ? -(next.box.x + next.box.width / 2 - dimensions.width / 2) : next.box.x + next.box.width / 2 - dimensions.width / 2),
        next.box.clip ? 0 : dimensions.height / 2 - next.box.y - next.box.height / 2,
        side === "back" ? -mounted.thickness / 2 - 0.08 : mounted.thickness / 2 + 0.08);
      mesh.rotation.y = side === "back" ? Math.PI : 0;
      mesh.renderOrder = next.renderOrder;
      mesh.userData.attachmentId = id;
      mesh.userData.cardSide = side;
      mesh.userData.clip = next.box.clip;
      mounted.faceGroup.add(mesh);
      const record = { mesh, material, geometry: mesh.geometry, texture, key: next.key, ownsGeometry: !next.box.clip };
      mounted.attachmentPlanes.set(id, record);
      if (next.imageEntry && !next.imageEntry.loaded) {
        next.imageEntry.promise.then(() => {
          if (disposed || cards.get(card.id) !== mounted || mounted.attachmentPlanes.get(id) !== record) return;
          update(mounted.lastCard, mounted.lastPose, { render: true, presentation: mounted.lastPresentation });
        }, () => {});
      }
    }
  }

  function mount(card, dimensions, thickness) {
    if (cards.has(card.id)) return cards.get(card.id);
    const width = dimensions.width;
    const height = dimensions.height;
    const depth = thickness;
    const shapeDefinition = card.shape ?? templates[card.template]?.shape;
    const geometryKey = cardGeometryKey(shapeDefinition, dimensions, depth);
    const geometryLease = geometryCache.acquire(geometryKey, () => {
      work.geometryBuilds += 1;
      return createCardGeometryBundle(shapeDefinition, dimensions, depth);
    });
    const geometryBundle = geometryLease.value;
    const geometry = geometryBundle.bodyGeometry;
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x17212b, roughness: 0.62, metalness: 0 });
    const sideMaterial = new THREE.MeshStandardMaterial({ color: 0x727d86, roughness: 0.75, metalness: 0 });
    const body = new THREE.Mesh(geometry, [bodyMaterial, sideMaterial]);
    const frontBaseGeometry = geometryBundle.faceGeometry;
    const backBaseGeometry = geometryBundle.faceGeometry;
    const frontBaseMaterial = createCardFaceBaseMaterial(0x17212b);
    const backBaseMaterial = createCardFaceBaseMaterial(0x17212b);
    const frontBase = new THREE.Mesh(frontBaseGeometry, frontBaseMaterial);
    const backBase = new THREE.Mesh(backBaseGeometry, backBaseMaterial);
    const frontMaterial = createCardFaceMaterial();
    const backMaterial = createCardFaceMaterial();
    const selectionFront = new THREE.LineLoop(geometryBundle.selectionFrameGeometry, selectionFrameMaterials.secondary);
    const selectionBack = new THREE.LineLoop(geometryBundle.selectionFrameGeometry, selectionFrameMaterials.secondary);
    const selectionFrontHalo = new THREE.Mesh(geometryBundle.selectionHaloGeometry, selectionHaloMaterials.secondary);
    const selectionBackHalo = new THREE.Mesh(geometryBundle.selectionHaloGeometry, selectionHaloMaterials.secondary);
    const front = new THREE.Mesh(geometryBundle.faceGeometry, frontMaterial);
    const back = new THREE.Mesh(geometryBundle.faceGeometry, backMaterial);
    frontBase.renderOrder = 1;
    backBase.renderOrder = 1;
    selectionFront.renderOrder = 1.5;
    selectionBack.renderOrder = 1.5;
    selectionFrontHalo.renderOrder = 1.45;
    selectionBackHalo.renderOrder = 1.45;
    front.renderOrder = 2;
    back.renderOrder = 2;
    frontBase.position.z = depth / 2 + 0.04;
    backBase.position.z = -depth / 2 - 0.04;
    selectionFront.position.z = depth / 2 + 0.05;
    selectionBack.position.z = -depth / 2 - 0.05;
    selectionFrontHalo.position.z = depth / 2 + 0.045;
    selectionBackHalo.position.z = -depth / 2 - 0.045;
    front.position.z = depth / 2 + 0.06;
    back.position.z = -depth / 2 - 0.06;
    backBase.rotation.y = Math.PI;
    selectionBack.rotation.y = Math.PI;
    back.rotation.y = Math.PI;
    selectionFront.visible = false;
    selectionBack.visible = false;
    selectionFrontHalo.visible = false;
    selectionBackHalo.visible = false;
    const faceGroup = new THREE.Group();
    faceGroup.add(body, frontBase, backBase, selectionFrontHalo, selectionBackHalo, selectionFront, selectionBack, front, back);
    const cardGroup = new THREE.Group();
    cardGroup.userData.cardId = card.id;
    const bodyGroup = new THREE.Group();
    const pivotGroup = new THREE.Group();
    pivotGroup.add(bodyGroup);
    bodyGroup.add(faceGroup);
    cardGroup.add(pivotGroup);
    renderScene.add(cardGroup);
    const accessibilityShell = document.createElement("article");
    accessibilityShell.className = "cardinal-webgl-card";
    accessibilityShell.dataset.cardId = card.id;
    accessibilityShell.setAttribute("tabindex", "0");
    accessibilityShell.setAttribute("role", "button");
    accessibilityLayer.append(accessibilityShell);
    const mounted = {
      cardGroup,
      pivotGroup,
      bodyGroup,
      faceGroup,
      front,
      back,
      frontMaterial,
      backMaterial,
      frontBaseGeometry,
      backBaseGeometry,
      frontBaseMaterial,
      backBaseMaterial,
      selectionFront,
      selectionBack,
      selectionFrontHalo,
      selectionBackHalo,
      geometryLease,
      geometryKey,
      selectionFrontGeometry: geometryBundle.selectionFrameGeometry,
      selectionBackGeometry: geometryBundle.selectionFrameGeometry,
      selectionHaloGeometry: geometryBundle.selectionHaloGeometry,
      geometry,
      bodyMaterial,
      sideMaterial,
      accessibilityShell,
      frontTexture: null,
      backTexture: null,
      frontLease: null,
      backLease: null,
      frontKey: null,
      backKey: null,
      frontContent: null,
      backContent: null,
      frontContentKey: null,
      backContentKey: null,
      frontTransition: null,
      backTransition: null,
      accessibilityCard: null,
      accessibilityFaceId: null,
      accessibilityNextFaceId: null,
      accessibilitySide: null,
      accessibilityContentKey: null,
      textureCard: null,
      textureActiveFaceId: null,
      textureNextFaceId: null,
      textureFrontFaceId: null,
      textureBackFaceId: null,
      textureWidth: null,
      textureHeight: null,
      textureTargetWidth: null,
      textureTargetHeight: null,
      texturePresentationKey: null,
      frontSuppressed: false,
      concealFrontRetained: false,
      width,
      height,
      thickness,
      attachmentPlanes: new Map(),
      controlsMounted: false,
    };
    mounted.body = body;
    mounted.frontBase = frontBase;
    mounted.backBase = backBase;
    cards.set(card.id, mounted);
    cardsRevision += 1;
    return mounted;
  }

  function updateGeometry(mounted, card, dimensions, thickness) {
    const shapeDefinition = card.shape ?? templates[card.template]?.shape;
    const geometryKey = cardGeometryKey(shapeDefinition, dimensions, thickness);
    if (mounted.geometryKey === geometryKey) return;
    const geometryLease = geometryCache.acquire(geometryKey, () => {
      work.geometryBuilds += 1;
      return createCardGeometryBundle(shapeDefinition, dimensions, thickness);
    });
    const geometryBundle = geometryLease.value;
    const oldGeometryLease = mounted.geometryLease;
    mounted.geometryLease = geometryLease;
    mounted.geometryKey = geometryKey;
    mounted.geometry = geometryBundle.bodyGeometry;
    mounted.frontBaseGeometry = geometryBundle.faceGeometry;
    mounted.backBaseGeometry = geometryBundle.faceGeometry;
    mounted.body.geometry = geometryBundle.bodyGeometry;
    mounted.frontBase.geometry = geometryBundle.faceGeometry;
    mounted.backBase.geometry = geometryBundle.faceGeometry;
    mounted.selectionFront.geometry = geometryBundle.selectionFrameGeometry;
    mounted.selectionBack.geometry = geometryBundle.selectionFrameGeometry;
    mounted.selectionFrontHalo.geometry = geometryBundle.selectionHaloGeometry;
    mounted.selectionBackHalo.geometry = geometryBundle.selectionHaloGeometry;
    mounted.front.geometry = geometryBundle.faceGeometry;
    mounted.back.geometry = geometryBundle.faceGeometry;
    mounted.width = dimensions.width;
    mounted.height = dimensions.height;
    mounted.thickness = thickness;
    mounted.frontBase.position.z = thickness / 2 + 0.04;
    mounted.backBase.position.z = -thickness / 2 - 0.04;
    mounted.selectionFront.position.z = thickness / 2 + 0.05;
    mounted.selectionBack.position.z = -thickness / 2 - 0.05;
    mounted.selectionFrontHalo.position.z = thickness / 2 + 0.045;
    mounted.selectionBackHalo.position.z = -thickness / 2 - 0.045;
    mounted.front.position.z = thickness / 2 + 0.06;
    mounted.back.position.z = -thickness / 2 - 0.06;
    mounted.selectionFrontGeometry = geometryBundle.selectionFrameGeometry;
    mounted.selectionBackGeometry = geometryBundle.selectionFrameGeometry;
    mounted.selectionHaloGeometry = geometryBundle.selectionHaloGeometry;
    oldGeometryLease.release();
  }

  function updateTexture(mounted, side, content, dimensions, targetDimensions, identity = null) {
    const contentStateName = `${side}Content`;
    const contentStateKeyName = `${side}ContentKey`;
    const transitionName = `${side}Transition`;
    const structureKey = JSON.stringify([identity, contentIdentityKey(content)]);
    if (mounted[contentStateKeyName] !== structureKey) {
      mounted[transitionName] = flowTransitionPolicy(mounted[contentStateName], content);
      mounted[contentStateName] = content;
      mounted[contentStateKeyName] = structureKey;
    }
    const transition = mounted[transitionName] ?? { preserveBottom: false, deferFlowIds: [], gapIndex: null };
    const isResizing = Math.abs(dimensions.height - targetDimensions.height) > 0.0001;
    const isGrowing = dimensions.height < targetDimensions.height - 0.0001;
    const options = {
      preserveBottom: isResizing && transition.preserveBottom,
      deferFlowIds: isResizing && isGrowing ? transition.deferFlowIds : [],
      gapIndex: transition.gapIndex,
    };
    mounted[`${side}LayoutOptions`] = options;
    const key = JSON.stringify([structureKey, contentKey(content, dimensions), options.preserveBottom === true, options.deferFlowIds, options.gapIndex]);
    const keyName = `${side}Key`;
    if (mounted[keyName] === key) {
      if (!isResizing) mounted[transitionName] = null;
      return;
    }
    // Project renderers can depend on state outside the serialized face inputs.
    // Give them private textures; built-in faces share only active references.
    const usesCustomRenderer = contentElements(content).some((element) => elementRenderers[element.type]);
    const poolKey = usesCustomRenderer ? Symbol()
      : JSON.stringify([globalThis.devicePixelRatio || 1, key]);
    const lease = texturePool.acquire(poolKey, () => makeTexture(content, dimensions, options));
    if (!lease) return;
    const textureName = `${side}Texture`;
    mounted[`${side}Material`].map = null;
    mounted[`${side}Lease`]?.release();
    mounted[`${side}Lease`] = lease;
    mounted[textureName] = lease.texture;
    mounted[`${side}Material`].map = lease.texture;
    mounted[`${side}Material`].needsUpdate = true;
    mounted[keyName] = key;
    if (!isResizing) mounted[transitionName] = null;
  }

  function releaseFrontTexture(mounted) {
    mounted.frontMaterial.map = null;
    mounted.frontLease?.release();
    mounted.frontLease = null;
    mounted.frontTexture = null;
    mounted.frontMaterial.needsUpdate = true;
    mounted.frontKey = null;
    mounted.frontContent = null;
    mounted.frontContentKey = null;
    mounted.frontTransition = null;
    mounted.frontSuppressed = true;
    mounted.concealFrontRetained = false;
  }

  function updateReadyVisibility(mounted) {
    const frontReady = mounted.frontSuppressed || readyTextures.has(mounted.frontTexture);
    const backReady = readyTextures.has(mounted.backTexture);
    const visibility = resolveFaceVisibility({
      faceUp: mounted.lastCard?.faceUp,
      frontSuppressed: mounted.frontSuppressed,
      frontReady,
      backReady,
      poseVisible: mounted.lastPose?.visible,
      flipX: mounted.lastPose?.flipX,
      flipY: mounted.lastPose?.flipY,
    });
    mounted.front.visible = visibility.front;
    mounted.frontBase.visible = visibility.frontBase;
    mounted.back.visible = visibility.back;
    mounted.backBase.visible = visibility.backBase;
    mounted.cardGroup.visible = visibility.card;
    mounted.accessibilityShell.hidden = !visibility.card;
    mounted.accessibilityShell.inert = !visibility.card;
  }

  function update(card, pose, { render: shouldRender = true, presentation } = {}) {
    const targetDimensions = cardDimensions(card, templates, elementRenderers, presentation);
    const dimensions = { width: pose.width ?? targetDimensions.width, height: pose.height ?? targetDimensions.height };
    const textureDimensions = textureDimensionsForPose(card, pose, templates, elementRenderers, presentation);
    const thickness = pose.thickness ?? cardThickness(card, templates);
    const mounted = mount(card, textureDimensions, thickness);
    const feedback = card.feedback ?? {};
    mounted.accessibilityShell.dataset.disabled = String(feedback.disabled === true);
    mounted.accessibilityShell.dataset.actionable = String(feedback.actionable === true);
    mounted.accessibilityShell.dataset.pending = String(feedback.pending === true);
    mounted.accessibilityShell.setAttribute("aria-disabled", String(feedback.disabled === true));
    mounted.accessibilityShell.setAttribute("aria-busy", String(feedback.pending === true));
    mounted.lastCard = card;
    mounted.lastPose = pose;
    mounted.lastPresentation = presentation;
    const physical = physicalSide(pose);
    const canRetainPublicFront = card.faceUp === false
      && physical !== "back"
      && mounted.frontTexture
      && !mounted.frontSuppressed
      && (mounted.concealFrontRetained || mounted.textureCard?.faceUp !== false);
    if (canRetainPublicFront) mounted.concealFrontRetained = true;
    if (card.faceUp === false && mounted.concealFrontRetained && physical === "back") {
      releaseFrontTexture(mounted);
    }
    const drawOrder = pose.drawOrder ?? 0;
    if (mounted.drawOrder !== drawOrder) drawOrderRevision += 1;
    mounted.drawOrder = drawOrder;
    updateGeometry(mounted, card, dimensions, thickness);
    const controlsRenderedScale = pose.scale * (pose.layoutScale ?? 1) * (pose.depthScale ?? 1);
    const x = pose.x - center.x;
    const y = center.y - pose.y;
    mounted.cardGroup.position.set(x, y, pose.z);
    if (!interactionPriorityCardIds.has(card.id)) mounted.cardGroup.renderOrder = mounted.drawOrder;
    mounted.cardGroup.scale.setScalar(controlsRenderedScale);
    mounted.bodyGroup.rotation.order = "ZXY";
    mounted.bodyGroup.rotation.set(radians(pose.tiltX), radians(pose.tiltY), radians(pose.angle));
    mounted.faceGroup.rotation.order = "YXZ";
    mounted.faceGroup.rotation.set(radians(pose.flipX ?? 0), radians(pose.flipY ?? 0), 0);
    const accessible = accessibleContent(card, pose, presentation);
    const faceId = card.faceCycleNextFaceId ?? card.activeFaceId;
    const presentationKey = JSON.stringify([presentation?.elements ?? null, presentation?.visibility ?? null]);
    const textureDimensionsChanged = mounted.textureWidth !== textureDimensions.width
      || mounted.textureHeight !== textureDimensions.height
      || mounted.textureTargetWidth !== targetDimensions.width
      || mounted.textureTargetHeight !== targetDimensions.height;
    const textureInputsChanged = mounted.textureCard !== card
      || mounted.textureActiveFaceId !== card.activeFaceId
      || mounted.textureNextFaceId !== card.faceCycleNextFaceId
      || mounted.textureFrontFaceId !== faceId
      || mounted.textureBackFaceId !== card.back
      || mounted.texturePresentationKey !== presentationKey
      || textureDimensionsChanged
      || (card.faceUp !== false && mounted.frontKey === null)
      || (card.faceUp === false && !mounted.frontSuppressed)
      || mounted.backKey === null;
    if (textureInputsChanged) {
      if (card.faceUp !== false) {
        updateTexture(mounted, "front", logicalFaceContent(card, "front", presentation), textureDimensions, targetDimensions, faceId);
        mounted.frontSuppressed = false;
        mounted.concealFrontRetained = false;
      } else if (mounted.concealFrontRetained) {
        mounted.frontSuppressed = false;
      } else {
        releaseFrontTexture(mounted);
      }
      updateTexture(mounted, "back", logicalFaceContent(card, "back", presentation), textureDimensions, targetDimensions, "back");
      mounted.textureCard = card;
      mounted.textureActiveFaceId = card.activeFaceId;
      mounted.textureNextFaceId = card.faceCycleNextFaceId;
      mounted.textureFrontFaceId = faceId;
      mounted.textureBackFaceId = card.back;
      mounted.textureWidth = textureDimensions.width;
      mounted.textureHeight = textureDimensions.height;
      mounted.textureTargetWidth = targetDimensions.width;
      mounted.textureTargetHeight = targetDimensions.height;
      mounted.texturePresentationKey = presentationKey;
    }
    const attachmentSide = card.faceUp === false && physical !== "back" ? "edge" : physical;
    const attachmentList = card.attachments ?? [];
    if (attachmentList.length > 0 || mounted.attachmentPlanes.size > 0) {
      updateAttachmentPlanes(mounted, card, logicalFaceContent(card, attachmentSide === "back" ? "back" : "front", presentation), dimensions,
        attachmentSide, presentation);
    }
    const accessibilitySelectionChanged = mounted.accessibilityCard !== card
      || mounted.accessibilityFaceId !== card.activeFaceId
      || mounted.accessibilityNextFaceId !== card.faceCycleNextFaceId
      || mounted.accessibilityPresentationKey !== presentationKey
      || mounted.accessibilitySide !== accessible.side;
    if (accessibilitySelectionChanged) {
      const accessibleContentKey = contentIdentityKey(accessible.content);
      if (mounted.accessibilityContentKey !== accessibleContentKey || accessibilitySelectionChanged) {
        const description = accessibleElementText(accessible.content, accessibleLabel, elementRenderers);
        const accessibleText = accessible.side === "back" ? ["Concealed card", description].filter(Boolean).join(". ") : description;
        mounted.accessibilityShell.textContent = accessibleText || "Card";
        mounted.accessibilityShell.setAttribute("aria-label", mounted.accessibilityShell.textContent);
      }
      mounted.accessibilityCard = card;
      mounted.accessibilityFaceId = card.activeFaceId;
      mounted.accessibilityNextFaceId = card.faceCycleNextFaceId;
      mounted.accessibilitySide = accessible.side;
      mounted.accessibilityContentKey = accessibleContentKey;
      mounted.accessibilityPresentationKey = presentationKey;
    }
    updateReadyVisibility(mounted);
    const controlsSide = card.faceUp === false
      ? (physical === "back" ? "back" : "edge")
      : physical;
    const controlsVisible = mounted.cardGroup.visible && pose.visible !== false && controlsSide !== "edge"
      && card.feedback?.disabled !== true;
    if (attachmentList.length > 0 || mounted.controlsMounted) {
      const controlsContent = logicalFaceContent(card, controlsSide === "back" ? "back" : "front", presentation);
      const controlsBoxes = attachmentGeometry(mounted, controlsContent, dimensions, controlsSide, presentation);
      reconcileAttachmentControls({
        shell: mounted.accessibilityShell,
        layer: attachmentControlsLayer,
        card,
        content: controlsContent,
        accessibleLabel: accessibleLabel ?? (({ element }) => elementRenderers[element.type]?.accessibleLabel?.({ element })),
        onAction,
        canActivate: (event) => {
          if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return true;
          const point = clientToScene({ x: event.clientX, y: event.clientY });
          const hit = point ? hitTest(point) : null;
          return !hit || hit.cardId === card.id;
        },
        visible: controlsVisible,
        positionFor: (attachment) => {
          const box = controlsBoxes.get(attachment.id);
          if (!box) return null;
          const clipped = box.clip !== false;
          const left = clipped ? Math.max(0, box.x) : box.x;
          const top = clipped ? Math.max(0, box.y) : box.y;
          const right = clipped ? Math.min(dimensions.width, box.x + box.width) : box.x + box.width;
          const bottom = clipped ? Math.min(dimensions.height, box.y + box.height) : box.y + box.height;
          if (right <= left || bottom <= top) return null;
          const project = (localX, localY) => {
            const point = new THREE.Vector3(
              (controlsSide === "back" ? -1 : 1) * (localX - dimensions.width / 2),
              dimensions.height / 2 - localY,
              (controlsSide === "back" ? -1 : 1) * (mounted.thickness / 2 + 0.1),
            );
            const world = mounted.faceGroup.localToWorld(point);
            return sceneToClient({ x: world.x + center.x, y: center.y - world.y, z: world.z });
          };
          const anchor = project((left + right) / 2, (top + bottom) / 2);
          const hit = hitTest(clientToScene(anchor));
          if ((clipped && !hit) || (hit && hit.cardId !== card.id)) return null;
          const points = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => project(x, y));
          const bounds = canvasBounds();
          return {
            x: Math.min(...points.map((point) => point.x)) - bounds.left,
            y: Math.min(...points.map((point) => point.y)) - bounds.top,
          };
        },
      });
      mounted.controlsMounted = attachmentList.length > 0;
    }
    if (interactionSessions.length > 0 && !interactionPriorityCardIds.has(card.id)) applyInteractionPriority();
    if (shouldRender) render();
  }

  function hitTest(point) {
    renderScene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const worldPoint = new THREE.Vector3(point.x - center.x, center.y - point.y, 0);
    const projectedPoint = worldPoint.project(camera);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: projectedPoint.x, y: projectedPoint.y }, camera);
    const intersections = raycaster.intersectObjects(
      [...cards.values()]
        .filter(({ cardGroup, lastPose }) => cardGroup.visible && lastPose?.visible !== false)
        .map(({ cardGroup }) => cardGroup),
      true,
    );
    const hit = selectCardIntersection(intersections, cards);
    if (!hit) return null;
    const mounted = cards.get(hit.cardId);
    if (!mounted) return null;
    return { cardId: hit.cardId, side: cardSideForIntersection(hit.object, mounted), distance: hit.distance };
  }

  function canvasBounds() {
    const rect = canvas.getBoundingClientRect?.() ?? {};
    return {
      left: Number.isFinite(rect.left) ? rect.left : 0,
      top: Number.isFinite(rect.top) ? rect.top : 0,
      width: Number.isFinite(rect.width) && rect.width > 0 ? rect.width : stageSize.width,
      height: Number.isFinite(rect.height) && rect.height > 0 ? rect.height : stageSize.height,
    };
  }

  function clientToScene(point, depth = 0) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(depth)) {
      throw new TypeError("clientToScene requires finite x, y, and depth coordinates");
    }
    const bounds = canvasBounds();
    camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({
      x: (point.x - bounds.left) / bounds.width * 2 - 1,
      y: 1 - (point.y - bounds.top) / bounds.height * 2,
    }, camera);
    const worldPoint = raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -depth),
      new THREE.Vector3(),
    );
    if (!worldPoint) return null;
    return { x: worldPoint.x + center.x, y: center.y - worldPoint.y };
  }

  function sceneToClient(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || (point.z !== undefined && !Number.isFinite(point.z))) {
      throw new TypeError("sceneToClient requires finite x, y, and z coordinates");
    }
    const bounds = canvasBounds();
    camera.updateMatrixWorld(true);
    const projected = new THREE.Vector3(
      point.x - center.x,
      center.y - point.y,
      point.z ?? 0,
    ).project(camera);
    return {
      x: bounds.left + (projected.x + 1) / 2 * bounds.width,
      y: bounds.top + (1 - projected.y) / 2 * bounds.height,
    };
  }

  function captureGrab(cardId, clientPoint) {
    if (disposed || typeof cardId !== "string") return null;
    const mounted = cards.get(cardId);
    if (!mounted || !mounted.lastPose || mounted.cardGroup.visible === false) return null;
    return captureGrabToken({
      camera,
      bounds: canvasBounds(),
      cardId,
      cardGroup: mounted.cardGroup,
      faceGroup: mounted.faceGroup,
      pose: mounted.lastPose,
      clientPoint,
      sideForObject: (object) => cardSideForIntersection(object, mounted),
    });
  }

  function resolveGrabPose(pose, grabToken, clientPoint) {
    if (disposed || !grabToken?.cardId || !cards.has(grabToken.cardId)) return null;
    const correction = resolveGrabCorrection({
      camera,
      bounds: canvasBounds(),
      center,
      pose,
      grabToken,
      clientPoint,
    });
    if (!correction || !pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return null;
    return { x: pose.x + correction.x, y: pose.y + correction.y };
  }

  function disposeInteractionPreview() {
    for (const child of [...interactionPreview.children]) {
      interactionPreview.remove(child);
      child.traverse((object) => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
    }
  }

  function previewLine(points, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const line = new THREE.LineLoop(geometry, material);
    line.renderOrder = INTERACTION_PREVIEW_RENDER_ORDER;
    line.userData.interactionPreview = true;
    interactionPreview.add(line);
    return line;
  }

  function candidateGeometry(candidate) {
    return candidate?.geometry
      ?? candidate?.resolvedZone?.geometry
      ?? candidate?.zone?.geometry
      ?? candidate?.toZone?.geometry
      ?? null;
  }

  function targetPoseFor(session, cardId) {
    const targetPose = session?.targetPoses ?? session?.targetPose;
    if (!targetPose) return null;
    if (targetPose instanceof Map) return targetPose.get(cardId) ?? null;
    if (Array.isArray(targetPose)) {
      return targetPose.find((entry) => entry?.cardId === cardId)?.pose ?? null;
    }
    if (targetPose[cardId] && Number.isFinite(targetPose[cardId].x) && Number.isFinite(targetPose[cardId].y)) {
      return targetPose[cardId];
    }
    return Number.isFinite(targetPose.x) && Number.isFinite(targetPose.y) ? targetPose : null;
  }

  function previewTargetSignature(targetPose) {
    if (targetPose instanceof Map) return [...targetPose.entries()];
    return targetPose;
  }

  function interactionPreviewSignature(sessions) {
    return JSON.stringify(sessions.map((session) => ({
      id: session?.id,
      phase: session?.phase,
      cardIds: session?.cardIds,
      primaryCardId: session?.primaryCardId,
      candidate: session?.candidate && {
        toZoneId: session.candidate.toZoneId,
        index: session.candidate.index,
        geometry: session.candidate.geometry,
        allowed: session.candidate.allowed,
        reason: session.candidate.reason,
      },
      targetPose: previewTargetSignature(session?.targetPoses ?? session?.targetPose),
    })));
  }

  function previewTarget(session, cardId, targetPose) {
    const mounted = cards.get(cardId);
    if (!mounted || !targetPose || targetPose.visible === false) return;
    const card = mounted.lastCard;
    const dimensions = {
      width: targetPose.width ?? mounted.width,
      height: targetPose.height ?? mounted.height,
    };
    const shape = createCardShape(card?.shape ?? templates[card?.template]?.shape, dimensions);
    const targetGroup = new THREE.Group();
    targetGroup.position.set(targetPose.x - center.x, center.y - targetPose.y, targetPose.z ?? 0);
    targetGroup.scale.setScalar((targetPose.scale ?? 1) * (targetPose.layoutScale ?? 1) * (targetPose.depthScale ?? 1));
    const bodyGroup = new THREE.Group();
    bodyGroup.rotation.order = "ZXY";
    bodyGroup.rotation.set(radians(targetPose.tiltX ?? 0), radians(targetPose.tiltY ?? 0), radians(targetPose.angle ?? 0));
    const faceGroup = new THREE.Group();
    faceGroup.rotation.order = "YXZ";
    faceGroup.rotation.set(radians(targetPose.flipX ?? 0), radians(targetPose.flipY ?? 0), 0);
    const thickness = targetPose.thickness ?? mounted.thickness;
    const points = shape.getPoints(32).map(({ x, y }) => new THREE.Vector3(x, y, thickness / 2 + 0.2));
    targetGroup.add(bodyGroup);
    bodyGroup.add(faceGroup);
    faceGroup.add(previewLine(points, session.candidate.allowed ? INTERACTION_ALLOWED_COLOR : INTERACTION_DENIED_COLOR));
    interactionPreview.add(targetGroup);
  }

  function applyInteractionPriority() {
    const activeSessions = interactionSessions.filter((session) => INTERACTION_PHASES.has(session?.phase));
    const sessionKey = JSON.stringify(activeSessions.map((session) => [session?.id, session?.cardIds]));
    if (sessionKey === interactionPrioritySessionKey
      && drawOrderRevision === interactionPriorityDrawRevision
      && cardsRevision === interactionPriorityCardsRevision) return;

    for (const cardId of interactionPriorityAssignments.keys()) {
      const mounted = cards.get(cardId);
      if (mounted) mounted.cardGroup.renderOrder = mounted.drawOrder ?? 0;
    }
    const highestDrawOrder = activeSessions.length === 0
      ? -1
      : Math.max(-1, ...[...cards.values()].map((mounted) => mounted.drawOrder ?? 0));
    let priority = highestDrawOrder + 1;
    const assignments = new Map();
    for (const session of activeSessions) {
      for (const cardId of session.cardIds ?? []) {
        const mounted = cards.get(cardId);
        if (!mounted) continue;
        mounted.cardGroup.renderOrder = priority;
        assignments.set(cardId, priority);
        priority += 1;
      }
    }
    interactionPriorityAssignments = assignments;
    interactionPriorityCardIds = new Set(assignments.keys());
    interactionPrioritySessionKey = sessionKey;
    interactionPriorityDrawRevision = drawOrderRevision;
    interactionPriorityCardsRevision = cardsRevision;
  }

  function updateInteraction({ sessions = [] } = {}) {
    const nextSessions = Array.isArray(sessions) ? sessions : [];
    const nextPreviewKey = interactionPreviewSignature(nextSessions);
    interactionSessions = nextSessions;
    applyInteractionPriority();
    if (nextPreviewKey === interactionPreviewKey) return;
    interactionPreviewKey = nextPreviewKey;
    disposeInteractionPreview();
    for (const session of nextSessions) {
      if (!INTERACTION_PHASES.has(session?.phase)) continue;
      const candidate = session.candidate;
      const geometry = candidateGeometry(candidate);
      if (geometry && [geometry.x, geometry.y, geometry.width, geometry.height].every(Number.isFinite)
        && geometry.width > 0 && geometry.height > 0) {
        const depth = geometry.depth ?? 0;
        previewLine([
          new THREE.Vector3(geometry.x - center.x, center.y - geometry.y, depth + 0.2),
          new THREE.Vector3(geometry.x + geometry.width - center.x, center.y - geometry.y, depth + 0.2),
          new THREE.Vector3(geometry.x + geometry.width - center.x, center.y - geometry.y - geometry.height, depth + 0.2),
          new THREE.Vector3(geometry.x - center.x, center.y - geometry.y - geometry.height, depth + 0.2),
        ], candidate.allowed ? INTERACTION_ALLOWED_COLOR : INTERACTION_DENIED_COLOR);
      }
      if (candidate?.allowed !== true) continue;
      for (const cardId of session.cardIds ?? []) previewTarget(session, cardId, targetPoseFor(session, cardId));
    }
  }

  function updateSelection({ cardIds = [], primaryCardId: primary = null } = {}) {
    selectedCardIds = new Set(cardIds);
    primaryCardId = primary;
    let changed = false;
    for (const [id, mounted] of cards) {
      const selected = selectedCardIds.has(id);
      const isPrimary = selected && id === primaryCardId;
      if (mounted.accessibilityShell.dataset.selected === String(selected)
        && mounted.accessibilityShell.dataset.primary === String(isPrimary)) continue;
      changed = true;
      mounted.accessibilityShell.setAttribute("aria-pressed", String(selected));
      mounted.accessibilityShell.dataset.selected = String(selected);
      mounted.accessibilityShell.dataset.primary = String(isPrimary);
      mounted.bodyMaterial.color.setHex(0x17212b);
      const materialKey = isPrimary ? "primary" : "secondary";
      mounted.selectionFront.material = selectionFrameMaterials[materialKey];
      mounted.selectionBack.material = selectionFrameMaterials[materialKey];
      mounted.selectionFrontHalo.material = selectionHaloMaterials[materialKey];
      mounted.selectionBackHalo.material = selectionHaloMaterials[materialKey];
      mounted.selectionFront.visible = selected && selectionHighlightVisible;
      mounted.selectionBack.visible = selected && selectionHighlightVisible;
      mounted.selectionFrontHalo.visible = selected && selectionHighlightVisible;
      mounted.selectionBackHalo.visible = selected && selectionHighlightVisible;
    }
    if (changed) render();
  }

  function setSelectionHighlightVisible(visible) {
    if (typeof visible !== "boolean") throw new TypeError("Selection highlight visibility must be boolean");
    if (selectionHighlightVisible === visible) return;
    selectionHighlightVisible = visible;
    for (const mounted of cards.values()) {
      const selected = mounted.accessibilityShell.dataset.selected === "true";
      mounted.bodyMaterial.color.setHex(0x17212b);
      mounted.selectionFront.visible = selected && visible;
      mounted.selectionBack.visible = selected && visible;
      mounted.selectionFrontHalo.visible = selected && visible;
      mounted.selectionBackHalo.visible = selected && visible;
    }
    render();
  }

  function remove(cardId) {
    const mounted = cards.get(cardId);
    if (!mounted) return;
    renderScene.remove(mounted.cardGroup);
    mounted.accessibilityShell.remove();
    mounted.geometryLease.release();
    mounted.bodyMaterial.dispose();
    mounted.sideMaterial.dispose();
    mounted.frontBaseMaterial.dispose();
    mounted.backBaseMaterial.dispose();
    mounted.frontMaterial.map = null;
    mounted.backMaterial.map = null;
    mounted.frontLease?.release();
    mounted.backLease?.release();
    mounted.frontMaterial.dispose();
    mounted.backMaterial.dispose();
    for (const { material, texture, geometry, ownsGeometry } of mounted.attachmentPlanes.values()) {
      texture?.dispose?.();
      material.map = null;
      material.dispose();
      if (ownsGeometry) geometry.dispose();
    }
    mounted.attachmentPlanes.clear();
    const escapedCardId = globalThis.CSS?.escape?.(String(cardId)) ?? String(cardId).replaceAll('"', '\\"');
    attachmentControlsLayer.querySelector?.(`.cardinal-webgl-attachment-controls[data-card-id="${escapedCardId}"]`)?.remove();
    cards.delete(cardId);
    cardsRevision += 1;
    render();
  }

  resize();
  return {
    type: "webgl",
    projection,
    measureZone(zone) {
      const anchor = document.querySelector(zone.anchor);
      if (!anchor || !anchor.isConnected || anchor.getClientRects().length === 0) return { visible: false };
      const style = getComputedStyle(anchor);
      if (style.visibility === "hidden" || style.visibility === "collapse") return { visible: false };
      const bounds = anchor.getBoundingClientRect();
      const stageBounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || stageBounds.width <= 0 || stageBounds.height <= 0) return { visible: false };
      const depth = zone.depth ?? 0;
      camera.updateMatrixWorld(true);
      const unproject = (x, y) => {
        const ray = new THREE.Raycaster();
        ray.setFromCamera({ x: (x - stageBounds.left) / stageBounds.width * 2 - 1, y: 1 - (y - stageBounds.top) / stageBounds.height * 2 }, camera);
        const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -depth), new THREE.Vector3());
        if (!point) throw new RangeError(`Zone ${zone.id} is outside the camera`);
        return { x: point.x + center.x, y: center.y - point.y };
      };
      const topLeft = unproject(bounds.left, bounds.top);
      const bottomRight = unproject(bounds.right, bounds.bottom);
      return { visible: true, geometry: { ...topLeft, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y, depth } };
    },
    mount(card) {
      return mount(card, cardDimensions(card, templates, elementRenderers), cardThickness(card, templates));
    },
    update,
    hitTest,
    clientToScene,
    sceneToClient,
    captureGrab,
    resolveGrabPose,
    updateInteraction,
    updateSelection,
    setSelectionHighlightVisible,
    render,
    diagnostics() {
      const sources = new Set();
      const textures = new Set();
      for (const mounted of cards.values()) {
        if (mounted.frontTexture) textures.add(mounted.frontTexture);
        if (mounted.backTexture) textures.add(mounted.backTexture);
        for (const source of imageSourcesForContent(mounted.frontContent)) sources.add(source);
        for (const source of imageSourcesForContent(mounted.backContent)) sources.add(source);
      }
      let loaded = 0;
      let pending = 0;
      let failed = 0;
      for (const source of sources) {
        const entry = imageCache.get(source);
        if (entry?.loaded) loaded += 1;
        else if (entry?.failed) failed += 1;
        else pending += 1;
      }
      return {
        textures: {
          active: textures.size,
          pending: [...textures].filter((texture) => !readyTextures.has(texture)).length,
          estimatedBytes: [...textures].reduce((bytes, texture) => bytes + texture.image.width * texture.image.height * 4, 0),
        },
        work: { ...work },
        lastRender: { calls: webgl.info.render.calls, triangles: webgl.info.render.triangles },
        resources: { ...webgl.info.memory },
        pixelRatio: webgl.getPixelRatio(),
        mountedCards: cards.size,
        mountedSurfaces: [...cards.values()].reduce((count, mounted) => count
          + Number(Boolean(mounted.frontTexture)) + Number(Boolean(mounted.backTexture)), 0),
        imageSources: { total: sources.size, loaded, pending, failed },
      };
    },
    remove,
    destroy() {
      if (disposed) return;
      disposed = true;
      if (imageRenderFrame !== null) cancelAnimationFrame(imageRenderFrame);
      imageRenderFrame = null;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      interactionSessions = [];
      interactionPreviewKey = null;
      disposeInteractionPreview();
      for (const cardId of cards.keys()) remove(cardId);
      geometryCache.destroy();
      for (const material of Object.values(selectionFrameMaterials)) material.dispose();
      for (const material of Object.values(selectionHaloMaterials)) material.dispose();
      texturePool.destroy();
      for (const entry of imageCache.values()) {
        entry.image.onload = null;
        entry.image.onerror = null;
        entry.cancel();
      }
      imageCache.clear();
      webgl.dispose();
      canvas.remove();
      accessibilityLayer.remove();
      attachmentControlsLayer.remove();
      element.classList.remove("cardinal-stage--webgl");
    },
    get reason() {
      return rendererReason;
    },
    get viewport() {
      return { ...viewport, center: { ...center }, scaleMode, unitsPerPixel };
    },
  };
}
