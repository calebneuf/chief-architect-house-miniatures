"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

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

export function WorkspaceCanvas({
  source,
  label,
  preserveView = false,
  compare = null,
  compareLabel,
  compareSplit = 0.5,
  onCompareSplitChange,
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
      const leftWidth = Math.floor(width * split);
      const rightWidth = width - leftWidth;

      renderer.setScissorTest(true);
      renderer.setClearColor(0xd9e1ea, 1);

      renderer.setViewport(0, 0, leftWidth, height);
      renderer.setScissor(0, 0, leftWidth, height);
      leftMesh.visible = true;
      rightMesh.visible = false;
      renderer.render(scene, camera);

      renderer.setViewport(leftWidth, 0, rightWidth, height);
      renderer.setScissor(leftWidth, 0, rightWidth, height);
      leftMesh.visible = false;
      rightMesh.visible = true;
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

    return () => {
      window.cancelAnimationFrame(frameIdRef.current);
      window.cancelAnimationFrame(fadeRafRef.current);
      window.removeEventListener("resize", resize);
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

    void loadModelSource(source, material)
      .then((loaded) => {
        if (loadIdRef.current !== loadId) {
          disposeObject(loaded);
          return;
        }

        const shouldPreserveView = preserveView && previousMesh !== null;
        const activeMaterial = useCompareMaterial ? material : material.clone();
        if (!useCompareMaterial) {
          activeMaterial.transparent = true;
          activeMaterial.depthWrite = false;
        }

        loaded.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = activeMaterial;
          }
        });

        scene.add(loaded);

        if (!shouldPreserveView) {
          if (previousMesh) {
            scene.remove(previousMesh);
            disposeObject(previousMesh);
          }
          meshRef.current = loaded;
          if (!compareMeshRef.current) {
            fitCameraToObject(camera, controls, loaded);
          }
          activeMaterial.opacity = 1;
          activeMaterial.transparent = false;
          activeMaterial.depthWrite = true;
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
          meshRef.current = loaded;
        };

        fadeRafRef.current = window.requestAnimationFrame(fadeStep);
      })
      .catch((error) => {
        console.error("[miniature-prep] model load failed", error);
      });

    return () => {
      window.cancelAnimationFrame(fadeRafRef.current);
    };
  }, [compare, preserveView, source]);

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

        const fitTarget = meshRef.current ?? loaded;
        if (!meshRef.current) {
          fitCameraToObject(camera, controls, fitTarget);
        }
      })
      .catch((error) => {
        console.error("[miniature-prep] compare model load failed", error);
      });
  }, [compare]);

  const hasSource = Boolean(source?.arrayBuffer || source?.url);
  const showCompareSlider = Boolean(compare && hasSource);

  return (
    <div className="workspace-canvas">
      {label ? <div className="workspace-badge">{label}</div> : null}
      {compareLabel && showCompareSlider ? (
        <div className="workspace-badge workspace-badge-right">{compareLabel}</div>
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
      ) : null}
    </div>
  );
}
