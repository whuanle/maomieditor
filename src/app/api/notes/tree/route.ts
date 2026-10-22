import { NextResponse } from "next/server";
import { getTree } from "@/lib/store";

export async function GET() {
  const tree = await getTree();
  return NextResponse.json({ tree });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
