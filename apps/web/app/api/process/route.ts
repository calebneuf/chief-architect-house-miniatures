import { NextRequest, NextResponse } from "next/server";

const MESH_WORKER_URL =
  process.env.MESH_WORKER_URL ?? "http://localhost:8000";

/** Large Chief Architect exports can take many minutes to process. */
const WORKER_TIMEOUT_MS = 20 * 60 * 1000;

export const maxDuration = 1200;

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

  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
  log(
    "forwarding to worker",
    MESH_WORKER_URL,
    "file=",
    file.name,
    "bytes=",
    file.size,
    `(${sizeMb} MB, timeout ${WORKER_TIMEOUT_MS / 60000} min)`,
  );

  let response: Response;
  try {
    response = await fetch(`${MESH_WORKER_URL}/process`, {
      method: "POST",
      body: workerFormData,
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : "Connection failed";
    const timedOut =
      cause instanceof Error &&
      (cause.name === "TimeoutError" || cause.name === "AbortError");

    log(timedOut ? "worker timeout:" : "worker unreachable:", details);

    if (timedOut) {
      return NextResponse.json(
        {
          error: "Mesh processing timed out.",
          code: "WORKER_TIMEOUT",
          details: `No response from ${MESH_WORKER_URL} within ${WORKER_TIMEOUT_MS / 60000} minutes. Large models (${sizeMb} MB) can take a long time — check mesh-worker logs to see if processing is still running.`,
          suggestions: [
            "Open mesh-worker logs in Dockge — if you still see pipeline steps, wait and try again with a longer timeout later.",
            "Hide extra layers in Chief Architect before export to reduce file size.",
            "Give the mesh-worker container at least 4 GB RAM for large exports.",
          ],
        },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        error: "Mesh worker is unavailable.",
        code: "WORKER_UNREACHABLE",
        details: `Could not connect to ${MESH_WORKER_URL}. ${details}`,
        suggestions: [
          "The worker may be busy processing another large file — check mesh-worker logs.",
          "If the container restarted, wait up to 90 seconds for it to become healthy.",
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
          "Check mesh-worker logs for the full Python traceback.",
          "Try hiding basement, furniture, and landscaping layers before export.",
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
