# Assets and licences

| Asset | Source | Licence / status |
|-------|--------|------------------|
| BEST 𝕏 crown emblem (`assets/bestx_crown_logo.jpg`, derived `client/public/brand/*`, favicon) | Supplied by the project owner | Owner-provided, used with permission for this project |
| Realistic human bodies (`client/public/models/male.glb`, `female.glb`): MakeHuman base mesh with African macro targets, `game_engine` skeleton and weights, eyes, eyebrows, eyelashes, hair `short02` / `afro01`, clothes `male_casualsuit06`, `male_casualsuit03`, `male_elegantsuit01`, `female_elegantsuit01`, `shoes04` | MakeHuman / MPFB2 v2.0.17 core assets plus the **MakeHuman system assets** pack (`makehuman_system_assets_cc0.zip`, static.makehumancommunity.org). Built headlessly with Blender 4.2 LTS (`tools/human/build.py`) and compressed with glTF-Transform (meshopt) | **CC0 1.0** (public domain). The MPFB add-on code is GPL, but it is a build tool only and is not shipped |
| Character textures (`client/public/models/tex/*`): young African male/female skins, brown eye, hair, brows, lashes, clothes and shoes; the white-suit, grey and tintable variants are derived by `tools/human/textures.py` | Same MakeHuman system assets pack | **CC0 1.0** |
| Procedural fallback figure (Low quality), all other 3D models (cars, houses, interiors, mansion, airliner, airport, Car Stands) | Generated procedurally in code (`client/src/*.ts`) | Original work of this project |
| All textures (roads, plaster, marble, signs, poster, livery, carpet, etc.) | Drawn procedurally with Canvas 2D at runtime | Original work of this project |
| "Eghosa Nova" poster | Procedural canvas artwork of a **fictional** artist (no real person's likeness) | Original work of this project |
| All sound (ambience, rain/thunder, engine, horn, doors, footsteps, cabin hum, landing, ringtones, radio loop) | Synthesised live with the Web Audio API (`client/src/audio.ts`); no audio files | Original work of this project |
| Radio stations (Benin FM, Oba Amapiano, Highlife Gold, Eko Street) | Generated at runtime by `client/src/radio.ts` (procedural drums, log drum, bass, chords, melodies) | Original work of this project; no samples or recordings |
| Weapons (pistol, SMG, shotgun), muzzle flash, tracers; gunshot / reload / hit sounds | Procedural geometry (`client/src/guns.ts`) and Web Audio synthesis (`client/src/audio.ts`). Generic designs, invented names (Sentry 9, Harmattan, Bulwark 12), no manufacturer marks | Original work of this project |
| Gun shop (Ekehuan Arms & Licensing), Ogbe General Hospital, gang emblems | Procedural buildings and Unicode symbols; fictional names | Original work of this project. No real cult or confraternity names or symbols |
| Character motion | Procedural animation (no motion-capture clips used) | Original work of this project |
| Advisor / captain voice | The browser's built-in Speech Synthesis voice, if available (subtitles always shown) | Provided by the user's browser/OS; nothing is bundled |
| Fonts | System fonts (Noto Sans / Arial fallbacks) | Not bundled |

No GTA, Lagos Life or other third-party game assets, code, logos or branding are used. Airline ("Ivie Air"), businesses
and people are fictional.

## Vehicles (October 2026 rebuild)

| Asset | Source | Licence |
|---|---|---|
| All cars, SUVs, minivan, pickup, HiAce-style bus, keke and okada (`client/src/carshape.ts`, `client/src/car.ts`) | Original procedural geometry generated at runtime: lofted superellipse body sections, arch cut-outs, tumblehome glasshouse, conforming lamp/grille patches, lathed tyres and extruded alloy rims. No external meshes and no manufacturer logos; the names are generic "-style" labels. | Project code (original work) |
| Grille mesh/slat textures | Drawn procedurally on a canvas at runtime | Project code (original work) |

Evaluated but not used: the CC0 "Road Car Showroom Lineup" GLBs on 3dassets.dev (too low-poly and boxy for the target look), Kenney/Quaternius car kits (stylised low-poly), and the Khronos *CarConcept* sample (a single concept car carrying Khronos logos). Sketchfab models need a login to download, so they were not used.
