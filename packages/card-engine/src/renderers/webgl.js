import * as THREE from "three";
import { createHeadlessRenderer } from "../renderer.js";
import { CARD_DEPTH, cardDimensions } from "../layout.js";

const radians = (degrees) => degrees * Math.PI / 180;
const CARD_BEVEL_SIZE = 1.2;
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

export function createCardCamera({ projection = "orthographic", width = 900, height = 500, distance = 1000, fov = 35, zoom = 1 } = {}) {
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
    width: Math.max(1, element.clientWidth || rect?.width || 900),
    height: Math.max(1, element.clientHeight || rect?.height || 500),
  };
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

function contentKey(content, dimensions) {
  return JSON.stringify([
    content?.title,
    content?.image,
    content?.imageAlt,
    content?.flavour,
    content?.background,
    content?.textColor,
    content?.mutedTextColor,
    content?.elements,
    dimensions.width,
    dimensions.height,
  ]);
}

function legacyContentElements(content) {
  const visibility = content?.elements && !Array.isArray(content.elements) ? content.elements : {};
  const elements = [];
  if (content?.title !== undefined) elements.push({ id: "title", type: "text", content: { text: content.title }, visible: visibility.title !== false, layout: { mode: "flow", order: 0 }, style: { variant: "title" } });
  if (content?.image !== undefined) elements.push({ id: "image", type: "image", content: { src: content.image, alt: content.imageAlt }, visible: visibility.image !== false, layout: { mode: "flow", order: 1 } });
  if (content?.flavour !== undefined) elements.push({ id: "flavour", type: "text", content: { text: content.flavour }, visible: visibility.flavour !== false, layout: { mode: "flow", order: 2 }, style: { variant: "flavour" } });
  return elements;
}

