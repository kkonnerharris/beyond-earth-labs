"""NASA Commercial Lunar Payload Services (CLPS) deliveries, as NASA lists them.

Every `nasa_text` below is quoted from NASA's CLPS Deliveries page:
    https://science.nasa.gov/lunar-science/clps-deliveries
read on 2026-11-14; the page says "Page Last Updated: Oct 23, 2026".

Nothing is added from other sources. The page gives no coordinates, so no
landing point is plotted. Where NASA names a site that lies inside one of
this project's lunar terrain regions, `region` links the delivery to that
region so its measured terrain and Earth analogs can be looked up. That
link is ours, not NASA's, and `region_basis` says why it was made.
"""
from __future__ import annotations

SOURCE = {
    "title": "Commercial Lunar Payload Services (CLPS) Deliveries",
    "publisher": "NASA Science",
    "url": "https://science.nasa.gov/lunar-science/clps-deliveries",
    "page_last_updated": "Oct 23, 2026",
    "read_on": "2026-11-14",
}

# tense: "past" where NASA's sentence is in the past tense, "planned" where it says "will".
DELIVERIES = [
    {"id": "TO2-AB", "tense": "past",
     "nasa_text": "Astrobotic's Peregrine lunar lander launched on January 8, 2024 to deliver 5 NASA CLPS science payloads to Sinus Viscositatis. It did not land.",
     "site": "Sinus Viscositatis", "region": "moon:gruithuisen",
     "region_basis": "Sinus Viscositatis is the mare embayment beside the Gruithuisen Domes, inside this 78 km region."},
    {"id": "TO2-IM", "tense": "past",
     "nasa_text": "Intuitive Machines's Nova-C lunar lander launched on February 15, 2024 to deliver 6 NASA CLPS science payloads to Malapert A. It landed on February 22, 2024.",
     "site": "Malapert A", "region": None},
    {"id": "TO19D", "tense": "past",
     "nasa_text": "Firefly's Blue Ghost 1 lunar lander delivered 10 NASA CLPS science payloads to Mare Crisium.",
     "site": "Mare Crisium", "region": "moon:crisium",
     "region_basis": "This region is centred in Mare Crisium."},
    {"id": "TO20A", "tense": "planned",
     "nasa_text": "Astrobotic's Griffin lander will perform a delivery test to Mons Mouton at the lunar south pole in 2025.",
     "site": "Mons Mouton", "region": None},
    {"id": "PRIME-1", "tense": "past",
     "nasa_text": "Intuitive Machines' Nova-C lander delivered three NASA CLPS science payloads to lunar south pole.",
     "site": "Lunar south pole", "region": None},
    {"id": "CP-11", "tense": "planned",
     "nasa_text": "Intuitive Machines' Nova-C lander will deliver four NASA CLPS science payloads to Reiner Gamma on the lunar nearside.",
     "site": "Reiner Gamma", "region": "moon:reiner",
     "region_basis": "This region is centred on Reiner Gamma."},
    {"id": "CS-11", "tense": "planned",
     "nasa_text": "A lunar lander to be determined will deliver three NASA CLPS payloads to Schrödinger Basin.",
     "site": "Schrödinger Basin", "region": None},
    {"id": "CS-3/4", "tense": "planned",
     "nasa_text": "Firefly's Blue Ghost 2 lander will deliver three NASA CLPS science payloads to the lunar far side.",
     "site": "Lunar far side", "region": None},
    {"id": "CP-21", "tense": "planned",
     "nasa_text": "Firefly's Blue Ghost 3 lander will deliver six NASA CLPS science payloads to the Gruithuisen Domes.",
     "site": "Gruithuisen Domes", "region": "moon:gruithuisen",
     "region_basis": "This region is centred on the Gruithuisen Domes."},
    {"id": "CP-22", "tense": "planned",
     "nasa_text": "The Intuitive Machines Nova-C lander will deliver six NASA CLPS science payloads to Mons Mouton.",
     "site": "Mons Mouton", "region": None},
    {"id": "CT-3", "tense": "planned",
     "nasa_text": "Blue Origin’s Blue Moon Mark 1 (MK1) lander will deliver two NASA CLPS science payloads to the lunar South Pole.",
     "site": "Lunar south pole", "region": None},
    {"id": "CS-6", "tense": "planned",
     "nasa_text": "The Firefly Blue Ghost Mission 4 lander will deliver four NASA CLPS science payloads to the lunar south pole.",
     "site": "Lunar south pole", "region": None},
    {"id": "CT-4", "tense": "planned",
     "nasa_text": "The Intuitive Machines Nova-D lander will deliver six NASA CLPS science payloads to the lunar south pole.",
     "site": "Lunar south pole", "region": None},
    {"id": "CS-8", "tense": "planned",
     "nasa_text": "CS-8 will deliver Moon Base payloads to the lunar surface.",
     "site": None, "region": None},
    {"id": "CX-2", "tense": "planned",
     "nasa_text": "CX-2 will deliver one or more Lunar Terrain Vehicles to support the development of NASA’s Moon Base to the lunar surface.",
     "site": None, "region": None},
]

NO_REGION_NOTE = ("Polar and far-side sites are outside this build's lunar terrain regions, which lie between "
                  "about 45 degrees south and 37 degrees north where the mosaics it uses are well lit.")


def listing() -> dict:
    return {"source": SOURCE, "deliveries": DELIVERIES, "kind": "observation",
            "note": ("Text is quoted from NASA's page as it read on the date shown; a status may have changed since. "
                     "NASA's page gives no coordinates, so no landing point is plotted. " + NO_REGION_NOTE)}
