import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { App } from "./ui/App";
import { registerSw } from "./registerSw";

createRoot(document.getElementById("root")!).render(<App />);

registerSw();
