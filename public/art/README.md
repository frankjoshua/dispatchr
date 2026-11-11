# Art

Sprites and textures for the map, generated for dispatchr with OpenAI's gpt-image (neon and farm
2026-10-06, lab and cubicles 2026-10-07 with gpt-image-2), then trimmed to their alpha, scaled and saved
as WebP. Textures (`*_floor`, `*_wall`, `*_grass`, `*_soil`, `l_mat`, `c_carpet`, `c_tile`) are made
seamless by blending each with a half-offset copy of itself.

| prefix | theme | used for |
|---|---|---|
| `n_` | Neon city | robots per agent kind (`n_robot_<kind>`), the computer's data core, holo-trees, street lamps, drones, floor and wall textures |
| `f_` | Farm | farmers per agent kind (`f_farmer_<kind>`), scarecrow, barn, crops (corn, sunflower, wheat, sprout, withered), apple trees, hay, chickens, mailbox, coin, grass and soil textures |
| `l_` | Lab | scientists per agent kind in three poses (`l_sci_<kind>`, `_rest`, `_alarm`), coat stand, bioreactor, stackable lab modules, still, hot plate, beacons, intercom, reagent drop, test-tube rack, plants, gas cylinders, carts, microscope tables, boxes, bins, extinguishers, lab mouse, floor and mat textures |
| `c_` | Cubicles | office workers per agent kind standing and waving (`c_worker_<kind>`, `c_wave_<kind>`), effort postures (`c_pose_<kind>_<desk\|walk>_<0..3>`), chair with a jacket, the copier corner, cubicle walls, desk, paperwork blocks (paper, folders, binders, box), red flag, letter tray, folder, desk phone, banknote, plants, coolers, vending machine, bins, coat stands, office cat, carpet and carpet-tile textures |

Sprites are drawn standing on their bottom-centre point (`src/sprites.ts`). Agent kinds without
their own art use the `omp` variant. Until an image has loaded the map draws the same thing with
shapes, so missing art never blocks the view.

## Cubicles effort postures

`c_pose_<kind>_<situation>_<tier>.webp` contains the existing human cast (`omp`, `claude`, `codex`,
`pi`), with `desk` standing beside the desk and `walk` mid-stride. Tiers `0`–`3` progress from upright
attention to a deeper focused lean; they do not change the character's outfit, equipment or gait speed.
These are posture choices, not animation frames.

`c_effort_<0..3>.webp` is the persistent four-slot desk block: a fixed 48×112 transparent housing
with one through four filled ivory segments. It stays beside the desk, never on the character.

The posture atlases were generated with gpt-image-2 on 2026-10-23 using the existing
`c_worker_<kind>` sprites as identity references. Blue and orange studies supply OMP and Claude;
Codex and Pi use new
four-column, two-row atlases preserving their green-hoodie/laptop and purple-sweater/tablet/headset
identities. Full source atlases and inspection contact sheets stay outside the repository.

All production poses face screen-left unmirrored, like `c_worker_*`; the right-facing blue/orange
studies were mirrored. Each character uses one shared symmetric crop and scale across its eight
poses, anchored at bottom-centre with the feet on the last pixel row, preserving the natural lean.
The studies use feet x=128, crop bottom y=305 and the minimum alpha-bound top across all eight poses,
removing their transparent foot gap. Disconnected generation specks are removed without trimming the
character's edge, alpha values ≥250 are snapped to 255, and the final transparent WebPs are lossless
and contain no metadata.
