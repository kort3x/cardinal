import * as THREE from "three";
import { createHeadlessRenderer } from "../renderer.js";
import { cardDimensions } from "../layout.js";

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

function createCardFaceSurfaceMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
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
    dimensions.width,
    dimensions.height,
  ]);
}

function logicalFaceContent(card, side) {
  const activeFace = card.faces[card.activeFaceId] ?? {};
  if (side === "back") return card.back ?? { title: "Concealed", flavour: "" };
  if (!card.faceCycle || !card.faceCycleNextFaceId) return activeFace;

  const destinationFace = card.faces[card.faceCycleNextFaceId ?? card.activeFaceId] ?? activeFace;
  return destinationFace;
}

export function createCardGeometry(shape, { depth = 6, bevelSize = CARD_BEVEL_SIZE } = {}) {
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

export function createWebGLRenderer({ element, templates = {} } = {}) {
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
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
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
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  resizeObserver?.observe(element);
  let stageSize = elementSize(element);

  function resize() {
    stageSize = elementSize(element);
    const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    webgl.setPixelRatio(pixelRatio);
    webgl.setSize(stageSize.width, stageSize.height, false);
    camera.aspect = stageSize.width / stageSize.height;
    camera.position.set(0, 0, 1000);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    render();
  }

  function render() {
    webgl.render(renderScene, camera);
  }

  function makeTexture(content, dimensions) {
    const resolution = Math.min(4, Math.max(2, (globalThis.devicePixelRatio || 1) * 2));
    const canvas2d = document.createElement("canvas");
    canvas2d.width = Math.round(dimensions.width * resolution);
    canvas2d.height = Math.round(dimensions.height * resolution);
    const context = canvas2d.getContext("2d");
    if (!context) return null;
    context.scale(resolution, resolution);
    context.fillStyle = content?.background ?? "#ffffff";
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.fillStyle = content?.textColor ?? "#17212b";
    context.font = "700 18.4px system-ui, sans-serif";
    context.textBaseline = "top";
    drawLines(context, wrapText(context, content?.title, dimensions.width - 36), 18, 18, 21);
    if (content?.image) {
      const image = new Image();
      image.alt = content.imageAlt ?? "";
      image.onload = () => {
        context.drawImage(image, 18, 66, dimensions.width - 36, 120);
        texture.needsUpdate = true;
        render();
      };
      image.src = content.image;
    }
    context.fillStyle = content?.mutedTextColor ?? "#78838c";
    context.font = "14.4px system-ui, sans-serif";
    drawLines(context, wrapText(context, content?.flavour, dimensions.width - 36), 18, dimensions.height - 70, 20);
    const texture = new THREE.CanvasTexture(canvas2d);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = webgl.capabilities.getMaxAnisotropy();
    return texture;
  }

  function mount(card, dimensions) {
    if (cards.has(card.id)) return cards.get(card.id);
    const width = dimensions.width;
    const height = dimensions.height;
    const depth = 6;
    const shape = createCardShape(card.shape ?? templates[card.template]?.shape, { width, height });
    const geometry = createCardGeometry(shape, { depth });
    const faceShape = createCardShape(card.shape ?? templates[card.template]?.shape, {
      width: Math.max(1, width - CARD_BEVEL_SIZE * 2),
      height: Math.max(1, height - CARD_BEVEL_SIZE * 2),
    });
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
    const sideMaterial = new THREE.MeshStandardMaterial({ color: 0x727d86, roughness: 0.75, metalness: 0 });
    const body = new THREE.Mesh(geometry, [bodyMaterial, sideMaterial]);
    const frontBaseGeometry = new THREE.ShapeGeometry(faceShape);
    const backBaseGeometry = new THREE.ShapeGeometry(faceShape);
    const frontBaseMaterial = createCardFaceBaseMaterial(0xffffff);
    const backBaseMaterial = createCardFaceBaseMaterial(0x17212b);
    const frontBase = new THREE.Mesh(frontBaseGeometry, frontBaseMaterial);
    const backBase = new THREE.Mesh(backBaseGeometry, backBaseMaterial);
    const frontMaterial = createCardFaceMaterial();
    const backMaterial = createCardFaceMaterial();
    const front = new THREE.Mesh(new THREE.ShapeGeometry(faceShape), frontMaterial);
    const back = new THREE.Mesh(new THREE.ShapeGeometry(faceShape), backMaterial);
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
    const accessibleText = [
      accessible.side === "back" ? "Concealed card" : accessible.content.title,
      accessible.content.imageAlt,
      accessible.content.flavour,
    ].filter(Boolean).join(". ");
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
