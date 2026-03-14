import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mes = url.searchParams.get("mes") || "";
  const base = process.env.APPS_SCRIPT_URL;

  if (!base) {
    return NextResponse.json({ error: "APPS_SCRIPT_URL not set" }, { status: 500 });
  }

  const upstream = `${base}?route=ranking&mes=${encodeURIComponent(mes)}`;
  const r = await fetch(upstream, { cache: "no-store", redirect: "follow" });

  const contentType = r.headers.get("content-type") || "";
  const text = await r.text();

  // Si no es JSON, devolvemos un error con un snippet del HTML para ver qué pasa
  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      {
        error: "Upstream did not return JSON",
        status: r.status,
        contentType,
        upstream,
        snippet: text.slice(0, 300),
      },
      { status: 500 }
    );
  }

  // Si sí es JSON
  return NextResponse.json(JSON.parse(text));
}
