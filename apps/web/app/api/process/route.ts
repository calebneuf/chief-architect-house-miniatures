import { NextRequest, NextResponse } from "next/server";

const MESH_WORKER_URL =
  process.env.MESH_WORKER_URL ?? "http://localhost:8000";

function log(...args: unknown[]) {
  console.log("[api/process]", ...args);
}

export async function POST(request: NextRequest) {
  log("request received");
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A model file is required." }, { status: 400 });
  }

  const workerFormData = new FormData();
  workerFormData.append("file", file, file.name);

  log("forwarding to worker", MESH_WORKER_URL, "file=", file.name, "bytes=", file.size);

  let response: Response;
  try {
    response = await fetch(`${MESH_WORKER_URL}/process`, {
      method: "POST",
      body: workerFormData,
    });
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : "Connection failed";
    log("worker unreachable:", details);
    return NextResponse.json(
      {
        error: "Mesh worker is unavailable.",
        code: "WORKER_UNREACHABLE",
        details: `Could not connect to ${MESH_WORKER_URL}. ${details}`,
        suggestions: [
          "Start the mesh-worker container in Dockge and wait up to 90 seconds for it to become healthy.",
          "In Dockge, open mesh-worker logs. If the container is crash-looping, pull the latest image and redeploy.",
          "Confirm the web container has MESH_WORKER_URL=http://mesh-worker:8000.",
          "From Unraid terminal: docker logs chief-architect-house-miniatures-mesh-worker-1",
        ],
      },
      { status: 503 },
    );
  }

  const payload = await response.json();
  if (!response.ok) {
    log("worker error", response.status, payload);
    const detail = payload.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(", ")
          : "Mesh processing failed.";
    return NextResponse.json(
      {
        error: message,
        code: "WORKER_PROCESSING_FAILED",
        details: `Worker at ${MESH_WORKER_URL} responded with HTTP ${response.status}.`,
        suggestions: [
          "Try a smaller or simpler export from Chief Architect.",
          "Check mesh-worker logs for the full Python traceback.",
        ],
      },
      { status: response.status },
    );
  }

  log("worker success", {
    facesBefore: payload.faces_before,
    facesAfter: payload.faces_after,
    processingMs: payload.processing_ms,
  });

  return NextResponse.json({
    stlBase64: payload.stl_base64,
    facesBefore: payload.faces_before,
    facesAfter: payload.faces_after,
    facesRemoved: payload.faces_removed,
    componentsRemoved: payload.components_removed,
    processingMs: payload.processing_ms,
  });
}
