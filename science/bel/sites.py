"""Sampling regions for the cross-planetary terrain dataset.

Each region is a named place with planetocentric latitude and east
longitude (degrees). A region is cut into a square grid of terrain cells;
all cells of one region always fall in the same train/validation/test fold,
so nearby (spatially correlated) cells can never leak between folds.

`processes` are documented geologic processes for the place, taken from the
cited literature. They are used only to label an analog as "geologically
supported"; they are never model inputs.

Earth entries are split into documented planetary analog sites (with a
citation) and control regions that nobody proposes as Mars or Moon analogs
(farmland, forest, glaciated mountains). The controls are what let us test
whether the model prefers real analogs over arbitrary Earth terrain.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Region:
    key: str
    name: str
    body: str
    lat: float
    lon: float                      # degrees east, -180..360 accepted
    processes: tuple[str, ...] = ()
    note: str = ""
    citation: str = ""
    analog_for: tuple[str, ...] = ()  # Earth only: "mars", "moon"
    control: bool = False             # Earth only: negative control region
    dem: str = "default"              # Earth only: "nasadem" (<=60 deg) or "cop30"
    extra: dict = field(default_factory=dict, compare=False)


# Process vocabulary (kept small on purpose).
VOLCANIC = "volcanic"          # lava plains, shields, cones
FLUVIAL = "fluvial"            # channels, valleys, deltas, fans
LACUSTRINE = "lacustrine"      # lake basins, playas, evaporites
AEOLIAN = "aeolian"            # dunes, yardangs, deflation
IMPACT = "impact"              # craters, ejecta, basins
TECTONIC = "tectonic"          # rifts, grabens, canyons
PERIGLACIAL = "periglacial"    # ground ice, patterned ground
HYDROTHERMAL = "hydrothermal"  # springs, altered deposits
OUTFLOW = "megaflood"          # catastrophic flood channels, chaos
BIOGENIC = "vegetated"         # vegetation / agriculture dominates the surface

MARS_REGIONS: tuple[Region, ...] = (
    Region("jezero", "Jezero Crater", "mars", 18.38, 77.58, (IMPACT, FLUVIAL, LACUSTRINE, VOLCANIC),
           "Delta and paleolake; Perseverance landing site",
           "Fassett & Head (2005) GRL 32, L14201; Mangold et al. (2021) Science 374, 711"),
    Region("gale", "Gale Crater", "mars", -5.4, 137.8, (IMPACT, LACUSTRINE, FLUVIAL, AEOLIAN),
           "Mount Sharp sediments; Curiosity landing site",
           "Grotzinger et al. (2014) Science 343, 1242777"),
    Region("gusev", "Gusev Crater", "mars", -14.5, 175.4, (IMPACT, VOLCANIC, FLUVIAL),
           "Basaltic plains and Columbia Hills; Spirit landing site",
           "Squyres et al. (2004) Science 305, 794"),
    Region("meridiani", "Meridiani Planum", "mars", -2.0, 354.5, (AEOLIAN, LACUSTRINE),
           "Sulfate-rich sandstones and hematite plains; Opportunity landing site",
           "Squyres et al. (2004) Science 306, 1698"),
    Region("elysium_insight", "Elysium Planitia (InSight)", "mars", 4.5, 135.6, (VOLCANIC, IMPACT),
           "Smooth lava plains; InSight landing site", "Golombek et al. (2020) Nat. Commun. 11, 1014"),
    Region("chryse", "Chryse Planitia (Viking 1)", "mars", 22.5, 312.0, (OUTFLOW, VOLCANIC),
           "Outflow channel deposits", "Golombek et al. (1997) Science 278, 1743"),
    Region("utopia", "Utopia Planitia (Viking 2)", "mars", 47.6, 134.3, (PERIGLACIAL, IMPACT),
           "Northern plains with ground ice", "Stuurman et al. (2016) GRL 43, 9484"),
    Region("ares", "Ares Vallis (Pathfinder)", "mars", 19.1, 326.7, (OUTFLOW,),
           "Catastrophic flood channel mouth", "Golombek et al. (1997) Science 278, 1743"),
    Region("mawrth", "Mawrth Vallis", "mars", 22.3, 343.5, (FLUVIAL, OUTFLOW),
           "Phyllosilicate-rich layered terrain", "Bibring et al. (2006) Science 312, 400"),
    Region("nili", "Nili Fossae", "mars", 21.0, 74.5, (TECTONIC, VOLCANIC, HYDROTHERMAL),
           "Grabens with olivine and carbonate", "Ehlmann et al. (2008) Science 322, 1828"),
    Region("melas", "Melas Chasma (Valles Marineris)", "mars", -10.4, 287.5, (TECTONIC, FLUVIAL),
           "Canyon floor and walls", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("candor", "Candor Chasma", "mars", -6.6, 289.2, (TECTONIC, LACUSTRINE),
           "Layered sulfate deposits in a canyon", "Murchie et al. (2009) JGR 114, E00D05"),
    Region("noctis", "Noctis Labyrinthus", "mars", -7.0, 259.0, (TECTONIC, VOLCANIC),
           "Maze of grabens and pits", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("arsia", "Arsia Mons flank", "mars", -8.3, 239.9, (VOLCANIC,),
           "Shield volcano with lava flows and pit chains", "Plescia (2004) JGR 109, E03003"),
    Region("olympus", "Olympus Mons", "mars", 18.65, 226.2, (VOLCANIC,),
           "Largest shield volcano", "Plescia (2004) JGR 109, E03003"),
    Region("ascraeus", "Ascraeus Mons", "mars", 11.9, 255.9, (VOLCANIC,),
           "Shield volcano", "Plescia (2004) JGR 109, E03003"),
    Region("hellas", "Hellas Planitia floor", "mars", -42.0, 70.0, (IMPACT, PERIGLACIAL),
           "Deep impact basin floor", "Tanaka & Leonard (1995) JGR 100, 5407"),
    Region("arabia", "Arabia Terra", "mars", 20.0, 5.0, (IMPACT, AEOLIAN),
           "Heavily cratered, layered highlands", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("sabaea", "Terra Sabaea", "mars", 2.0, 42.0, (IMPACT, FLUVIAL),
           "Cratered highlands with valley networks", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("noachis", "Noachis Terra (north)", "mars", -35.0, 350.0, (IMPACT,),
           "Type area of the oldest cratered highlands", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("amazonis", "Amazonis Planitia", "mars", 25.0, 196.0, (VOLCANIC,),
           "Among the smoothest plains on Mars", "Fuller & Head (2002) JGR 107, 5081"),
    Region("isidis", "Isidis Planitia", "mars", 13.0, 88.0, (IMPACT, VOLCANIC),
           "Basin plains with cone chains", "Ivanov et al. (2012) Icarus 218, 24"),
    Region("medusae", "Medusae Fossae Formation", "mars", -3.0, 197.0, (AEOLIAN, VOLCANIC),
           "Wind-carved friable deposits (yardangs)", "Bradley et al. (2002) JGR 107, 5058"),
    Region("eberswalde", "Eberswalde Crater", "mars", -24.0, 326.7, (FLUVIAL, LACUSTRINE, IMPACT),
           "Preserved river delta", "Malin & Edgett (2003) Science 302, 1931"),
    Region("nirgal", "Nirgal Vallis", "mars", -28.4, 318.0, (FLUVIAL,),
           "Long sapping / runoff valley", "Baker (1982) The Channels of Mars"),
    Region("kasei", "Kasei Valles", "mars", 24.6, 294.0, (OUTFLOW,),
           "Largest outflow channel system", "Baker (1982) The Channels of Mars"),
    Region("athabasca", "Athabasca Valles", "mars", 8.6, 155.0, (OUTFLOW, VOLCANIC),
           "Young flood channel draped by lava", "Jaeger et al. (2007) Science 317, 1709"),
    Region("aram", "Aram Chaos", "mars", 2.6, 338.6, (OUTFLOW, LACUSTRINE),
           "Chaos terrain in an old crater", "Glotch & Christensen (2005) JGR 110, E09006"),
    Region("cimmeria", "Terra Cimmeria", "mars", -35.0, 145.0, (IMPACT, FLUVIAL),
           "Cratered highlands with gullies", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("sirenum", "Terra Sirenum", "mars", -40.0, 210.0, (IMPACT, TECTONIC),
           "Cratered highlands with grabens", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("hesperia", "Hesperia Planum", "mars", -22.0, 110.0, (VOLCANIC, TECTONIC),
           "Ridged volcanic plains", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("lunae", "Lunae Planum", "mars", 10.0, 294.0, (VOLCANIC, TECTONIC),
           "Ridged plains", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("syria", "Syria Planum", "mars", -12.0, 256.0, (VOLCANIC,),
           "High volcanic plateau with small shields", "Baptista et al. (2008) JGR 113, E09010"),
    Region("acidalia", "Acidalia Planitia", "mars", 45.0, 338.0, (PERIGLACIAL, OUTFLOW),
           "Northern plains with mounds and polygons", "Tanaka et al. (2014) USGS SIM 3292"),
    Region("daedalia", "Daedalia Planum", "mars", -21.8, 232.0, (VOLCANIC,),
           "Long lava flow field", "Giacomini et al. (2009) Planet. Space Sci. 57, 556"),
    Region("tempe", "Tempe Terra", "mars", 40.0, 289.0, (TECTONIC, VOLCANIC),
           "Rifted volcanic highlands", "Hauber & Kronberg (2001) JGR 106, 20587"),
    Region("elysium_mons", "Elysium Mons", "mars", 25.0, 147.2, (VOLCANIC,),
           "Shield volcano", "Plescia (2004) JGR 109, E03003"),
    Region("hadriacus", "Hadriacus Mons / Dao Vallis", "mars", -32.1, 91.8, (VOLCANIC, FLUVIAL),
           "Old low volcano cut by channels", "Crown & Greeley (1993) JGR 98, 3431"),
    Region("oxia", "Oxia Planum", "mars", 18.2, 335.5, (FLUVIAL, LACUSTRINE),
           "Clay-bearing plains; Rosalind Franklin landing site", "Quantin-Nataf et al. (2021) Astrobiology 21, 345"),
)

MOON_REGIONS: tuple[Region, ...] = (
    Region("apollo11", "Mare Tranquillitatis (Apollo 11)", "moon", 0.67, 23.47, (VOLCANIC, IMPACT), "Mare basalt plain"),
    Region("apollo12", "Oceanus Procellarum (Apollo 12)", "moon", -3.01, 336.58, (VOLCANIC, IMPACT), "Mare basalt plain"),
    Region("apollo14", "Fra Mauro (Apollo 14)", "moon", -3.65, 342.53, (IMPACT,), "Imbrium ejecta hills"),
    Region("apollo15", "Hadley-Apennine (Apollo 15)", "moon", 26.13, 3.63, (VOLCANIC, IMPACT), "Sinuous rille at a basin rim"),
    Region("apollo16", "Descartes Highlands (Apollo 16)", "moon", -8.97, 15.5, (IMPACT,), "Central highlands"),
    Region("apollo17", "Taurus-Littrow (Apollo 17)", "moon", 20.19, 30.77, (VOLCANIC, IMPACT, TECTONIC), "Mare-filled valley between massifs"),
    Region("copernicus", "Copernicus Crater", "moon", 9.62, 339.92, (IMPACT,), "Young complex crater with rays"),
    Region("tycho", "Tycho Crater", "moon", -43.3, 348.8, (IMPACT,), "Young complex crater"),
    Region("aristarchus", "Aristarchus Plateau", "moon", 25.0, 311.0, (VOLCANIC, IMPACT), "Pyroclastic plateau and Vallis Schroteri"),
    Region("imbrium", "Mare Imbrium", "moon", 35.0, 343.0, (VOLCANIC,), "Mare lava flows"),
    Region("serenitatis", "Mare Serenitatis", "moon", 28.0, 17.5, (VOLCANIC, TECTONIC), "Mare with wrinkle ridges"),
    Region("crisium", "Mare Crisium (Blue Ghost Mission 1)", "moon", 18.56, 61.81, (VOLCANIC, IMPACT), "Mare inside an impact basin"),
    Region("orientale", "Orientale Basin", "moon", -19.4, 267.2, (IMPACT,), "Multi-ring basin"),
    Region("apollo_basin", "Apollo Basin (South Pole-Aitken)", "moon", -36.0, 208.0, (IMPACT, VOLCANIC), "Basin inside SPA"),
    Region("korolev", "Korolev (far-side highlands)", "moon", -4.0, 202.6, (IMPACT,), "Saturated cratered highlands"),
    Region("tsiolkovskiy", "Tsiolkovskiy Crater", "moon", -20.4, 129.1, (IMPACT, VOLCANIC), "Mare-floored far-side crater"),
    Region("reiner", "Reiner Gamma", "moon", 7.5, 301.0, (VOLCANIC,), "Lunar swirl on mare"),
    Region("marius", "Marius Hills", "moon", 13.3, 306.8, (VOLCANIC,), "Volcanic dome and cone field"),
    Region("nectaris", "Mare Nectaris", "moon", -15.0, 35.0, (VOLCANIC, IMPACT), "Small circular mare"),
    Region("humboldt", "Humboldt Crater", "moon", -27.0, 81.0, (IMPACT, TECTONIC), "Floor-fractured crater"),
    Region("hertzsprung", "Hertzsprung Basin", "moon", 2.0, 231.0, (IMPACT,), "Far-side peak-ring basin"),
    Region("moscoviense", "Mare Moscoviense", "moon", 27.0, 148.0, (VOLCANIC, IMPACT), "Far-side mare"),
    Region("gruithuisen", "Gruithuisen Domes", "moon", 36.5, 320.0, (VOLCANIC,), "Silicic volcanic domes"),
    Region("procellarum", "Oceanus Procellarum (central)", "moon", 18.0, 303.0, (VOLCANIC,), "Young mare flows"),
    Region("ptolemaeus", "Ptolemaeus", "moon", -9.2, 358.2, (IMPACT,), "Old flat-floored crater in highlands"),
    Region("mendeleev", "Mendeleev Basin", "moon", 5.7, 140.9, (IMPACT,), "Far-side basin with crater chain"),
    Region("albategnius", "Albategnius Highlands", "moon", -11.2, 4.1, (IMPACT,), "Central near-side highlands"),
    Region("vaporum", "Mare Vaporum", "moon", 13.3, 3.6, (VOLCANIC, IMPACT), "Small mare south of the Apennines"),
)

_MOON_CITE = "Wilhelms (1987) The Geologic History of the Moon, USGS Prof. Paper 1348"
MOON_REGIONS = tuple(
    Region(r.key, r.name, r.body, r.lat, r.lon, r.processes, r.note, r.citation or _MOON_CITE) for r in MOON_REGIONS
)

EARTH_REGIONS: tuple[Region, ...] = (
    # --- Documented planetary analog sites ---------------------------------
    Region("atacama", "Atacama Desert (Yungay), Chile", "earth", -24.1, -69.9, (LACUSTRINE, AEOLIAN, FLUVIAL),
           "Hyperarid soils with Mars-like low organics",
           "Navarro-Gonzalez et al. (2003) Science 302, 1018", analog_for=("mars",)),
    Region("uyuni", "Salar de Uyuni, Bolivia", "earth", -20.1, -67.5, (LACUSTRINE,),
           "World's largest salt flat; evaporite basin analog",
           "Cabrol et al. (2009) JGR 114, G00D06", analog_for=("mars",)),
    Region("death_valley", "Death Valley, California", "earth", 36.3, -116.9, (LACUSTRINE, FLUVIAL, TECTONIC, AEOLIAN),
           "Alluvial fans, playas and evaporites; long-used Mars field site",
           "Farr (2004) Planet. Space Sci. 52, 3", analog_for=("mars",)),
    Region("mojave", "Mojave volcanic fields (Cima / Amboy), California", "earth", 34.9, -115.8, (VOLCANIC, AEOLIAN),
           "Basaltic cones and flows with desert pavement",
           "Farr (2004) Planet. Space Sci. 52, 3", analog_for=("mars", "moon")),
    Region("hanksville", "Hanksville / Mars Desert Research Station, Utah", "earth", 38.41, -110.79, (FLUVIAL, LACUSTRINE, AEOLIAN),
           "Inverted river channels and clay-rich badlands",
           "Clarke & Stoker (2011) Int. J. Astrobiol. 10, 161", analog_for=("mars",)),
    Region("sfvf", "San Francisco Volcanic Field and Meteor Crater, Arizona", "earth", 35.4, -111.5, (VOLCANIC, IMPACT),
           "Apollo geology training ground; NASA Desert RATS field tests",
           "Ross et al. (2013) Acta Astronaut. 90, 182", analog_for=("mars", "moon")),
    Region("craters_moon", "Craters of the Moon, Idaho", "earth", 43.4, -113.5, (VOLCANIC, TECTONIC),
           "Basaltic rift lava field; NASA FINESSE and BASALT field sites",
           "Lim et al. (2019) Astrobiology 19, 245", analog_for=("mars", "moon")),
    Region("hawaii", "Mauna Kea / Mauna Loa, Hawaii", "earth", 19.6, -155.5, (VOLCANIC,),
           "Basaltic shields; HI-SEAS habitat and BASALT field site",
           "Lim et al. (2019) Astrobiology 19, 245", analog_for=("mars", "moon")),
    Region("iceland", "Icelandic Highlands (Askja / Dyngjusandur)", "earth", 65.0, -16.7, (VOLCANIC, FLUVIAL, AEOLIAN),
           "Basaltic sand plains and lava; olivine-sorting sands studied as a Mars analog",
           "Mangold et al. (2011) Earth Planet. Sci. Lett. 310, 233", analog_for=("mars", "moon"), dem="cop30"),
    Region("haughton", "Haughton Impact Structure, Devon Island", "earth", 75.4, -89.7, (IMPACT, PERIGLACIAL),
           "Polar desert impact crater; Haughton-Mars Project",
           "Lee & Osinski (2005) Meteorit. Planet. Sci. 40, 1755", analog_for=("mars", "moon"), dem="cop30"),
    Region("pilbara", "Pilbara Craton, Western Australia", "earth", -21.2, 119.3, (VOLCANIC, FLUVIAL),
           "3.5-billion-year-old stromatolite terrain; biosignature analog",
           "Van Kranendonk et al. (2008) Precambrian Res. 167, 93", analog_for=("mars",)),
    Region("rio_tinto", "Rio Tinto, Spain", "earth", 37.7, -6.55, (HYDROTHERMAL, FLUVIAL),
           "Acidic iron-sulfate river system; Meridiani analog",
           "Fernandez-Remolar et al. (2005) Earth Planet. Sci. Lett. 240, 149", analog_for=("mars",)),
    Region("namib", "Namib Sand Sea, Namibia", "earth", -24.7, 15.3, (AEOLIAN,),
           "Large linear dune field; dune-morphology comparison",
           "Lancaster (1989) The Namib Sand Sea, Balkema", analog_for=("mars",)),
    Region("white_sands", "White Sands, New Mexico", "earth", 32.8, -106.3, (AEOLIAN, LACUSTRINE),
           "Gypsum dune field; analog for sulfate dunes",
           "Szynkiewicz et al. (2010) Geomorphology 121, 69", analog_for=("mars",)),
    Region("lonar", "Lonar Crater, India", "earth", 19.98, 76.51, (IMPACT, VOLCANIC),
           "Impact crater in basalt",
           "Fredriksson et al. (1973) Science 180, 862", analog_for=("mars", "moon")),
    Region("danakil", "Dallol / Danakil Depression, Ethiopia", "earth", 14.2, 40.3, (HYDROTHERMAL, LACUSTRINE, VOLCANIC),
           "Hydrothermal evaporite system",
           "Cavalazzi et al. (2019) Astrobiology 19, 553", analog_for=("mars",)),
    Region("qaidam", "Qaidam Basin, Tibetan Plateau", "earth", 38.0, 91.5, (AEOLIAN, LACUSTRINE),
           "Cold hyperarid basin with yardangs and evaporites",
           "Xiao et al. (2017) Earth-Sci. Rev. 164, 84", analog_for=("mars",)),
    Region("lut", "Lut Desert yardangs, Iran", "earth", 30.5, 58.0, (AEOLIAN,),
           "Mega-yardang field; analog for Medusae Fossae",
           "Ehsani & Quiel (2008) Remote Sens. Environ. 112, 3284", analog_for=("mars",)),
    Region("tibesti", "Emi Koussi, Tibesti, Chad", "earth", 19.8, 18.5, (VOLCANIC,),
           "Shield volcano compared with Elysium Mons",
           "Malin (1977) Geol. Soc. Am. Bull. 88, 908", analog_for=("mars",)),
    Region("scabland", "Channeled Scabland, Washington", "earth", 47.4, -118.5, (OUTFLOW,),
           "Megaflood-carved basalt; analog for Martian outflow channels",
           "Baker & Milton (1974) Icarus 23, 27", analog_for=("mars",)),
    Region("licancabur", "Licancabur / Altiplano lakes, Chile-Bolivia", "earth", -22.8, -67.8, (VOLCANIC, LACUSTRINE),
           "High-altitude volcanic lakes under strong UV",
           "Cabrol et al. (2009) JGR 114, G00D06", analog_for=("mars",)),
    Region("lanzarote", "Lanzarote, Canary Islands", "earth", 29.0, -13.7, (VOLCANIC,),
           "Basaltic volcanic field; ESA PANGAEA astronaut training",
           "ESA PANGAEA astronaut geology training programme", analog_for=("mars", "moon")),
    Region("grand_canyon", "Grand Canyon, Arizona", "earth", 36.1, -112.1, (FLUVIAL, TECTONIC),
           "Canyon morphology often compared with Valles Marineris (different origin)",
           "Morphological comparison only; no formation analogy claimed", analog_for=("mars",)),
    # --- Negative controls: not proposed as planetary analogs --------------
    Region("corn_belt", "Corn Belt, central Illinois", "earth", 40.1, -88.9, (BIOGENIC,),
           "Row-crop farmland on glacial till", control=True),
    Region("ozarks", "Ozark forest, Missouri", "earth", 37.3, -91.0, (BIOGENIC, FLUVIAL),
           "Forested dissected plateau", control=True),
    Region("appalachian", "Ridge and Valley, Pennsylvania", "earth", 40.8, -77.5, (BIOGENIC, TECTONIC),
           "Forested fold belt", control=True),
    Region("alps", "Bernese Alps, Switzerland", "earth", 46.5, 8.0, (BIOGENIC,),
           "Glaciated high mountains", control=True),
    Region("ganges", "Ganges Plain, India", "earth", 26.5, 81.0, (BIOGENIC, FLUVIAL),
           "Intensively farmed alluvial plain", control=True),
    Region("kansas", "High Plains, Kansas", "earth", 38.5, -99.0, (BIOGENIC,),
           "Rangeland and irrigated farmland", control=True),
)

ALL_REGIONS: tuple[Region, ...] = MARS_REGIONS + MOON_REGIONS + EARTH_REGIONS
REGION_BY_KEY = {f"{r.body}:{r.key}": r for r in ALL_REGIONS}


def regions_for(body: str) -> tuple[Region, ...]:
    return tuple(r for r in ALL_REGIONS if r.body == body)
