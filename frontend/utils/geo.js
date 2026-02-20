// geo.js - Client-side geolocation helpers
// See docs/frontend-design.md, section: Location Tracking

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  });
}

function watchPosition(callback) {
  return navigator.geolocation.watchPosition(callback, console.error, {
    enableHighAccuracy: true,
  });
}
