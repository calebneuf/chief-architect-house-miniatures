import * as THREE from "three";
import type { MeshComponent } from "@/lib/types";

const VERTEX_EPS = 1e-4;

type Triangle = [number, number, number];

function vertexKey(x: number, y: number, z: number): string {
  const scale = 1 / VERTEX_EPS;
  return `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    let current = index;
    while (this.parent[current] !== current) {
      const next = this.parent[current];
      this.parent[current] = root;
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }
}

type CollectedMesh = {
  triangles: Triangle[];
  vertices: number[];
};

function collectMeshData(root: THREE.Object3D): CollectedMesh {
  const triangles: Triangle[] = [];
  const vertexIndex = new Map<string, number>();
  const vertices: number[] = [];
  const position = new THREE.Vector3();

  const indexVertex = (x: number, y: number, z: number): number => {
    const key = vertexKey(x, y, z);
    const existing = vertexIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const next = vertices.length / 3;
    vertices.push(x, y, z);
    vertexIndex.set(key, next);
    return next;
  };

  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const positionAttr = child.geometry.getAttribute("position");
    if (!positionAttr) {
      return;
    }

    const matrix = child.matrixWorld;
    const faceCount = positionAttr.count / 3;
    for (let face = 0; face < faceCount; face += 1) {
      const indices: number[] = [];
      for (let corner = 0; corner < 3; corner += 1) {
        position.fromBufferAttribute(positionAttr, face * 3 + corner);
        position.applyMatrix4(matrix);
        indices.push(indexVertex(position.x, position.y, position.z));
      }
      triangles.push([indices[0], indices[1], indices[2]]);
    }
  });

  return { triangles, vertices };
}

function buildGeometry(vertices: number[], groupTriangles: Triangle[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];

  for (const [a, b, c] of groupTriangles) {
    positions.push(
      vertices[a * 3],
      vertices[a * 3 + 1],
      vertices[a * 3 + 2],
      vertices[b * 3],
      vertices[b * 3 + 1],
      vertices[b * 3 + 2],
      vertices[c * 3],
      vertices[c * 3 + 1],
      vertices[c * 3 + 2],
    );
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export type SplitComponentMesh = {
  mesh: THREE.Mesh;
  componentId: number;
  bounds: THREE.Box3;
  centroid: THREE.Vector3;
};

export function splitObjectIntoComponents(root: THREE.Object3D): SplitComponentMesh[] {
  const { triangles, vertices } = collectMeshData(root);
  if (triangles.length === 0) {
    return [];
  }

  const edgeToFaces = new Map<string, number[]>();
  triangles.forEach((triangle, faceIndex) => {
    const [a, b, c] = triangle;
    for (const pair of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = edgeKey(pair[0], pair[1]);
      const faces = edgeToFaces.get(key) ?? [];
      faces.push(faceIndex);
      edgeToFaces.set(key, faces);
    }
  });

  const unionFind = new UnionFind(triangles.length);
  for (const faces of edgeToFaces.values()) {
    if (faces.length < 2) {
      continue;
    }
    for (let index = 1; index < faces.length; index += 1) {
      unionFind.union(faces[0], faces[index]);
    }
  }

  const groups = new Map<number, Triangle[]>();
  triangles.forEach((triangle, faceIndex) => {
    const rootIndex = unionFind.find(faceIndex);
    const group = groups.get(rootIndex) ?? [];
    group.push(triangle);
    groups.set(rootIndex, group);
  });

  const results: SplitComponentMesh[] = [];
  for (const groupTriangles of groups.values()) {
    const geometry = buildGeometry(vertices, groupTriangles);
    const mesh = new THREE.Mesh(geometry);
    const bounds = new THREE.Box3().setFromObject(mesh);
    const centroid = bounds.getCenter(new THREE.Vector3());
    results.push({
      mesh,
      componentId: -1,
      bounds,
      centroid,
    });
  }

  return results;
}

function boundsCenter(bounds: number[][]): THREE.Vector3 {
  return new THREE.Vector3(
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
    (bounds[0][2] + bounds[1][2]) / 2,
  );
}

export function matchComponentsToServerIds(
  parts: SplitComponentMesh[],
  serverComponents: MeshComponent[],
): SplitComponentMesh[] {
  const available = new Set(serverComponents.map((component) => component.id));
  const sortedParts = [...parts].sort(
    (left, right) => right.bounds.getSize(new THREE.Vector3()).length() - left.bounds.getSize(new THREE.Vector3()).length(),
  );
  const sortedServer = [...serverComponents].sort((left, right) => right.footprint - left.footprint);

  for (let index = 0; index < sortedParts.length; index += 1) {
    const part = sortedParts[index];
    const server = sortedServer[index];
    if (server && available.has(server.id)) {
      part.componentId = server.id;
      available.delete(server.id);
      continue;
    }

    let bestId = -1;
    let bestDistance = Infinity;
    for (const component of serverComponents) {
      if (!available.has(component.id)) {
        continue;
      }
      const distance = part.centroid.distanceTo(boundsCenter(component.bounds));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = component.id;
      }
    }
    if (bestId >= 0) {
      part.componentId = bestId;
      available.delete(bestId);
    }
  }

  return sortedParts;
}

export function buildCleanupGroup(
  root: THREE.Object3D,
  serverComponents: MeshComponent[],
  material: THREE.MeshStandardMaterial,
): THREE.Group {
  const parts = matchComponentsToServerIds(splitObjectIntoComponents(root), serverComponents);
  const group = new THREE.Group();

  for (const part of parts) {
    const meshMaterial = material.clone();
    part.mesh.material = meshMaterial;
    part.mesh.userData.componentId = part.componentId;
    group.add(part.mesh);
  }

  return group;
}

export function visibleComponentCount(total: number, excludedIds: number[]): number {
  const excluded = new Set(excludedIds);
  return total - excluded.size;
}
