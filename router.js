const listeners = [];

function getRoute() {
  return location.hash.slice(1) || "agents";
}

function navigate(route) {
  location.hash = route;
}

function onRouteChange(fn) {
  listeners.push(fn);
}

function init() {
  window.addEventListener("hashchange", () => {
    listeners.forEach(fn => fn(getRoute()));
  });
}

export { getRoute, navigate, onRouteChange, init };
