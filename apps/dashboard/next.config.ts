import type { NextConfig } from 'next';

/**
 * The tracker packages run in Node from their dist output and are never bundled: they load a
 * native SQLite driver and locate their SQL migrations next to their own files. Workspace
 * packages are symlinked, so `serverExternalPackages` alone does not keep them out of the
 * bundle; the webpack externals below do.
 */
const EXTERNAL = ['@jobhunt-hq/core', '@jobhunt-hq/resume', 'better-sqlite3'];

const config: NextConfig = {
  serverExternalPackages: EXTERNAL,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  webpack: (webpackConfig, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(webpackConfig.externals)
        ? webpackConfig.externals
        : [webpackConfig.externals];
      webpackConfig.externals = [
        ...externals,
        Object.fromEntries(EXTERNAL.map((name) => [name, `import ${name}`])),
      ];
    }
    return webpackConfig;
  },
};

export default config;
