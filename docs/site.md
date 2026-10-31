# The site: what each view and panel shows

How the site behaves, for changing `app.js` or checking that data shows up as intended. The rules every site change follows (colour tokens, 375px, both themes, the `?v=` bump) are in `CLAUDE.md`; the data choices that drive what you see here (types, roles, sitelinks, months, realm countries) are in its Data rules.

## Views

- **Explore**, the front page: one search filling six linked cards: Year, World (the border map for the year and who led each realm elsewhere), Event, Place, Person, Work.
  - A search lifts the cards it matched to the top for that search (Year first, then the Person, Event, Work or Place it found; the saved drag order follows, unchanged) and blanks any card it could not fill.
  - A link changes only the card it matches, in place, except an event, which also brings its main person into the Person card.
  - A card expands to full screen; a country picker puts that country first; the address records the cards.
- **Timeline**: lanes of lives, an events lane, and a side panel with a places map.
- **Year**: rulers by realm and world region, a border map, artists, writers and thinkers with what they did that year, events, births and deaths. The makers section lists types Artist, Writer, Composer and Scholar.

Links go both ways between the views.

## Filters

- The **Show** buttons filter both views by group (Royalty, Nobility, Clergy, Government, Artists, Architects, Writers, Composers, Scholars, Patrons, Military, Notable people). They sit under the timeline's search box and between the Year form and the year, and double as the colour key: each group has a colour token (woad, weld, stitch, verdigris, ochre, walnut, lichen, rose, slate, indigo, iron, sage) that its people's lifespan bars share. Groups match `type` (Military also takes anyone with a military title); Architects match the `architect` role and Artists need an artistic role (painter, engraver, sculptor…).
- The **Fame** buttons (Icons 150+, Famous 100+, Well known 60+, Everyone) hide the long tail of artists, writers, composers, scholars and notable people by sitelinks; the default is Well known, remembered per browser. Rulers, clergy and officials are never hidden, and a person you searched for or selected always shows. A cultural figure with no `sitelinks` shows at every level.
- **Realms** are searchable: a realm name in the timeline search or the Year form ("Scotland 1300") filters to its title holders. In the Year view, a realm heading or its shape on the map focuses the page on that realm.

## Lifespan bars

Crowns mark people who held a title; the gold strip beside a lifespan bar marks the years held. Government and Notable titles (mayor, president, First Lady) show a column instead of a crown; military titles are drawn in iron and left out of the Year view's rulers.

## Panels

- **Person**: their portrait (the Wikipedia lead image, with a Wikimedia Commons credit link), a gallery of their works held in open museum collections (`Works in open museum collections`, up to 12, best first), and works that show them (`Shown in`). Every picture is a hotlinked thumbnail with its credit as a tooltip and a link to the museum's own page; a picture that fails to load is dropped.
- **Place**: **Nearby** (spots within 5 km, nearest 8; areas such as cities left out), **Big events nearby** (4–5 star events at those spots), **Eat and drink nearby** (live from the dining API, `docs/dining-api.md`, also drawn as small square pins on the street map) and **Elsewhere** (a record's `external` links). The distance is `NEARBY_KM` in `app.js`; the API's cap must be at least as large.
- **Sources**: person, event and place panels show a row linking each cited source ("Wikipedia: …", new tab); a record without one shows "None recorded".
- **Films** (artworks of kind `film`) link to places as `filmed` (where it was shot) or `depicts` (where it is set), to events as `depicts`, and to real people as `subject` (who it portrays). Panels show them both ways: a person's "Portrayed in", a film's "Portrays", "Shows" and "Set in", an event's "Films about it", and a place's "Films set here" (with who each film portrays) and "Films shot here". In Explore a film is a work: it opens in the Work card, and searching a film named after someone it portrays ("Oppenheimer") puts the person in the Person card and the film in the Work card.

## Maps

- The side map is a street map (Leaflet 1.9.4 from cdnjs, OpenStreetMap tiles, credit kept) when the pins fit in about a county, or most of them do; wider views use the coastline map (`data/land.js`).
- **Journey:** a person with two or more places gets a "Journey ⤢" button on the side panel's map and in the Explore Person card's Places section (links inside then go to the Explore cards). It opens a full-screen map of their events and place moments in date order (events with no place stay in the list, unpinned); picking a stop moves the map there and shows the event, its people and sources. The map is the border snapshot nearest the stop's year, or today's street map. Events order within a year by `start_date`, then `start_month` (sql/019).
