import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "./registerSW";

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker in all environments for offline + native PWA support
registerSW();
