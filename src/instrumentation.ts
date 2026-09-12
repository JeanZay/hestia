export function register() {
  if ((process.env.HESTIA_MODE ?? "demo") !== "demo") {
    throw new Error("Cette fondation Hestia fonctionne uniquement en mode demo.");
  }
  if ((process.env.HESTIA_ENV ?? "dev") !== "dev") {
    throw new Error("Cette fondation Hestia fonctionne uniquement dans l’environnement dev.");
  }
}
