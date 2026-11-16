// Where the interface is served from, and whether it is the shared copy.
//
// The normal build is served from the site root and talks to the mission and science services.
// The shared copy (NEXT_PUBLIC_STATIC=1) is published as plain files under a sub-folder with no server
// behind it: the mission service runs in the page, and the science service's answers are saved files.

/** Path the site is served under ("" at the root). Prefix it to every address the code writes by hand. */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** True in the shared copy published as plain files. */
export const STATIC = process.env.NEXT_PUBLIC_STATIC === "1";