function contentElements(content) {
  return Array.isArray(content?.elements) ? content.elements : legacyContentElements(content);
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

function drawImageElement(context, element, dimensions, x, y, width, height, images, fallbackImage) {
  if (!elementVisible(element)) return height;
  const image = imageFrom(images, element, fallbackImage);
  if (!image) return height;
  context.drawImage(image, x, y, width, height);
  return height;
}

export function drawCardTextureContent(context, content, dimensions, images = null) {
  context.fillStyle = content?.background ?? "#ffffff";
  context.fillRect(0, 0, dimensions.width, dimensions.height);
  const inner = 18;
  const innerWidth = Math.max(1, dimensions.width - inner * 2);
  const textColor = content?.textColor ?? "#17212b";
  const entries = sortedElements(content, true);
  const flow = entries.filter(({ element }) => (element.layout?.mode ?? "flow") === "flow");
  const overlays = entries
    .filter(({ element }) => element.layout?.mode === "overlay")
    .filter(({ element }) => elementVisible(element))
    .sort((first, second) => (first.element.layout?.zIndex ?? 0) - (second.element.layout?.zIndex ?? 0)
      || String(first.element.id).localeCompare(String(second.element.id)));
  let cursor = inner;

  for (const { element } of flow) {
    const type = element.type;
    if (type === "text") {
      const color = element.style?.variant === "flavour" || element.id === "flavour"
        ? content?.mutedTextColor ?? "#78838c"
        : textColor;
      cursor += drawTextElement(context, element, dimensions, inner, cursor, innerWidth, color, element.id === "title" ? "title" : "body") + 10;
    } else if (type === "image") {
      const imageHeight = element.layout?.height ? dimensions.height * element.layout.height : 120;
      const imageWidth = element.layout?.width ? dimensions.width * element.layout.width : innerWidth;
      cursor += drawImageElement(context, element, dimensions, inner, cursor, imageWidth, imageHeight, images, images && !(images instanceof Map) ? images : null) + 10;
    } else {
      cursor += drawTextElement(context, { ...element, content: { text: `Unsupported element: ${element.type}` } }, dimensions, inner, cursor, innerWidth, "#a85f3f") + 10;
    }
  }

  for (const { element } of overlays) {
    const layout = element.layout ?? {};
    const x = (layout.x ?? 0) * dimensions.width;
    const y = (layout.y ?? 0) * dimensions.height;
    const width = (layout.width ?? 0.5) * dimensions.width;
    const height = (layout.height ?? 0.2) * dimensions.height;
    if (element.type === "text") {
      drawTextElement(context, element, dimensions, x, y, width, textColor);
    } else if (element.type === "image") {
      drawImageElement(context, element, dimensions, x, y, width, height, images, images && !(images instanceof Map) ? images : null);
    } else {
      drawTextElement(context, { ...element, content: { text: `Unsupported element: ${element.type}` } }, dimensions, x, y, width, "#a85f3f");
    }
  }
}

function accessibleElementText(content) {
  return sortedElements(content).map(({ element }) => {
    if (element.type === "text") return elementText(element);
    if (element.type === "image") return elementImageAlt(element);
    return element.content?.label ?? `${element.type} element`;
  }).filter(Boolean).join(". ");
}

function logicalFaceContent(card, side) {
  const activeFace = card.faces[card.activeFaceId] ?? {};
  if (side === "back") return card.back ?? { title: "Concealed", flavour: "" };
  if (!card.faceCycle || !card.faceCycleNextFaceId) return activeFace;

  const destinationFace = card.faces[card.faceCycleNextFaceId ?? card.activeFaceId] ?? activeFace;
  return destinationFace;
}

export function createCardGeometry(shape, { depth = CARD_DEPTH, bevelSize = CARD_BEVEL_SIZE } = {}) {
  const extrusionDepth = Math.max(0.1, depth - bevelSize * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: extrusionDepth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 4,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -extrusionDepth / 2);
  return geometry;
}

export function createCardFaceGeometry(shape, dimensions) {
  const geometry = new THREE.ShapeGeometry(shape);
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

function physicalSide(pose) {
  const facing = Math.cos(radians(pose.flipX ?? 0)) * Math.cos(radians(pose.flipY ?? pose.flipAngle ?? 0));
  if (Math.abs(facing) < 0.000001) return "edge";
  return facing > 0 ? "front" : "back";
}

function accessibleContent(card, pose) {
  const side = physicalSide(pose);
  if (side === "edge") return { side, content: { title: "Card edge" } };
  if (side === "back") return { side, content: card.back ?? { title: "Concealed card" } };
  return { side, content: card.faces[card.faceCycleNextFaceId ?? card.activeFaceId] ?? {} };
}

export function createWebGLRenderer({ element, templates = {}, camera: cameraOptions = {} } = {}) {
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
  let camera = createCardCamera({ ...cameraOptions, projection, width: 900, height: 500 });
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

  const cards = new Map();
  const imageCache = new Map();
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  resizeObserver?.observe(element);
  let stageSize = elementSize(element);

  function resize() {
    stageSize = elementSize(element);
    const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    webgl.setPixelRatio(pixelRatio);
    webgl.setSize(stageSize.width, stageSize.height, false);
    camera = createCardCamera({
      ...cameraOptions,
      projection,
      width: stageSize.width,
      height: stageSize.height,
    });
    render();
  }

  function render() {
    webgl.render(renderScene, camera);
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
    const entry = { image, loaded: false, promise };
    image.onload = () => {
      entry.loaded = true;
      resolveImage(image);
    };
    image.onerror = () => rejectImage(new Error(`Card image failed to load: ${source}`));
    imageCache.set(source, entry);
    image.src = source;
    if (image.complete && image.naturalWidth > 0) {
      entry.loaded = true;
      resolveImage(image);
    }
    return entry;
  }

  function makeTexture(content, dimensions) {
    const resolution = Math.min(4, Math.max(2, (globalThis.devicePixelRatio || 1) * 2));
    const canvas2d = document.createElement("canvas");
    canvas2d.width = Math.round(dimensions.width * resolution);
    canvas2d.height = Math.round(dimensions.height * resolution);
    const context = canvas2d.getContext("2d");
    if (!context) return null;
    context.scale(resolution, resolution);
    const texture = new THREE.CanvasTexture(canvas2d);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = webgl.capabilities.getMaxAnisotropy();
    const imageEntries = contentElements(content)
      .filter((element) => elementVisible(element) && element.type === "image")
      .map((element) => elementImageSource(element))
      .filter(Boolean)
      .filter((source, index, sources) => sources.indexOf(source) === index)
      .map((source) => [source, cachedImage(source)]);
    const images = new Map(imageEntries.filter(([, entry]) => entry.loaded).map(([source, entry]) => [source, entry.image]));
    const redraw = (source, image) => {
      images.set(source, image);
      drawCardTextureContent(context, content, dimensions, images);
      texture.needsUpdate = true;
      render();
    };
    drawCardTextureContent(context, content, dimensions, images);
    for (const [source, entry] of imageEntries) {
      if (!entry.loaded) entry.promise.then((image) => redraw(source, image), () => {});
    }
    return texture;
  }

  function mount(card, dimensions) {
    if (cards.has(card.id)) return cards.get(card.id);
    const width = dimensions.width;
    const height = dimensions.height;
    const depth = CARD_DEPTH;
    const shape = createCardShape(card.shape ?? templates[card.template]?.shape, { width, height });
    const geometry = createCardGeometry(shape, { depth });
    const faceShape = createCardShape(card.shape ?? templates[card.template]?.shape, {
      width: Math.max(1, width - CARD_BEVEL_SIZE * 2),
      height: Math.max(1, height - CARD_BEVEL_SIZE * 2),
    });
    const faceDimensions = {
      width: Math.max(1, width - CARD_BEVEL_SIZE * 2),
      height: Math.max(1, height - CARD_BEVEL_SIZE * 2),
    };
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
    const sideMaterial = new THREE.MeshStandardMaterial({ color: 0x727d86, roughness: 0.75, metalness: 0 });
    const body = new THREE.Mesh(geometry, [bodyMaterial, sideMaterial]);
    body.onBeforeRender = clearCardDepth;
    const frontBaseGeometry = createCardFaceGeometry(faceShape, faceDimensions);
    const backBaseGeometry = createCardFaceGeometry(faceShape, faceDimensions);
    const frontBaseMaterial = createCardFaceBaseMaterial(0xffffff);
    const backBaseMaterial = createCardFaceBaseMaterial(0x17212b);
    const frontBase = new THREE.Mesh(frontBaseGeometry, frontBaseMaterial);
    const backBase = new THREE.Mesh(backBaseGeometry, backBaseMaterial);
    const frontMaterial = createCardFaceMaterial();
    const backMaterial = createCardFaceMaterial();
    const front = new THREE.Mesh(createCardFaceGeometry(faceShape, faceDimensions), frontMaterial);
    const back = new THREE.Mesh(createCardFaceGeometry(faceShape, faceDimensions), backMaterial);
    frontBase.renderOrder = 1;
    backBase.renderOrder = 1;
    front.renderOrder = 2;
    back.renderOrder = 2;
    frontBase.position.z = depth / 2 + 0.04;
    backBase.position.z = -depth / 2 - 0.04;
    front.position.z = depth / 2 + 0.06;
    back.position.z = -depth / 2 - 0.06;
    backBase.rotation.y = Math.PI;
    back.rotation.y = Math.PI;
    const faceGroup = new THREE.Group();
    faceGroup.add(body, frontBase, backBase, front, back);
    const cardGroup = new THREE.Group();
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
    const mounted = { cardGroup, pivotGroup, bodyGroup, faceGroup, front, back, frontMaterial, backMaterial, frontBaseGeometry, backBaseGeometry, frontBaseMaterial, backBaseMaterial, geometry, bodyMaterial, sideMaterial, accessibilityShell, frontTexture: null, backTexture: null, frontKey: null, backKey: null, width, height };
    cards.set(card.id, mounted);
    return mounted;
  }

  function updateTexture(mounted, side, content, dimensions) {
    const key = contentKey(content, dimensions);
    const keyName = `${side}Key`;
    if (mounted[keyName] === key) return;
    const texture = makeTexture(content, dimensions);
    if (!texture) return;
    const textureName = `${side}Texture`;
    mounted[textureName]?.dispose();
    mounted[textureName] = texture;
    mounted[`${side}Material`].map = texture;
    mounted[`${side}Material`].needsUpdate = true;
    mounted[keyName] = key;
  }

  function update(card, pose) {
    const dimensions = { width: card.dimensions?.width ?? templates[card.template]?.width ?? 180, height: card.dimensions?.height ?? templates[card.template]?.height ?? 250 };
    const mounted = mount(card, dimensions);
    const renderedScale = pose.scale * (pose.depthScale ?? 1);
    const x = pose.x - stageSize.width / 2;
    const y = stageSize.height / 2 - pose.y;
    mounted.cardGroup.position.set(x, y, pose.z);
    mounted.cardGroup.renderOrder = pose.drawOrder ?? 0;
    mounted.cardGroup.scale.setScalar(renderedScale);
    mounted.bodyGroup.rotation.order = "ZXY";
    mounted.bodyGroup.rotation.set(radians(pose.tiltX), radians(pose.tiltY), radians(pose.angle));
    mounted.faceGroup.rotation.order = "YXZ";
    mounted.faceGroup.rotation.set(radians(pose.flipX ?? 0), radians(pose.flipY ?? pose.flipAngle ?? 0), 0);
    const accessible = accessibleContent(card, pose);
    const accessibleText = accessible.side === "back" ? "Concealed card" : accessibleElementText(accessible.content);
    mounted.accessibilityShell.textContent = accessibleText || "Card";
    mounted.accessibilityShell.setAttribute("aria-label", mounted.accessibilityShell.textContent);
    updateTexture(mounted, "front", logicalFaceContent(card, "front"), dimensions);
    updateTexture(mounted, "back", logicalFaceContent(card, "back"), dimensions);
    render();
  }

  function remove(cardId) {
    const mounted = cards.get(cardId);
    if (!mounted) return;
    renderScene.remove(mounted.cardGroup);
    mounted.accessibilityShell.remove();
    mounted.geometry.dispose();
    mounted.frontBaseGeometry.dispose();
    mounted.backBaseGeometry.dispose();
    mounted.bodyMaterial.dispose();
    mounted.sideMaterial.dispose();
    mounted.frontBaseMaterial.dispose();
    mounted.backBaseMaterial.dispose();
    mounted.frontMaterial.map?.dispose();
    mounted.backMaterial.map?.dispose();
    mounted.frontMaterial.dispose();
    mounted.backMaterial.dispose();
    cards.delete(cardId);
    render();
  }

  resize();
  return {
    type: "webgl",
    projection,
    mount(card) {
      return mount(card, cardDimensions(card, templates));
    },
    update,
    remove,
    destroy() {
      resizeObserver?.disconnect();
      for (const cardId of cards.keys()) remove(cardId);
      webgl.dispose();
      canvas.remove();
      accessibilityLayer.remove();
      element.classList.remove("cardinal-stage--webgl");
    },
  };
}
