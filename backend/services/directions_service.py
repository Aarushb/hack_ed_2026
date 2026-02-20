# directions_service.py - Google Directions API: auto-generate waypoints from a real walking route
# See docs/backend-design.md, section: directions_service.py

# Flow:
# 1. Call gmaps.directions(origin, destination, mode="walking")
# 2. Parse steps from result[0]["legs"][0]["steps"]
# 3. Strip HTML from html_instructions → plain text landmark_hint
# 4. Map each step to a Waypoint using end_location lat/lng
# 5. Return waypoint list

# Fallback: if Directions API is not integrated, session_service falls back to
# hardcoded demo routes in a dict keyed by place_id
