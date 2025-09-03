/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { domains: ["localhost", "images.openai.com", "oaidalleapiprodscus.blob.core.windows.net"] },
  // Export the site as static HTML so it can be served by FastAPI.
  output: 'export',
  // Ensure directory-style URLs so paths like /studio resolve to /studio/index.html
  trailingSlash: true,
};
module.exports = nextConfig;
