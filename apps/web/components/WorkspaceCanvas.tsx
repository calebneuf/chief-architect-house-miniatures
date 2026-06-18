"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { buildCleanupGroup, visibleComponentCount } from "@/lib/meshComponents";
import type { MeshComponent } from "@/lib/types";

type ModelSource = {
  arrayBuffer?: ArrayBuffer | null;
  url?: string | null;
  fileName?: string;
};

type WorkspaceCanvasProps = {
  source?: ModelSource | null;
  label?: string;
  preserveView?: boolean;
  compare?: ModelSource | null;
  compareLabel?: string;
  compareSplit?: number;
  onCompareSplitChange?: (split: number) => void;
  cleanupMode?: boolean;
  serverComponents?: MeshComponent[];
  excludedIds?: number[];
  selectedComponentId?: number | null;
  onSelectComponent?: (id: number | null) => void;
  onExcludeComponents?: (ids: number[]) => void;
};

function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDim * 2.2;

  camera.position.set(center.x + distance, center.y + distance, center.z + distance);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function getBoundingCenter(object: THREE.Object3D): THREE.Vector3 {
  return new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
}

function alignObjectToReference(object: THREE.Object3D, reference: THREE.Object3D): void {
  const referenceCenter = getBoundingCenter(reference);
  const objectCenter = getBoundingCenter(object);
  object.position.add(referenceCenter.clone().sub(objectCenter));
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((item) => item.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function isObjName(name: string): boolean {
  return name.toLowerCase().endsWith(".obj");
}

function loadFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  material: THREE.MeshStandardMaterial,
): THREE.Object3D {
  if (isObjName(fileName)) {
    const text = new TextDecoder().decode(buffer);
    return new OBJLoader().parse(text);
  }

  const geometry = new STLLoader().parse(buffer);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function loadFromUrl(
  url: string,
  fileName: string,
  material: THREE.MeshStandardMaterial,
): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    if (isObjName(fileName)) {
      new OBJLoader().load(url, resolve, undefined, reject);
      return;
    }

    new STLLoader().load(
      url,
      (geometry) => {
        geometry.computeVertexNormals();
        resolve(new THREE.Mesh(geometry, material));
      },
      undefined,
      reject,
    );
  });
}

function loadModelSource(
  source: ModelSource,
  material: THREE.MeshStandardMaterial,
): Promise<THREE.Object3D> {
  const fileName = source.fileName ?? source.url ?? "model.stl";

  if (source.arrayBuffer) {
    return Promise.resolve(loadFromBuffer(source.arrayBuffer, fileName, material));
  }

  if (source.url) {
    return loadFromUrl(source.url, fileName, material);
  }

  return Promise.reject(new Error("No model data provided."));
}

const LIVE_FADE_MS = 220;
const SELECTED_EMISSIVE = 0x2a6d9f;

function applyComponentVisuals(
  root: THREE.Object3D,
  excludedIds: number[],
  selectedComponentId: number | null,
) {
  const excluded = new Set(excludedIds);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const componentId = child.userData.componentId as number | undefined;
    if (componentId === undefined) {
      return;
    }

    child.visible = !excluded.has(componentId);
    const material = child.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      return;
    }

    if (componentId === selectedComponentId && child.visible) {
      material.emissive.setHex(SELECTED_EMISSIVE);
      material.emissiveIntensity = 0.4;
    } else {
      material.emissive.setHex(0x000000);
      material.emissiveIntensity = 0;
    }
  });
}

