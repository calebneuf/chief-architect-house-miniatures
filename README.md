# House Miniature Prep

Prepare Chief Architect STL/OBJ exports for 3D printing as house miniatures by removing interior partition walls.

## Architecture

- **Web app** (`apps/web`): Next.js upload UI, 3D preview, and download flow
- **Mesh worker** (`services/mesh-worker`): Python FastAPI service using trimesh for repair, exterior visibility culling, and STL export

## Local development

### Mesh worker

```bash
cd services/mesh-worker
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # Windows
uvicorn main:app --reload --port 8000
```

### Web app

```bash
cd apps/web
npm install
npm run dev
```

Set `MESH_WORKER_URL=http://localhost:8000` if needed (this is the default).

Open [http://localhost:3000](http://localhost:3000).

### Docker Compose

```bash
docker compose up --build
```

### Pre-built images (GHCR)

On every push to `main`, GitHub Actions publishes:

- `ghcr.io/calebneuf/chief-architect-house-miniatures-web:latest`
- `ghcr.io/calebneuf/chief-architect-house-miniatures-mesh-worker:latest`

Pull and run without building locally:

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

Change the host port in `docker-compose.ghcr.yml` if `3000` is taken, e.g. `"3080:3000"`.

**First-time setup:** After the first publish, open each package on GitHub → **Packages** → **Package settings** → set visibility to **Public** so Unraid/Dockge can pull without logging in.

### Dockge / Unraid troubleshooting

If **mesh-worker shows unhealthy** in Dockge:

1. Open the mesh-worker container **Logs** first. Look for Python import errors or out-of-memory kills.
2. Wait **up to 90 seconds** after start. The worker loads heavy mesh libraries and needs a longer health-check grace period.
3. Pull the latest `mesh-worker` image and redeploy the stack.
4. From Unraid terminal, test manually:
   ```bash
   docker ps
   docker logs <mesh-worker-container-name>
   curl http://localhost:8000/health
   ```
   (Only works if port `8000` is published on the mesh-worker service.)

If the web UI says **Mesh worker is unavailable** but the container is running:

- Confirm both containers are in the **same Dockge stack** so `http://mesh-worker:8000` resolves.
- Confirm the web service has `MESH_WORKER_URL=http://mesh-worker:8000`.

## Processing pipeline

1. Load STL or OBJ
2. Optionally skip OBJ groups named like interior partitions, basements, or fences
3. Repair mesh lightly (merge vertices, remove degenerate faces)
4. Cull faces not visible from outside the building envelope
5. Remove below-grade shells and detached exterior site objects
6. Remove tiny floating components
7. Export binary STL

## Chief Architect export tips

1. Open a 3D camera view before exporting
2. Activate a layer set that hides interior walls and unwanted fixtures
3. Export via **File → Export → 3D Model** as OBJ or STL
4. Upload the file to this service for automated cleanup

## Tests

```bash
cd services/mesh-worker
pytest -v
```

Generate synthetic tuning samples:

```bash
python scripts/generate_samples.py
python scripts/tune_samples.py
```

## Project layout

```
apps/web/                 Next.js frontend
services/mesh-worker/     Python mesh processing API
samples/                  Generated synthetic house meshes
docker-compose.yml        Local full-stack dev (build from source)
docker-compose.ghcr.yml   Pull pre-built images from GHCR
.github/workflows/        CI: publish Docker images on push to main
```
