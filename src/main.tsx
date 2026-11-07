import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/base.css";
import "./styles/home.css";
import "./styles/split.css";
import "./styles/image-lightbox.css";
import "./styles/update.css";
import "./styles/image-png.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
