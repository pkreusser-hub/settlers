import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// public/data holds the player's copy of the original game's data file. It
// is copyrighted and must not end up in a build that gets uploaded: Vite
// copies public/ into the output folder, so the copy is removed again after
// the build, wherever the build was told to write. The built game then asks
// each player for their own SPAE.PA.
export default defineConfig(() => {
  let outDir = resolve(__dirname, 'dist');
  return {
    plugins: [
      {
        name: 'strip-game-data',
        apply: 'build',
        configResolved(config) {
          outDir = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
          rmSync(resolve(outDir, 'data'), { recursive: true, force: true });
          // The font and the button image are redrawn from the original
          // game's art, so they stay out of uploaded builds as well. The
          // game falls back to the font in the player's data file.
          rmSync(resolve(outDir, 'resources'), { recursive: true, force: true });
        },
      },
    ],
  };
});
