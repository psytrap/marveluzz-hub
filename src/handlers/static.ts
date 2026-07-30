// Marveluzz Hub - Static Asset Route Handler (static.ts)

export async function handleStaticAsset(pathname: string): Promise<Response | null> {
  if (!pathname.startsWith("/public/")) return null;

  try {
    const filePath = "." + pathname;
    const content = await Deno.readTextFile(filePath);
    const mimeType = pathname.endsWith(".css") ? "text/css" : "application/javascript";
    return new Response(content, { headers: { "Content-Type": mimeType } });
  } catch (_) {
    return new Response("File not found", { status: 404 });
  }
}
