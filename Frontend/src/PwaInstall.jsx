import { useEffect, useState } from "react";

let deferredPrompt = null;
let installed = false;
const listeners = new Set();

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true
  );
}

function notify() {
  for (const listener of listeners) {
    listener({ prompt: deferredPrompt, installed });
  }
}

if (typeof window !== "undefined") {
  installed = isStandalone();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
}

export default function PwaInstall() {
  const [installState, setInstallState] = useState(() => ({
    prompt: deferredPrompt,
    installed,
  }));
  const [error, setError] = useState("");

  useEffect(() => {
    listeners.add(setInstallState);
    setInstallState({ prompt: deferredPrompt, installed });
    return () => listeners.delete(setInstallState);
  }, []);

  async function install() {
    if (!installState.prompt) return;
    try {
      await installState.prompt.prompt();
      await installState.prompt.userChoice;
      deferredPrompt = null;
      notify();
    } catch (installError) {
      console.error("Could not start app installation.", installError);
      setError("Installation couldn't start. Try your browser's Install option.");
      deferredPrompt = null;
      notify();
    }
  }

  if (installState.installed) return null;
  if (!installState.prompt)
    return error ? <span className="install-app-status" role="status">{error}</span> : null;
  return (
    <>
      <button
        className="install-app-button"
        type="button"
        onClick={install}
        aria-label="Install CTMS app"
      >
        Install app
      </button>
      {error && <span className="install-app-status" role="status">{error}</span>}
    </>
  );
}
