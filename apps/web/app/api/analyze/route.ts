import { NextRequest, NextResponse } from "next/server";

const MESH_WORKER_URL =
  process.env.MESH_WORKER_URL ?? "http://localhost:8000";

export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A model file is required." }, { status: 400 });
  }

  const workerFormData = new FormData();
  workerFormData.append("file", file, file.name);

  try {
    const response = await fetch(`${MESH_WORKER_URL}/analyze`, {
      method: "POST",
      body: workerFormData,
    });
    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }
    return NextResponse.json({ components: payload.components ?? [] });
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : "Connection failed";
    return NextResponse.json(
      {
        error: "Mesh worker is unavailable.",
        code: "WORKER_UNREACHABLE",
        details: `Could not connect to ${MESH_WORKER_URL}. ${details}`,
      },
      { status: 503 },
    );
  }
}
