const $ = (selector) => document.querySelector(selector);

const elements = {
  dropZone: $("#drop-zone"),
  fileInput: $("#file-input"),
  clearButton: $("#clear-button"),
  expandTree: $("#expand-tree"),
  collapseTree: $("#collapse-tree"),
  fileInfo: $("#file-info"),
  treeView: $("#tree-view"),
  treeCount: $("#tree-count"),
  preview: $("#preview"),
  previewLabel: $("#preview-label"),
  animationControls: $("#animation-controls"),
  animationStatus: $("#animation-status"),
  animationSelect: $("#animation-select"),
  animationToggle: $("#animation-toggle"),
  nodeDetails: $("#node-details"),
  issueList: $("#issue-list"),
  issueCount: $("#issue-count"),
};

const supportedExtensions = new Set(["psd", "fbx", "glb", "gltf", "obj"]);
const defaultNamePattern = /^(layer\s*\d+|group\s*\d+|cube|sphere|cylinder|object\d*|mesh\d*|untitled)$/i;

let activeRenderer = null;
let activeObjectUrl = null;
let currentTree = [];
let selectedNodeId = null;
let collapsedNodeIds = new Set();
let threeRuntime = null;
let animationState = {
  mixer: null,
  actions: [],
  activeAction: null,
  isPlaying: false,
};

window.addEventListener("error", (event) => showError(`页面脚本错误：${event.message}`));
window.addEventListener("unhandledrejection", (event) => {
  showError(`解析过程出错：${event.reason?.message || event.reason || "未知错误"}`);
});

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files);
});

elements.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropZone.classList.add("drag-over");
});

elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("drag-over"));
elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  elements.dropZone.classList.remove("drag-over");
  handleFiles(event.dataTransfer.files);
});

elements.fileInput.addEventListener("change", (event) => handleFiles(event.target.files));
elements.clearButton.addEventListener("click", resetView);
elements.expandTree.addEventListener("click", () => {
  collapsedNodeIds.clear();
  renderTree(currentTree);
});
elements.collapseTree.addEventListener("click", () => {
  collapsedNodeIds = new Set(flattenTree(currentTree).filter((node) => node.children?.length).map((node) => node.id));
  renderTree(currentTree);
});
elements.animationToggle.addEventListener("click", toggleAnimationPlayback);
elements.animationSelect.addEventListener("change", () => {
  playAnimation(Number(elements.animationSelect.value));
});

resetView();

async function handleFiles(fileList) {
  const files = Array.from(fileList ?? []);
  const file = files.find((item) => supportedExtensions.has(getExtension(item.name)));

  if (!file) {
    showError("没有找到支持的文件。请拖入 .psd、.fbx、.glb、.gltf 或 .obj 文件。");
    return;
  }

  resetSceneOnly();
  selectedNodeId = null;
  collapsedNodeIds.clear();
  setLoading(`正在解析 ${file.name} ...`);
  renderFileInfo(file, "解析中");

  try {
    const extension = getExtension(file.name);
    if (extension === "psd") {
      await parsePsd(file);
    } else {
      await parseModel(file, extension);
    }
  } catch (error) {
    console.error(error);
    showError(error?.message || "解析失败，请确认文件格式是否正确。");
    renderFileInfo(file, "解析失败");
  } finally {
    elements.fileInput.value = "";
  }
}

async function parsePsd(file) {
  const { readPsd } = await import("https://esm.sh/ag-psd@27.0.0");
  const psd = readPsd(await file.arrayBuffer(), {
    throwForMissingFeatures: false,
    logMissingFeatures: false,
    useImageData: false,
  });

  currentTree = [
    {
      id: "psd-root",
      name: file.name,
      type: "PSD",
      details: {
        类型: "Photoshop 文档",
        宽度: `${psd.width ?? "-"} px`,
        高度: `${psd.height ?? "-"} px`,
        子项数量: `${psd.children?.length ?? 0}`,
      },
      children: (psd.children ?? []).map((layer, index) => mapPsdLayer(layer, `psd-${index}`)),
    },
  ];

  renderPreviewCanvas(psd.canvas || imageDataToCanvas(psd.imageData, psd.width, psd.height), "PSD 合成预览");
  renderTree(currentTree);
  renderFileInfo(file, "PSD 解析完成", {
    尺寸: `${psd.width ?? "-"} x ${psd.height ?? "-"} px`,
    图层总数: countNodes(currentTree) - 1,
  });
  renderIssues(checkPsdRules(currentTree));
}

