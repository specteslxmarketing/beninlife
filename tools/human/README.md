# Realistic character build (CC0 MakeHuman)

1. Blender 4.2 LTS + the MPFB2 extension (`blender -b --command extension install-file -r user_default -e mpfb.zip`).
2. Unzip `makehuman_system_assets_cc0.zip` into `~/.config/blender/4.2/extensions/.user/user_default/mpfb/data`.
3. `blender -b --python tools/human/build.py -- tools/human/out` builds `male.glb` and `female.glb`. They contain the
   game_engine skeleton, per-outfit body variants (the skin hidden under clothes is removed) and split top/bottom garments.
4. `python3 tools/human/textures.py client/public/models/tex` writes the web-sized textures.
5. `npx gltf-transform optimize tools/human/out/male.glb client/public/models/male.glb --compress meshopt --texture-compress false --simplify false --instance false --flatten false --join false` (and the same for `female.glb`).

At runtime `client/src/human.ts` clones the skinned mesh. It drives the bones from the same procedural gait and poses
(walk, idle, sit, work, wave, talk) as the Low-quality fallback figure in `client/src/character.ts`.