export function WorkspaceCanvas({
  source,
  label,
  preserveView = false,
  compare = null,
  compareLabel,
  compareSplit = 0.5,
  onCompareSplitChange,
  cleanupMode = false,
  serverComponents = [],
  excludedIds = [],
  selectedComponentId = null,
  onSelectComponent,
  onExcludeComponents,
}: WorkspaceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Object3D | null>(null);
  const compareMeshRef = useRef<THREE.Object3D | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const compareMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const frameIdRef = useRef(0);
  const loadIdRef = useRef(0);
  const compareLoadIdRef = useRef(0);
  const fadeRafRef = useRef(0);
  const compareModeRef = useRef(false);
  const compareSplitRef = useRef(compareSplit);
  const cleanupModeRef = useRef(cleanupMode);
  const excludedIdsRef = useRef(excludedIds);
  const selectedIdRef = useRef(selectedComponentId);
  const serverComponentsRef = useRef(serverComponents);
  const onSelectComponentRef = useRef(onSelectComponent);
  const onExcludeComponentsRef = useRef(onExcludeComponents);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const pointerDragRef = useRef(false);
  const pointerDownRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    cleanupModeRef.current = cleanupMode;
  }, [cleanupMode]);

  useEffect(() => {
    excludedIdsRef.current = excludedIds;
  }, [excludedIds]);

  useEffect(() => {
    selectedIdRef.current = selectedComponentId;
  }, [selectedComponentId]);

  useEffect(() => {
    serverComponentsRef.current = serverComponents;
  }, [serverComponents]);

  useEffect(() => {
    onSelectComponentRef.current = onSelectComponent;
  }, [onSelectComponent]);

  useEffect(() => {
    onExcludeComponentsRef.current = onExcludeComponents;
  }, [onExcludeComponents]);

  useEffect(() => {
    if (meshRef.current) {
      applyComponentVisuals(meshRef.current, excludedIds, selectedComponentId);
    }
  }, [excludedIds, selectedComponentId]);

  useEffect(() => {
    compareSplitRef.current = compareSplit;
  }, [compareSplit]);

  useEffect(() => {
    compareModeRef.current = Boolean(compare && source);
  }, [compare, source]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd9e1ea);

    const grid = new THREE.GridHelper(40, 40, 0xb8c3cf, 0xc7d0db);
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setScissorTest(true);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(6, 10, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
    fillLight.position.set(-5, 4, -6);
    scene.add(fillLight);

    const material = new THREE.MeshStandardMaterial({
      color: 0x6f8098,
      metalness: 0.08,
      roughness: 0.82,
    });

    const compareMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f7a68,
      metalness: 0.08,
      roughness: 0.82,
    });

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;
    materialRef.current = material;
    compareMaterialRef.current = compareMaterial;

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) {
        return;
      }
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight, false);
    };

    const renderScene = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) {
        return;
      }

      const leftMesh = meshRef.current;
      const rightMesh = compareMeshRef.current;

      if (!compareModeRef.current || !leftMesh || !rightMesh) {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, width, height);
        if (leftMesh) leftMesh.visible = true;
        if (rightMesh) rightMesh.visible = false;
        renderer.render(scene, camera);
        return;
      }

      const split = Math.min(0.92, Math.max(0.08, compareSplitRef.current));
      const splitPx = Math.floor(width * split);

      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.setClearColor(0xd9e1ea, 1);
      renderer.clear(true, true, true);

      leftMesh.visible = false;
      rightMesh.visible = true;
      renderer.render(scene, camera);

      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, splitPx, height);
      renderer.clear(false, true, true);
      leftMesh.visible = true;
      rightMesh.visible = false;
      renderer.render(scene, camera);

      renderer.setScissorTest(false);
      leftMesh.visible = true;
      rightMesh.visible = true;
    };

    const animate = () => {
      frameIdRef.current = window.requestAnimationFrame(animate);
      controls.update();
      renderScene();
    };

    resize();
    animate();
    window.addEventListener("resize", resize);

    const pickComponent = (event: PointerEvent) => {
      if (!cleanupModeRef.current || compareModeRef.current) {
        return;
      }

      const camera = cameraRef.current;
      const scene = sceneRef.current;
      const root = meshRef.current;
      const renderer = rendererRef.current;
      if (!camera || !scene || !root || !renderer) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const pickables: THREE.Object3D[] = [];
      root.traverse((child) => {
        if (
          child instanceof THREE.Mesh &&
          child.visible &&
          child.userData.componentId !== undefined
        ) {
          pickables.push(child);
        }
      });

      const hits = raycasterRef.current.intersectObjects(pickables, false);
      const hit = hits[0]?.object;
      const componentId =
        hit && hit.userData.componentId !== undefined
          ? (hit.userData.componentId as number)
          : null;
      onSelectComponentRef.current?.(componentId);
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerDragRef.current = false;
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
    };

    const onPointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - pointerDownRef.current.x;
      const deltaY = event.clientY - pointerDownRef.current.y;
      if (Math.hypot(deltaX, deltaY) > 4) {
        pointerDragRef.current = true;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDragRef.current) {
        pickComponent(event);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!cleanupModeRef.current || compareModeRef.current) {
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      const selectedId = selectedIdRef.current;
      if (selectedId === null || selectedId === undefined) {
        return;
      }

      const excluded = excludedIdsRef.current;
      if (excluded.includes(selectedId)) {
        return;
      }

      const total = serverComponentsRef.current.length;
      if (visibleComponentCount(total, excluded) <= 1) {
        return;
      }

      event.preventDefault();
      onExcludeComponentsRef.current?.([...excluded, selectedId]);
      onSelectComponentRef.current?.(null);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frameIdRef.current);
      window.cancelAnimationFrame(fadeRafRef.current);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      controls.dispose();
      renderer.dispose();
      if (meshRef.current) {
        disposeObject(meshRef.current);
        meshRef.current = null;
      }
      if (compareMeshRef.current) {
        disposeObject(compareMeshRef.current);
        compareMeshRef.current = null;
      }
      material.dispose();
      compareMaterial.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      materialRef.current = null;
      compareMaterialRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const material = materialRef.current;

    if (!source || !scene || !camera || !controls || !material) {
      if (meshRef.current && scene) {
        scene.remove(meshRef.current);
        disposeObject(meshRef.current);
        meshRef.current = null;
      }
      return;
    }

    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    const previousMesh = meshRef.current;
    const useCompareMaterial = Boolean(compare);
    const useCleanupSplit = cleanupMode && serverComponents.length > 0 && !compare;

    void loadModelSource(source, material)
      .then((loaded) => {
        if (loadIdRef.current !== loadId) {
          disposeObject(loaded);
          return;
        }

        let displayRoot: THREE.Object3D = loaded;
        if (useCleanupSplit) {
          displayRoot = buildCleanupGroup(loaded, serverComponents, material);
          disposeObject(loaded);
          applyComponentVisuals(displayRoot, excludedIdsRef.current, selectedIdRef.current);
        }

        const shouldPreserveView = preserveView && previousMesh !== null;
        const activeMaterial = useCompareMaterial ? material : material.clone();
        if (!useCompareMaterial && !useCleanupSplit) {
          activeMaterial.transparent = true;
          activeMaterial.depthWrite = false;
        }

        if (!useCleanupSplit) {
          displayRoot.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.material = activeMaterial;
            }
          });
        }

        scene.add(displayRoot);

        if (!shouldPreserveView) {
          if (previousMesh) {
            scene.remove(previousMesh);
            disposeObject(previousMesh);
          }
          meshRef.current = displayRoot;
          if (compareMeshRef.current) {
            alignObjectToReference(compareMeshRef.current, displayRoot);
          } else if (!compareMeshRef.current) {
            fitCameraToObject(camera, controls, displayRoot);
          }
          if (!useCleanupSplit) {
            activeMaterial.opacity = 1;
            activeMaterial.transparent = false;
            activeMaterial.depthWrite = true;
          }
          return;
        }

        if (useCleanupSplit) {
          if (previousMesh) {
            scene.remove(previousMesh);
            disposeObject(previousMesh);
          }
          meshRef.current = displayRoot;
          return;
        }

        activeMaterial.opacity = 0;
        const fadeStart = performance.now();

        const fadeStep = (now: number) => {
          if (loadIdRef.current !== loadId) {
            return;
          }
          const progress = Math.min((now - fadeStart) / LIVE_FADE_MS, 1);
          activeMaterial.opacity = progress;

          if (progress < 1) {
            fadeRafRef.current = window.requestAnimationFrame(fadeStep);
            return;
          }

          activeMaterial.transparent = false;
          activeMaterial.depthWrite = true;
          activeMaterial.opacity = 1;

          if (previousMesh) {
            scene.remove(previousMesh);
            disposeObject(previousMesh);
          }
          meshRef.current = displayRoot;
        };

        fadeRafRef.current = window.requestAnimationFrame(fadeStep);
      })
      .catch((error) => {
        console.error("[miniature-prep] model load failed", error);
      });

    return () => {
      window.cancelAnimationFrame(fadeRafRef.current);
    };
  }, [cleanupMode, compare, preserveView, serverComponents, source]);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const compareMaterial = compareMaterialRef.current;

    if (!compare || !scene || !camera || !controls || !compareMaterial) {
      if (compareMeshRef.current && scene) {
        scene.remove(compareMeshRef.current);
        disposeObject(compareMeshRef.current);
        compareMeshRef.current = null;
      }
      return;
    }

    const loadId = compareLoadIdRef.current + 1;
    compareLoadIdRef.current = loadId;
    const previousMesh = compareMeshRef.current;

    void loadModelSource(compare, compareMaterial)
      .then((loaded) => {
        if (compareLoadIdRef.current !== loadId) {
          disposeObject(loaded);
          return;
        }

        loaded.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = compareMaterial;
          }
        });

        scene.add(loaded);

        if (previousMesh) {
          scene.remove(previousMesh);
          disposeObject(previousMesh);
        }
        compareMeshRef.current = loaded;

        if (meshRef.current) {
          alignObjectToReference(loaded, meshRef.current);
        } else {
          fitCameraToObject(camera, controls, loaded);
        }
      })
      .catch((error) => {
        console.error("[miniature-prep] compare model load failed", error);
      });
  }, [compare]);

  const hasSource = Boolean(source?.arrayBuffer || source?.url);
  const showCompareSlider = Boolean(compare && hasSource);
  const showCleanupHint = Boolean(cleanupMode && hasSource && !compare);

  const updateCompareSplitFromPointer = (clientX: number) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    onCompareSplitChange?.(Math.min(0.92, Math.max(0.08, ratio)));
  };

  return (
    <div className="workspace-canvas">
      {label ? <div className="workspace-badge">{label}</div> : null}
      {compareLabel && showCompareSlider ? (
        <div className="workspace-badge workspace-badge-right">{compareLabel}</div>
      ) : null}
      {showCleanupHint ? (
        <div className="workspace-hint">
          Click a part to select · <kbd>Delete</kbd> to remove
        </div>
      ) : null}
      <div className="workspace-viewport" ref={containerRef}>
        {!hasSource ? (
          <div className="workspace-empty">
            <h2>3D workspace</h2>
            <p>Upload a model in the sidebar to preview it here.</p>
            <p className="muted">Drag to orbit, scroll to zoom.</p>
          </div>
        ) : null}
      </div>
      {showCompareSlider ? (
        <>
          <div
            className="compare-divider"
            style={{ left: `${compareSplit * 100}%` }}
            onPointerDown={(event) => {
              event.preventDefault();
              updateCompareSplitFromPointer(event.clientX);

              const onMove = (moveEvent: PointerEvent) => {
                updateCompareSplitFromPointer(moveEvent.clientX);
              };
              const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
              };

              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
            role="slider"
            aria-label="Compare divider"
            aria-valuemin={8}
            aria-valuemax={92}
            aria-valuenow={Math.round(compareSplit * 100)}
          >
            <span className="compare-divider-handle" />
          </div>
          <div className="compare-controls">
            <span className="muted tiny">Original</span>
            <input
              type="range"
              min={8}
              max={92}
              value={Math.round(compareSplit * 100)}
              onChange={(event) => onCompareSplitChange?.(Number(event.target.value) / 100)}
              aria-label="Compare slider"
            />
            <span className="muted tiny">Processed</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
