/** The interface talks to the two local services through same-origin paths. */
const MISSION = process.env.MISSION_SERVICE_URL ?? "http://127.0.0.1:8300";
const SCIENCE = process.env.SCIENCE_SERVICE_URL ?? "http://127.0.0.1:8310";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/svc/mission/:path*", destination: `${MISSION}/api/:path*` },
      { source: "/svc/science/:path*", destination: `${SCIENCE}/:path*` },
    ];
  },
};

export default nextConfig;
