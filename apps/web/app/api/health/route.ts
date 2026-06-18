import { NextResponse } from "next/server";

const MESH_WORKER_URL =
  process.env.MESH_WORKER_URL ?? "http://localhost:8000";

function log(...args: unknown[]) {
  console.log("[api/health]", ...args);
}

export async function GET() {
  log("checking worker at", MESH_WORKER_URL);
  try {
    const response = await fetch(`${MESH_WORKER_URL}/health`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        {
          status: "error",
          error: "Mesh worker returned an error.",
          workerUrl: MESH_WORKER_URL,
          workerStatus: payload,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      status: "ok",
      workerUrl: MESH_WORKER_URL,
      worker: payload,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Connection failed";
    return NextResponse.json(
      {
        status: "error",
        error: "Mesh worker is unreachable.",
        details: message,
        workerUrl: MESH_WORKER_URL,
        suggestions: [
          "Start the mesh-worker container.",
          "Verify MESH_WORKER_URL points to the worker service.",
          "In Docker Compose, the web service should use http://mesh-worker:8000.",
        ],
      },
      { status: 503 },
    );
  }
}
