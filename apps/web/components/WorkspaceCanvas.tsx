"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

type WorkspaceCanvasProps = {
  url?: string | null;
  fileName?: string;
  label?: string;
  /** Keep orbit/zoom when the model URL changes (live preview updates). */
  preserveView?: boolean;
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

function loadModel(
  url: string,
  fileName: string | undefined,
  material: THREE.MeshStandardMaterial,
): Promise<THREE.Object3D> {
  const lower = (fileName ?? url).toLowerCase();

  return new Promise((resolve, reject) => {
    if (lower.endsWith(".obj")) {
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

const LIVE_FADE_MS = 220;

export function WorkspaceCanvas({
  url,
  fileName,
  label,
  preserveView = false,
}: WorkspaceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Object3D | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const frameIdRef = useRef(0);
  const loadIdRef = useRef(0);
  const fadeRafRef = useRef(0);

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

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;
    materialRef.current = material;

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) {
        return;
      }
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight, false);
    };

    const animate = () => {
      frameIdRef.current = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
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
      material.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      materialRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const material = materialRef.current;

    if (!url || !scene || !camera || !controls || !material) {
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

    void loadModel(url, fileName, material)
      .then((loaded) => {
        if (loadIdRef.current !== loadId) {
          disposeObject(loaded);
          return;
        }

        const shouldPreserveView = preserveView && previousMesh !== null;
        const fadeMaterial = material.clone();
        fadeMaterial.transparent = true;
        fadeMaterial.depthWrite = false;

        loaded.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = fadeMaterial;
          }
        });

        scene.add(loaded);

        if (!shouldPreserveView) {
          if (previousMesh) {
            scene.remove(previousMesh);
            disposeObject(previousMesh);
          }
          meshRef.current = loaded;
          fitCameraToObject(camera, controls, loaded);
          fadeMaterial.opacity = 1;
          fadeMaterial.transparent = false;
          fadeMaterial.depthWrite = true;
          return;
        }

        fadeMaterial.opacity = 0;
        const fadeStart = performance.now();

        const fadeStep = (now: number) => {
          if (loadIdRef.current !== loadId) {
            return;
          }
          const progress = Math.min((now - fadeStart) / LIVE_FADE_MS, 1);
          fadeMaterial.opacity = progress;

          if (progress < 1) {
            fadeRafRef.current = window.requestAnimationFrame(fadeStep);
            return;
          }

          fadeMaterial.transparent = false;
          fadeMaterial.depthWrite = true;
          fadeMaterial.opacity = 1;

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
  }, [fileName, preserveView, url]);

  return (
    <div className="workspace-canvas">
      {label ? <div className="workspace-badge">{label}</div> : null}
      <div className="workspace-viewport" ref={containerRef}>
        {!url ? (
          <div className="workspace-empty">
            <h2>3D workspace</h2>
            <p>Upload a model in the sidebar to preview it here.</p>
            <p className="muted">Drag to orbit, scroll to zoom.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
