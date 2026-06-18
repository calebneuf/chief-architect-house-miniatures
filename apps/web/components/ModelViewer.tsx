"use client";

import { Canvas, useLoader } from "@react-three/fiber";
import { Bounds, Center, OrbitControls, useBounds } from "@react-three/drei";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

type ModelViewerProps = {
  title: string;
  url?: string | null;
  fileName?: string;
};

function LoadedModel({ url, fileName }: { url: string; fileName?: string }) {
  const bounds = useBounds();
  const lower = (fileName ?? url).toLowerCase();
  const isObj = lower.endsWith(".obj");

  const object = useLoader(
    isObj ? OBJLoader : STLLoader,
    url,
    (loader) => {
      if (!isObj && loader instanceof STLLoader) {
        loader.setWithCredentials(false);
      }
    },
  );

  const displayObject = isObj
    ? (object as THREE.Group)
    : new THREE.Mesh(
        object as THREE.BufferGeometry,
        new THREE.MeshStandardMaterial({
          color: "#6b7c93",
          metalness: 0.1,
          roughness: 0.85,
        }),
      );

  useEffect(() => {
    bounds.refresh().fit();
  }, [bounds, displayObject]);

  return <primitive object={displayObject} />;
}

export function ModelViewer({ title, url, fileName }: ModelViewerProps) {
  return (
    <div className="viewer-card">
      <header>{title}</header>
      <div className="viewer-canvas">
        {url ? (
          <Canvas camera={{ position: [4, 4, 4], fov: 45 }}>
            <ambientLight intensity={0.75} />
            <directionalLight position={[5, 8, 4]} intensity={1.1} />
            <Suspense fallback={null}>
              <Bounds fit clip observe margin={1.2}>
                <Center>
                  <LoadedModel url={url} fileName={fileName} />
                </Center>
              </Bounds>
            </Suspense>
            <OrbitControls makeDefault enableDamping />
          </Canvas>
        ) : (
          <div className="muted" style={{ padding: "1rem" }}>
            No model loaded yet.
          </div>
        )}
      </div>
    </div>
  );
}
