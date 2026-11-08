import { NextResponse, type NextRequest } from "next/server";

/**
 * This server answers only to the names of this machine. A site that points its own name at
 * 127.0.0.1 (DNS rebinding) would otherwise read its pages as same-origin, the credit's relay
 * secret among them (app/api/credit). The relay is left out: it checks that secret itself, and
 * Proxy would hold every call's body in memory first.
 */
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  return LOCAL.has(host) ? NextResponse.next() : new NextResponse("Not this host.", { status: 421 });
}

export const config = { matcher: "/((?!api/credit/relay|_next/static|_next/image).*)" };
