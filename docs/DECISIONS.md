# Engineering decisions

Each entry records a choice, the measurement or fact behind it, and what it costs.

## D1. One common scale for the cross-planetary dataset: 11.2 km cells

- Images at 100 m per pixel (112 x 112), elevation at 467 m per cell (24 x 24).
- Why: 100 m is the native resolution of the two global mosaics (THEMIS on Mars, LROC WAC on the Moon),
  and 463 m / 474 m are the native resolutions of the official MOLA and LOLA gridded products. Earth data
  (HLS 30 m, NASADEM 30 m) is averaged down to match.
- Slope depends on the baseline it is measured over, so elevation is brought to the same cell size on all
  three bodies before any slope is computed.
- Cost: this is a regional scale. It says which kind of terrain a place is, not where a boulder is.
  Route safety on the Jezero map uses measured metre-scale elevation instead, not this model.

## D2. Mars images are thermal infrared; Earth and Moon images are visible light

- THEMIS daytime infrared is the only global 100 m Mars mosaic. In daytime it is dominated by sunlit and
  shaded slopes, so it shows landforms, but it is not the same kind of measurement as a visible image.
- This is a real domain shift and is treated as one: experiment E2 trains without any Mars labels and
  reports what transfers, and E5 measures how separable the bodies are in feature space.
- Each cell image is stretched between its own 1st and 99th percentiles, because the three sensors'
  brightness scales are unrelated. The model therefore cannot use a cell's overall contrast.

## D3. Imagery from NASA Trek tiles, elevation from PDS numeric grids

- Measured: reading one 78 km region from the USGS global THEMIS GeoTIFF took 255 s and from the LROC WAC
  GeoTIFF 120 s, because both files are stored in full-width strips. The same region from NASA Trek tiles
  took 3.2 s and 1.0 s.
- Trek tiles are lossy display images. They are used only as image inputs. Every elevation number comes
  from a numeric product (MOLA MEGDR, LOLA GDR, NASADEM, CTX and HiRISE elevation models).

## D4. Earth imagery: NASA HLS from a public mirror

- HLS L30 (Landsat 8/9, 30 m) is a NASA product. Its home archive (LP DAAC) needs an Earthdata login.
  The same product is on Microsoft's Planetary Computer with an anonymous read token, so that mirror is
  used. No access control is bypassed.
- One Landsat pass covers only part of an HLS tile, so several clear dates are combined per region.

## D5. Elevation above 60 degrees north: Copernicus GLO-30 instead of NASADEM

- NASADEM (from the Shuttle Radar Topography Mission) stops at 60 N. Iceland and Devon Island are
  important analog sites, so those two regions use the ESA Copernicus DEM and are labelled as such.

## D6. Frozen backbone, trained head

- The build machine has 7.4 GB of memory and no GPU. Fine-tuning a vision transformer is not feasible
  there, so DINOv2 ViT-S/14 stays frozen and a small head is trained on cached features.
- Cost: the backbone cannot adapt to planetary imagery. The linear-probe baseline (E1-E3, `dino_ridge`)
  shows how much of the result comes from the head rather than from DINOv2 itself.

## D7. No PostGIS on the build machine

- The portable PostgreSQL 18 available here has no PostGIS extension, and Docker is not installed.
- Plan: the schema enables PostGIS when the extension is available and otherwise stores coordinates as
  plain longitude/latitude columns plus GeoJSON. Spatial work that matters (grids, routes) is done on
  metric local grids in the services, not in SQL.

## D8. Removing the input LayerNorm from the head

- Measured on a linear synthetic problem: with a LayerNorm on the input the head reached R2 0.89 where
  ridge regression reached 0.985; without it the head reached 0.995. A per-sample LayerNorm discards the
  sample's overall magnitude, and the inputs are already standardised per dimension.

## D9. Per-body feature normalisation is part of the model

- Measured (experiment E2): trained on Earth and the Moon and tested on Mars, the head scores R2 0.05
  without it and 0.42 with it. A linear classifier can tell the bodies apart from raw DINOv2 features
  95.5% of the time.
- It uses each body's images and no labels, so it is legitimate unsupervised adaptation. In the
  held-out-region experiments the statistics are fitted on training regions only.
- Cost: a new body needs a few hundred images before the model can be applied to it.

## D10. The terrain model is not used for route costs

- The model is validated at an 11 km scale against 467 m elevation. Routes are planned on 20 m cells.
  Nothing measured supports using the model at that scale, so routes use measured slope only.
- The brief asks for the model's terrain intelligence in navigation "where supported by validation".
  It is not supported, and the interface says so.

## D11. Slope limit from the real rover

- Perseverance's published path never crosses a 20 m cell steeper than 18.3 degrees, while 1.7% of the
  mission area is steeper than 20. The two rover profiles therefore use a 20 degree limit.
- Cost: this is a statement about 20 m baselines. A rover can meet steeper ground within a cell.

## D12. The browser drives the clock; the mission service computes every step

- The interface calls `sim/step` four times a second with the amount of mission time to advance. All
  movement, consumption, margin checks and replanning happen in the Go service.
- Cost: closing the browser pauses the mission.

## D13. Missions are stored as JSON files

- No PostGIS on the build machine (D7) and little time. Each mission is written to `data/missions/`
  after every command. It is a record, not a resumable session: a restarted service does not reload them.

## D14. Imagery is proxied and reprojected on demand

- NASA Treks serves equirectangular tiles; MapLibre needs Web Mercator. The science service resamples
  on request and caches the result, so no mosaic is stored and any Treks layer can be added in one line.
- Cost: the first view of an area waits on NASA's servers, and the build once saw Treks stop answering
  for about an hour after roughly 1,700 tile requests.

## D15. CLPS information is quoted, not summarised

- The lunar delivery list stores NASA's own sentence for each of the 15 entries on its CLPS Deliveries
  page (last updated 23 October 2026), with the date it was read. Nothing is added from other sources:
  secondary lists were found but not checked, and a status can change after the page was read.
- NASA's page gives no coordinates, so no landing point is drawn. Four deliveries name a site that lies in
  a lunar region this build has measured; that link is ours and is labelled with its basis.

## D16. Ground views come from the nearest rover stop

- Perseverance's waypoints carry the sol of each stop, and the raw-image feed is searchable by sol. A
  clicked point is matched to the nearest stop within 600 m and shown that sol's navigation-camera frames.
- Cost: the frames are from the stop, not the point, and the camera's compass heading is not worked out,
  so the panel says so and claims no viewing direction.

## D17. The mission score

- Science 60, safety 25, efficiency 15. The weights are this project's choice and are shown on screen.
  Safety is full only if the reserve was never needed.
- Cost: on a grid, a detour around a small obstacle can cost no extra distance, so efficiency is often
  unchanged by one replan.
