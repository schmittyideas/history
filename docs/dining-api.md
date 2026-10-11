# Dining API (RouteWeaver)

The site's "Eat and drink nearby" row asks RouteWeaver's dining database live; nothing from it is stored here.

**Endpoint:** `POST https://<routeweaver-project>.supabase.co/rest/v1/rpc/nearby_dining` with the RouteWeaver publishable key
(`apikey` header), body `{"lat": 34.0505, "lng": -118.2479, "radius_m": 800, "max_results": 8}`.

**Returns** open establishments (`business_status = 'OPERATIONAL'`) that are on a public **Metro Advisor** list (`dining.lists.category_slug = 'metro-advisor'`; for Los Angeles, list `020e0419-2fbe-4ab6-921b-5bd802decf0b`), nearest first: `id, name, type` (the primary tag),
`price_level, street_address, website, latitude, longitude, distance_m`. Radius is capped at 3,000 m and results at 25,
so the endpoint can't page through the whole table. Visitors can run only this function; the `dining` schema stays closed.

**Turning it on here:** add to `config.js`
```js
dining: { url: "https://<routeweaver-project>.supabase.co", key: "<RouteWeaver publishable key>" }
```
Without it, the row doesn't appear.

**Linking a historic restaurant:** give the History place `external: [{system: dining, id: <establishments.id>}]`.

The function was created in RouteWeaver on 2026-10-11 as migration `public_nearby_dining_api` (security definer,
`search_path = dining, postgis, public`, execute granted to anon and authenticated). Narrowed to Metro Advisor picks the same day (migration `nearby_dining_metro_advisor_only`). Copy both into the RouteWeaver repo's
migrations so that project's history has it too.
