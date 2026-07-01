/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "playwright-core",
      "playwright-extra",
      "puppeteer-extra-plugin-stealth",
      "@sparticuz/chromium-min",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "photos.zillowstatic.com",
      },
    ],
  },
};

module.exports = nextConfig;
