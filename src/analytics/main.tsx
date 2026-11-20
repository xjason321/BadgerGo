// Entry of the usage dashboard (analytics.html, served at /analytics). A separate page and bundle: the app never
// loads any of it, and nothing in the app links to it.
import { createRoot } from "react-dom/client";
import "./analytics.css";
import { AnalyticsPage } from "./AnalyticsPage";

createRoot(document.getElementById("root")!).render(<AnalyticsPage />);
