import { NextRequest, NextResponse } from "next/server";

const MESH_WORKER_URL =
  process.env.MESH_WORKER_URL ?? "http://localhost:8000";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A model file is required." }, { status: 400 });
  }

  const workerFormData = new FormData();
  workerFormData.append("file", file, file.name);

  let response: Response;
  try {
    response = await fetch(`${MESH_WORKER_URL}/process`, {
      method: "POST",
      body: workerFormData,
    });
  } catch {
    return NextResponse.json(
      { error: "Mesh worker is unavailable. Start the Python service and try again." },
      { status: 503 },
    );
  }

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(", ")
          : "Mesh processing failed.";
    return NextResponse.json({ error: message }, { status: response.status });
  }

  return NextResponse.json({
    stlBase64: payload.stl_base64,
    facesBefore: payload.faces_before,
    facesAfter: payload.faces_after,
    facesRemoved: payload.faces_removed,
    componentsRemoved: payload.components_removed,
    processingMs: payload.processing_ms,
  });
}
