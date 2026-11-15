# Data provenance registry

Every dataset the project reads, what it is used for, and how it is reached. All were retrieved on
14 November 2026 without a login. Per-region read records (exact scenes, tiles, windows, retrieval time)
are saved beside the data in `data/patches/<body>/<region>.json` and `data/jezero/terrain.json`.

"Role" says how the data may be used: **measurement** means numbers are computed from it; **image** means
it is only looked at (by people or by the network), never used as a number.

## Mars

| Dataset | Mission / instrument | Resolution | Role | Used for | Access | Reference |
|---|---|---|---|---|---|---|
| MOLA MEGDR topography, 128 px/deg (`MGS-M-MOLA-5-MEGDR-L3-V1.0`) | Mars Global Surveyor / MOLA | 463 m | measurement | Terrain attributes of every Mars cell | HTTP range reads of the PDS tiles at `pds-geosciences.wustl.edu` | Smith et al. (2001) JGR 106, 23689, doi:10.1029/2000JE001364 |
| THEMIS daytime infrared controlled mosaic | 2001 Mars Odyssey / THEMIS | 100 m | image | Network input for Mars cells; global thermal map layer | NASA Solar System Treks WMTS, layer `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | Edwards et al. (2011) JGR 116, E10008, doi:10.1029/2010JE003755 |
| THEMIS daytime infrared, MC-13 Syrtis Major | 2001 Mars Odyssey / THEMIS | 100 m | image | Thermal layer of the mission area (relative brightness, not a temperature) | USGS Astrogeology cloud-optimised GeoTIFF | doi:10.5066/P96FA04Z |
| Mars 2020 TRN CTX DTM mosaic, Jezero | Mars Reconnaissance Orbiter / CTX | 20 m | measurement | Elevation, slope and roughness of the mission area; all route planning | USGS Astrogeology; this build read a byte-identical local copy (SHA-256 in `terrain.json`) | doi:10.5066/P906QQT8 |
| CTX orthomosaic of Jezero | Mars Reconnaissance Orbiter / CTX | 6 m | image | Map imagery | NASA Treks WMTS, `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` | USGS Astrogeology |
| HiRISE orthomosaic of Jezero | Mars Reconnaissance Orbiter / HiRISE | 25 cm | image | Map imagery | NASA Treks WMTS, `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` | Fergason et al. (2020), doi:10.5066/P9QJDP48 |
| Viking colour mosaic (MDIM 2.1) | Viking Orbiters 1 and 2 | 232 m | image | Global context basemap | NASA Treks WMTS, `Mars_Viking_MDIM21_ClrMosaic_global_232m` | USGS Astrogeology |
| Perseverance traverse and waypoints | Mars 2020 | localised positions | measurement | Path overlay; validation of the elevation grid and the slope limit | `mars.nasa.gov/mmgis-maps/M20/Layers/json/` | NASA/JPL-Caltech |
| Perseverance raw images, left navigation camera | Mars 2020 / Navcam | browse images | image | Ground views near a selected point | `mars.nasa.gov/rss/api/?feed=raw_images`, searched by sol | NASA/JPL-Caltech |
| Surface radiation dose rate, 0.64 mSv per day | Mars Science Laboratory / RAD | one published value | measurement (published, not re-derived) | Crew radiation estimate | Entered from the paper, not downloaded; flagged for checking | Hassler et al. (2014) Science 343, 1244797 |

## Moon

| Dataset | Mission / instrument | Resolution | Role | Used for | Access | Reference |
|---|---|---|---|---|---|---|
| LOLA gridded radius, 64 px/deg (`LDEM_64`, `LRO-L-LOLA-4-GDR-V1.0`) | Lunar Reconnaissance Orbiter / LOLA | 474 m | measurement | Terrain attributes of every Moon cell | HTTP range reads at `pds-geosciences.wustl.edu` | Smith et al. (2010) Space Sci. Rev. 150, 209, doi:10.1007/s11214-009-9512-y |
| LROC Wide Angle Camera global mosaic | Lunar Reconnaissance Orbiter / LROC | 100 m | image | Network input for Moon cells; Moon map | NASA Treks WMTS, `LRO_WAC_Mosaic_Global_303ppd_v02` | Robinson et al. (2010) Space Sci. Rev. 150, 81, doi:10.1007/s11214-010-9634-2 |
| CLPS deliveries list | NASA Science web page | 15 entries | text, quoted | Lunar delivery browser | `science.nasa.gov/lunar-science/clps-deliveries`, page last updated 23 Oct 2026, read 14 Nov 2026; stored in `science/bel/clps.py` | NASA |

## Earth

| Dataset | Mission / instrument | Resolution | Role | Used for | Access | Reference |
|---|---|---|---|---|---|---|
| HLS L30 v2.0, band B04 (red) | Landsat 8 and 9 / OLI | 30 m | image | Network input for Earth cells | Microsoft Planetary Computer STAC with an anonymous read token (the home archive, LP DAAC, needs a login) | doi:10.5067/HLS/HLSL30.002 |
| NASADEM_HGT v001 | Shuttle Radar Topography Mission | 30 m | measurement | Terrain attributes of Earth cells below 60° N | OpenTopography public bucket | doi:10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001 |
| Copernicus DEM GLO-30 | TanDEM-X (ESA, not NASA) | 30 m | measurement | Terrain attributes for Iceland and Devon Island, where NASADEM has no coverage | AWS Open Data | doi:10.5270/ESA-c5d3d65 |
| NASA POWER monthly and annual, agroclimatology | MERRA-2, CERES/SRB | about 0.5° | measurement | Climate record at the Earth field site (Habitat step) | `power.larc.nasa.gov/api/temporal/monthly/point` | NASA Langley POWER project |

## Listed in the brief but not used

| Source | Why not |
|---|---|
| MOD13Q1 vegetation index, SMAP soil moisture | Earthdata login required; not needed for the result shown |
| NASA Open Science Data Repository, Human Research Program data | No crew physiology is modelled from data. Human datasets carry access restrictions that were not approached |
| HiRISE 1 m elevation model of Jezero | Available and tested as readable, but about 800 MB of transfer; the build machine was short of memory. Routes therefore use the 20 m CTX model |

## Things to know

- **Treks tiles are lossy display images.** They are never used as numbers.
- **HLS mosaics mix dates.** One Landsat pass covers part of a tile, so each Earth region combines the
  clearest scenes available; scene IDs and cloud cover are in each region's JSON.
- **Partial Earth regions.** Nine Earth regions kept fewer than 49 cells because clear imagery or land ran
  out: Corn Belt 5, Lanzarote 5, Bernese Alps 14, Channeled Scabland 22, Licancabur 39, Haughton 44,
  High Plains 46, Danakil 48, Uyuni 48.
- **Region list.** Coordinates and citations in `science/bel/sites.py` were typed from the AI model's
  knowledge. Jezero and Hadley were confirmed by eye; the rest need checking.