async function parseModel(file, extension) {
  const { THREE, OrbitControls, FBXLoader, GLTFLoader, OBJLoader } = await loadThreeRuntime();
  const url = URL.createObjectURL(file);
  activeObjectUrl = url;

  let rootObject;
  let animations = [];
  if (extension === "glb" || extension === "gltf") {
    const result = await new GLTFLoader().loadAsync(url);
    rootObject = result.scene;
    animations = result.animations ?? [];
  } else if (extension === "fbx") {
    rootObject = await new FBXLoader().loadAsync(url);
    animations = rootObject.animations ?? [];
  } else {
    rootObject = await new OBJLoader().loadAsync(url);
  }

  rootObject.name = rootObject.name || file.name;
  const stats = collectModelStats(rootObject);
  currentTree = [mapThreeObject(rootObject, "model-root")];

  renderModel(rootObject, animations, THREE, OrbitControls);
  renderTree(currentTree);
  renderFileInfo(file, "3D 模型解析完成", {
    对象数: stats.objects,
    网格数: stats.meshes,
    三角面: stats.triangles,
    材质数: stats.materials,
    动画数: animations.length,
  });
  renderIssues(checkModelRules(currentTree, stats, extension));
  elements.previewLabel.textContent = `${extension.toUpperCase()} 3D 预览`;
}

async function loadThreeRuntime() {
  if (threeRuntime) return threeRuntime;

  const [THREE, controls, fbx, gltf, obj] = await Promise.all([
    import("three"),
    import("three/addons/controls/OrbitControls.js"),
    import("three/addons/loaders/FBXLoader.js"),
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/loaders/OBJLoader.js"),
  ]);

  threeRuntime = {
    THREE,
    OrbitControls: controls.OrbitControls,
    FBXLoader: fbx.FBXLoader,
    GLTFLoader: gltf.GLTFLoader,
    OBJLoader: obj.OBJLoader,
  };
  return threeRuntime;
}

function mapPsdLayer(layer, id) {
  const width = Math.max(0, (layer.right ?? layer.width ?? 0) - (layer.left ?? 0));
  const height = Math.max(0, (layer.bottom ?? layer.height ?? 0) - (layer.top ?? 0));
  const type = layer.children?.length ? "组" : layer.text ? "文本" : layer.vectorMask ? "矢量" : "图层";

  return {
    id,
    name: layer.name || "(未命名图层)",
    type,
    details: {
      类型: type,
      可见: layer.hidden ? "否" : "是",
      透明度: formatPsdOpacity(layer.opacity),
      位置: `${layer.left ?? 0}, ${layer.top ?? 0}`,
      尺寸: `${width} x ${height} px`,
      混合模式: layer.blendMode || "normal",
      文本内容: layer.text?.text || "-",
      子项数量: `${layer.children?.length ?? 0}`,
    },
    children: (layer.children ?? []).map((child, index) => mapPsdLayer(child, `${id}-${index}`)),
  };
}

function mapThreeObject(object, id) {
  const geometry = object.geometry;
  const materialNames = toArray(object.material).map((material) => material?.name || material?.type || "未命名材质");
  const triangles = getTriangleCount(geometry);

  return {
    id,
    name: object.name || "(未命名对象)",
    type: getThreeType(object),
    details: {
      类型: getThreeType(object),
      可见: object.visible ? "是" : "否",
      子项数量: `${object.children.length}`,
      位置: formatVector(object.position),
      旋转: formatVector(object.rotation),
      缩放: formatVector(object.scale),
      材质: materialNames.length ? materialNames.join(", ") : "-",
      三角面: triangles ? `${triangles}` : "-",
      顶点数: geometry?.attributes?.position?.count ? `${geometry.attributes.position.count}` : "-",
    },
    children: object.children.map((child, index) => mapThreeObject(child, `${id}-${index}`)),
  };
}

