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

export function WorkspaceCanvas({ url, fileName, label }: WorkspaceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!url || !containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd9e1ea);

    const grid = new THREE.GridHelper(40, 40, 0xb8c3cf, 0xc7d0db);
    grid.position.y = 0;
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

    let mesh: THREE.Object3D | null = null;
    let frameId = 0;
    let disposed = false;

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
      frameId = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    const lower = (fileName ?? url).toLowerCase();
    const onLoaded = (object: THREE.Object3D) => {
      if (disposed) {
        return;
      }
      mesh = object;
      scene.add(mesh);
      fitCameraToObject(camera, controls, mesh);
      resize();
      animate();
    };

    if (lower.endsWith(".obj")) {
      new OBJLoader().load(url, onLoaded);
    } else {
      new STLLoader().load(url, (geometry) => {
        geometry.computeVertexNormals();
        onLoaded(new THREE.Mesh(geometry, material));
      });
    }

    resize();
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();
      if (mesh) {
        mesh.traverse((child) => {
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
      container.removeChild(renderer.domElement);
    };
  }, [fileName, url]);

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
