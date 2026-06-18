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

## Processing pipeline

1. Load STL or OBJ
2. Optionally skip OBJ groups named like interior partitions
3. Repair mesh lightly (merge vertices, remove degenerate faces)
4. Cull faces not visible from outside the building envelope
5. Remove tiny floating components
6. Export binary STL

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
docker-compose.yml        Local full-stack dev
```
