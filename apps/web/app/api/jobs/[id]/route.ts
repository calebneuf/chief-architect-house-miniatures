import { NextRequest, NextResponse } from "next/server";

const MESH_WORKER_URL =
  process.env.MESH_WORKER_URL ?? "http://localhost:8000";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const response = await fetch(`${MESH_WORKER_URL}/jobs/${id}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json({
      jobId: payload.job_id,
      status: payload.status,
      stage: payload.stage,
      progress: payload.progress,
      previewStlBase64: payload.preview_stl_base64 ?? null,
      error: payload.error ?? null,
      result: payload.result
        ? {
            stlBase64: payload.result.stl_base64,
            facesBefore: payload.result.faces_before,
            facesAfter: payload.result.faces_after,
            facesRemoved: payload.result.faces_removed,
            componentsRemoved: payload.result.components_removed,
            processingMs: payload.result.processing_ms,
            groundFloorZ: payload.result.ground_floor_z,
            ceilingZ: payload.result.ceiling_z,
          }
        : null,
    });
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : "Connection failed";
    return NextResponse.json(
      {
        error: "Could not reach mesh worker.",
        details,
      },
      { status: 503 },
    );
  }
}
