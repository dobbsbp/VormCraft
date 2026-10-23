import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Manifold's loader imports node:module only under Node; the browser gets a stub.
    alias: { 'node:module': fileURLToPath(new URL('./src/shims/node-module.ts', import.meta.url)) },
  },
  // Manifold ships its own WebAssembly loader; let Vite serve it untouched.
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Vendor code in its own cacheable chunks. Three.js is split along its own file seam
        // (core math/scene graph vs. WebGL renderer + shaders) so no chunk exceeds 500 kB.
        codeSplitting: {
          groups: [
            { name: 'three-core', test: /node_modules[\\/]three[\\/]build[\\/]three\.core/ },
            { name: 'three-renderer', test: /node_modules[\\/]three[\\/]/ },
            { name: 'manifold', test: /node_modules[\\/]manifold-3d[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
