import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mes = url.searchParams.get("mes") || "";
  const base = process.env.APPS_SCRIPT_URL;

  if (!base) return NextResponse.json({ error: "APPS_SCRIPT_URL not set" }, { status: 500 });

  const upstream = `${base}?route=timeseries&mes=${encodeURIComponent(mes)}&granularity=week`;
  const r = await fetch(upstream, { cache: "no-store" });
  const data = await r.json();

  return NextResponse.json(data);
}
