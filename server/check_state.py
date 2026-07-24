import urllib.request, json
r = urllib.request.urlopen("http://localhost:3002/units/full-state")
d = json.loads(r.read())
print(f"Units: {len(d['units'])}")
for u in d["units"]:
    print(f"  {u['symbol_name']} | symbol_id={u['symbol_id']}")
print(f"Routes: {len(d['routes'])}")
print(f"Tracks: {len(d['tracks'])}")
print(f"Assessments: {len(d['assessments'])}")