function renderModel(rootObject, animations, THREE, OrbitControls) {
  resetSceneOnly();
  elements.preview.className = "preview";
  elements.preview.innerHTML = "";

  const width = elements.preview.clientWidth || 900;
  const height = 560;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1120);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.domElement.classList.add("three-canvas");
  elements.preview.appendChild(renderer.domElement);
  activeRenderer = renderer;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
  dirLight.position.set(4, 8, 6);
  scene.add(dirLight);
  scene.add(new THREE.GridHelper(10, 10, 0x334155, 0x1e293b));
  scene.add(rootObject);
  fitCameraToObject(camera, controls, rootObject, THREE);
  setupAnimations(rootObject, animations, THREE);

  const resizeObserver = new ResizeObserver(() => {
    const nextWidth = elements.preview.clientWidth || width;
    camera.aspect = nextWidth / height;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, height);
  });
  resizeObserver.observe(elements.preview);

  const clock = new THREE.Clock();
  function animate() {
    if (activeRenderer !== renderer) {
      resizeObserver.disconnect();
      return;
    }
    const delta = clock.getDelta();
    if (animationState.mixer && animationState.isPlaying) {
      animationState.mixer.update(delta);
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

function renderPreviewCanvas(canvas, label) {
  resetSceneOnly();
  elements.preview.className = "preview";
  elements.preview.innerHTML = "";
  elements.previewLabel.textContent = label;
  hideAnimationControls();

  if (!canvas) {
    elements.preview.classList.add("empty");
    elements.preview.innerHTML = "<p>这个 PSD 没有可用的合成预览，但仍可查看图层结构。</p>";
    return;
  }

  elements.preview.appendChild(canvas);
}

function setupAnimations(rootObject, animations, THREE) {
  resetAnimationState();

  if (!animations.length) {
    elements.animationControls.classList.remove("hidden");
    elements.animationStatus.textContent = "未检测到动画";
    elements.animationSelect.innerHTML = '<option value="">无可播放动画</option>';
    elements.animationSelect.disabled = true;
    elements.animationToggle.disabled = true;
    elements.animationToggle.textContent = "播放";
    return;
  }

  animationState.mixer = new THREE.AnimationMixer(rootObject);
  animationState.actions = animations.map((clip) => animationState.mixer.clipAction(clip));
  elements.animationControls.classList.remove("hidden");
  elements.animationStatus.textContent = `检测到 ${animations.length} 个动画`;
  elements.animationSelect.disabled = false;
  elements.animationToggle.disabled = false;
  elements.animationSelect.innerHTML = animations
    .map((clip, index) => `<option value="${index}">${escapeHtml(clip.name || `动画 ${index + 1}`)}</option>`)
    .join("");
  playAnimation(0);
}

function playAnimation(index) {
  const action = animationState.actions[index];
  if (!action) return;

  if (animationState.activeAction && animationState.activeAction !== action) {
    animationState.activeAction.stop();
  }

  animationState.activeAction = action;
  animationState.activeAction.reset().play();
  animationState.isPlaying = true;
  elements.animationToggle.textContent = "暂停";
  elements.animationSelect.value = String(index);
}

function toggleAnimationPlayback() {
  if (!animationState.activeAction) return;

  animationState.isPlaying = !animationState.isPlaying;
  animationState.activeAction.paused = !animationState.isPlaying;
  elements.animationToggle.textContent = animationState.isPlaying ? "暂停" : "播放";
}

function resetAnimationState() {
  if (animationState.activeAction) {
    animationState.activeAction.stop();
  }
  if (animationState.mixer) {
    animationState.mixer.stopAllAction();
  }
  animationState = {
    mixer: null,
    actions: [],
    activeAction: null,
    isPlaying: false,
  };
}

function hideAnimationControls() {
  resetAnimationState();
  elements.animationControls.classList.add("hidden");
  elements.animationStatus.textContent = "未检测到动画";
  elements.animationSelect.innerHTML = "";
  elements.animationToggle.textContent = "播放";
  elements.animationSelect.disabled = true;
  elements.animationToggle.disabled = true;
}

function renderTree(nodes) {
  elements.treeCount.textContent = `${countNodes(nodes)} 项`;
  elements.treeView.className = "tree-view";
  elements.treeView.innerHTML = "";

  if (!nodes.length) {
    elements.treeView.classList.add("empty");
    elements.treeView.textContent = "暂无层级信息";
    return;
  }

  const fragment = document.createDocumentFragment();
  nodes.forEach((node) => fragment.appendChild(renderTreeNode(node)));
  elements.treeView.appendChild(fragment);
}

function renderTreeNode(node) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";
  wrapper.classList.toggle("collapsed", collapsedNodeIds.has(node.id));

  const button = document.createElement("button");
  button.type = "button";
  button.classList.toggle("active", selectedNodeId === node.id);
  button.title = node.name;
  const hasChildren = Boolean(node.children?.length);
  button.innerHTML = `
    <span class="tree-caret">${hasChildren ? (collapsedNodeIds.has(node.id) ? ">" : "v") : ""}</span>
    <span class="tree-name">${escapeHtml(node.name)}</span>
    <span class="node-type">${escapeHtml(node.type)}</span>
  `;
  button.addEventListener("click", (event) => {
    if (hasChildren && (event.offsetX < 38 || event.altKey || event.metaKey || event.ctrlKey)) {
      toggleTreeNode(node.id);
      return;
    }
    selectedNodeId = node.id;
    renderNodeDetails(node);
    renderTree(currentTree);
  });
  button.addEventListener("dblclick", () => {
    if (hasChildren) toggleTreeNode(node.id);
  });
  wrapper.appendChild(button);

  if (node.children?.length) {
    const children = document.createElement("div");
    children.className = "tree-children";
    node.children.forEach((child) => children.appendChild(renderTreeNode(child)));
    wrapper.appendChild(children);
  }

  return wrapper;
}

function toggleTreeNode(nodeId) {
  if (collapsedNodeIds.has(nodeId)) {
    collapsedNodeIds.delete(nodeId);
  } else {
    collapsedNodeIds.add(nodeId);
  }
  renderTree(currentTree);
}

function renderNodeDetails(node) {
  renderInfoList(elements.nodeDetails, { 名称: node.name, ...node.details });
}

function renderFileInfo(file, status, extra = {}) {
  const info = {
    状态: status,
    文件名: file.name,
    格式: getExtension(file.name).toUpperCase(),
    大小: formatBytes(file.size),
    ...extra,
  };
  renderInfoList(elements.fileInfo, info);
}

function renderInfoList(target, info) {
  target.innerHTML = Object.entries(info)
    .map(
      ([key, value]) => `
        <div class="info-row">
          <dt>${escapeHtml(key)}</dt>
          <dd title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</dd>
        </div>
      `,
    )
    .join("");
}

function renderIssues(issues) {
  elements.issueCount.textContent = `${issues.length} 条`;
  if (!issues.length) {
    elements.issueList.innerHTML = '<li class="issue ok"><strong>未发现明显问题</strong><span>基础规范检查通过。</span></li>';
    return;
  }
  elements.issueList.innerHTML = issues
    .map((issue) => `<li class="issue ${issue.level}"><strong>${escapeHtml(issue.title)}</strong><span>${escapeHtml(issue.message)}</span></li>`)
    .join("");
}

function checkPsdRules(tree) {
  const issues = [];
  const nodes = flattenTree(tree).filter((node) => node.id !== "psd-root");
  const hiddenCount = nodes.filter((node) => node.details?.可见 === "否").length;
  const defaultNames = nodes.filter((node) => defaultNamePattern.test(node.name));
  const unnamed = nodes.filter((node) => node.name.startsWith("(未命名"));
  const emptyGroups = nodes.filter((node) => node.type === "组" && !node.children.length);

  if (unnamed.length) issues.push({ level: "warning", title: "存在未命名图层", message: `${unnamed.length} 个图层没有明确命名。` });
  if (defaultNames.length) issues.push({ level: "warning", title: "存在默认命名", message: `${defaultNames.length} 个图层或组疑似仍使用默认名称。` });
  if (emptyGroups.length) issues.push({ level: "info", title: "存在空组", message: `${emptyGroups.length} 个组没有子图层，可考虑清理。` });
  if (hiddenCount) issues.push({ level: "info", title: "包含隐藏图层", message: `${hiddenCount} 个图层处于隐藏状态，交付前建议确认。` });
  return issues;
}

function checkModelRules(tree, stats, extension) {
  const issues = [];
  const nodes = flattenTree(tree);
  const unnamed = nodes.filter((node) => node.name.startsWith("(未命名"));
  const defaultNames = nodes.filter((node) => defaultNamePattern.test(node.name));
  const emptyNodes = nodes.filter((node) => node.type === "Object3D" && !node.children.length);

  if (extension === "obj") issues.push({ level: "info", title: "OBJ 材质提示", message: "单独拖入 OBJ 时通常无法自动关联外部 MTL 和贴图。" });
  if (stats.triangles > 200000) issues.push({ level: "warning", title: "面数较高", message: `模型约 ${stats.triangles} 个三角面，可能有性能压力。` });
  if (unnamed.length) issues.push({ level: "warning", title: "存在未命名对象", message: `${unnamed.length} 个节点没有明确名称。` });
  if (defaultNames.length) issues.push({ level: "warning", title: "存在默认命名", message: `${defaultNames.length} 个节点疑似使用默认名称。` });
  if (emptyNodes.length) issues.push({ level: "info", title: "存在空节点", message: `${emptyNodes.length} 个 Object3D 没有子节点或几何体。` });
  if (!stats.materials) issues.push({ level: "info", title: "未检测到材质", message: "模型没有可识别材质，可能需要确认导出设置。" });
  return issues;
}

function collectModelStats(root) {
  const materialSet = new Set();
  const stats = { objects: 0, meshes: 0, triangles: 0, materials: 0 };
  root.traverse((object) => {
    stats.objects += 1;
    if (object.isMesh) {
      stats.meshes += 1;
      stats.triangles += getTriangleCount(object.geometry);
      toArray(object.material).forEach((material) => materialSet.add(material?.uuid || material?.name || material?.id));
    }
  });
  stats.materials = materialSet.size;
  return stats;
}

function fitCameraToObject(camera, controls, object, THREE) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  const distance = maxSize / (2 * Math.tan((camera.fov * Math.PI) / 360));
  camera.position.copy(center).add(new THREE.Vector3(distance * 0.9, distance * 0.7, distance * 1.15));
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance * 1000;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function resetView() {
  resetSceneOnly();
  hideAnimationControls();
  currentTree = [];
  selectedNodeId = null;
  collapsedNodeIds.clear();
  elements.previewLabel.textContent = "未加载";
  elements.treeCount.textContent = "0 项";
  elements.issueCount.textContent = "0 条";
  renderInfoList(elements.fileInfo, { 状态: "等待选择文件" });
  renderInfoList(elements.nodeDetails, { 状态: "点击左侧层级节点查看详情" });
  elements.treeView.className = "tree-view empty";
  elements.treeView.textContent = "暂无层级信息";
  elements.preview.className = "preview empty";
  elements.preview.innerHTML = "<p>选择素材后会在这里显示 PSD 合成预览或 3D 模型视窗。</p>";
  elements.issueList.innerHTML = '<li class="empty">暂无检查结果</li>';
}

function resetSceneOnly() {
  resetAnimationState();
  if (activeRenderer) {
    activeRenderer.dispose();
    activeRenderer.domElement.remove();
    activeRenderer = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

function setLoading(message) {
  elements.preview.className = "preview";
  elements.previewLabel.textContent = "解析中";
  elements.preview.innerHTML = `<div class="loading">${escapeHtml(message)}</div>`;
  elements.treeView.className = "tree-view empty";
  elements.treeView.textContent = "解析中 ...";
  elements.issueList.innerHTML = '<li class="empty">等待解析完成</li>';
  elements.issueCount.textContent = "0 条";
}

function showError(message) {
  elements.preview.className = "preview empty";
  elements.previewLabel.textContent = "解析失败";
  elements.preview.innerHTML = `<p>${escapeHtml(message)}</p>`;
  renderIssues([{ level: "error", title: "解析失败", message }]);
}

function flattenTree(nodes) {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}

function countNodes(nodes) {
  return flattenTree(nodes).length;
}

function getExtension(fileName) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPsdOpacity(opacity) {
  if (opacity == null) return "100%";
  if (opacity <= 1) return `${Math.round(opacity * 100)}%`;
  return `${Math.round((opacity / 255) * 100)}%`;
}

function imageDataToCanvas(imageData, width, height) {
  if (!imageData || !width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  return canvas;
}

function getThreeType(object) {
  if (object.isMesh) return "Mesh";
  if (object.isSkinnedMesh) return "SkinnedMesh";
  if (object.isBone) return "Bone";
  if (object.isLight) return "Light";
  if (object.isCamera) return "Camera";
  if (object.isGroup) return "Group";
  return object.type || "Object3D";
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getTriangleCount(geometry) {
  if (!geometry) return 0;
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  const position = geometry.attributes?.position;
  return position ? Math.floor(position.count / 3) : 0;
}

function formatVector(vector) {
  if (!vector) return "-";
  return [vector.x, vector.y, vector.z].map((value) => Number(value).toFixed(2)).join(", ");
}
