const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
      });
    }
    if (url.pathname === "/api/services/discovery") {
      return Response.json({
        success: true,
        configuredServices: ["n8n", "yt-dlp"],
      });
    }
    if (url.pathname === "/call" && req.method === "POST") {
      if (process.env.MOCK_REMOTE_AUTH_FAIL === "1") {
        return new Response("unauthorized", { status: 401 });
      }
      return Response.json({
        success: true,
        result: {
          routed: "remote",
          request: await req.json(),
        },
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(JSON.stringify({ port: server.port }));

const shutdown = () => {
  server.stop(true);
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await new Promise(() => {});
