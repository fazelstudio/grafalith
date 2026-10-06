import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyBootPreferences } from "./app/boot";
import "./app/theme/tokens.css";

applyBootPreferences();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
