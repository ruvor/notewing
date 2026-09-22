import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./styles.css";
import { registerServiceWorker } from "./pwa";
import { restore } from "./state";
import { App } from "./ui/App";

function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    restore()
      .catch((e) => console.error(e))
      .finally(() => setReady(true));
  }, []);
  return <App ready={ready} />;
}

render(<Root />, document.getElementById("app")!);
registerServiceWorker();
