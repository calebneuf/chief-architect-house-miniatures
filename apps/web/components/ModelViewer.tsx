"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

type ModelViewerProps = {
  title: string;
  url?: string | null;
  fileName?: string;
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

export function ModelViewer({ title, url, fileName }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!url || !containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8edf2);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    const directional = new THREE.DirectionalLight(0xffffff, 1.1);
    directional.position.set(5, 8, 4);
    scene.add(ambient, directional);

    const material = new THREE.MeshStandardMaterial({
      color: 0x6b7c93,
      metalness: 0.1,
      roughness: 0.85,
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
    <div className="viewer-card">
      <header>{title}</header>
      <div className="viewer-canvas" ref={containerRef}>
        {!url ? (
          <div className="muted" style={{ padding: "1rem" }}>
            No model loaded yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}
