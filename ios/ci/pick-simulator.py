"""Print the UDID of the newest available iPhone simulator (prefers a non-Plus/Max/mini model)."""
import json
import re
import subprocess

devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '-j']))['devices']
phones = []
for runtime, entries in devices.items():
    match = re.search(r'iOS-(\d+)-(\d+)', runtime)
    if not match:
        continue
    for entry in entries:
        name = entry['name']
        if name.startswith('iPhone'):
            plain = not re.search(r'Plus|Max|mini|SE|e$', name)
            phones.append(((int(match[1]), int(match[2])), plain, name, entry['udid']))
phones.sort(reverse=True)
print(phones[0][3])
