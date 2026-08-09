# 08 — Kerb collision: rim strikes, mounting, overhang scrapes

**What to build:** Kerbing is called out as its own mistake, distinct from hitting another car. The player who scrapes a wheel along the kerb is told they've struck a rim, on which wheel — the specific error that damages alloys in real life and the whole point of the tight-kerb scenario.

The roadway border is a polyline with a height, tested as its own collision class:

- against each wheel's contact footprint, producing a **rim strike**, where a wheel *mounting* the kerb (crossing the border rather than grazing it) is a distinct, higher severity than a graze;
- against the body outline at the kerb's height, producing an **overhang scrape** reported as a body contact, not a rim strike.

Contacts with the same object and part within a debounce window extend the existing event and update its peak severity rather than emitting a new one — one sustained scrape is one user-meaningful event, and scoring in 09 counts the coalesced units.

**Blocked by:** 07

**Status:** done

- [x] The roadway border is modelled as a polyline with a height, separate from body obstacles
- [x] Wheel-footprint contact emits a rim strike naming the specific wheel
- [x] Mounting the kerb reports a higher severity than grazing it
- [x] Body outline at kerb height emits an overhang scrape reported as a body contact
- [x] Contacts with the same object and part inside a debounce window coalesce into one event with peak severity
- [x] Test: a wheel grazing the kerb emits a rim strike naming the correct wheel
- [x] Test: mounting the kerb reports higher severity than grazing
- [x] Test: body overhang over a high kerb reports a body contact, not a rim strike
- [x] Test: a sustained scrape emits one coalesced event, not many
