/** The interface talks to the two local services through same-origin paths. */
const MISSION = process.env.MISSION_SERVICE_URL ?? "http://127.0.0.1:8300";
const SCIENCE = process.env.SCIENCE_SERVICE_URL ?? "http://127.0.0.1:8310";

/** @type {import('next').NextConfig} */
const nextConfig = process.env.NEXT_PUBLIC_STATIC === "1"
  ? {
      // The shared copy: plain files under a sub-folder, no server. The mission service runs in the page
      // and the science answers are saved files (see web/lib/staticBackend.ts, scripts/build_pages_app.py).
      reactStrictMode: true,
      output: "export",
      distDir: "out-static",
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      reactStrictMode: true,
      async rewrites() {
        return [
          { source: "/svc/mission/:path*", destination: `${MISSION}/api/:path*` },
          { source: "/svc/science/:path*", destination: `${SCIENCE}/:path*` },
        ];
      },
    };

export default nextConfig;
